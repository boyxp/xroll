import { spawn, type ChildProcess } from 'child_process'
import { PassThrough, type Readable } from 'stream'
import { FFMPEG, transcodeArgs } from './media'

// 预览转码缓存：每条素材一个 ffmpeg，先转前 CAP_SECONDS 秒就 SIGSTOP 暂停，前 15s 的 fmp4
// 字节缓存在内存供 media://stream 即时回放；挂上消费者后改为 live 直通（不再入内存）。
// 为了「快速翻看下一条立即能播」，提前为接下来的 PREFETCH_AHEAD 条各预转前 15s（限并发，
// 免得同时多路 4K 解码把外置盘/CPU 拖垮）。整条素材只读、不写任何磁盘文件，切换由 reconcile 回收。
const CAP_SECONDS = 15
const PREFETCH_AHEAD = 5 // 预取后续条数
const PREFETCH_CONCURRENCY = 2 // 同时主动转码的预取路数上限（不含当前条）

interface Entry {
  proc: ChildProcess
  chunks: Buffer[] // 仅缓存「挂上消费者之前」产出的字节（≈前 15s，约 8MB）
  capped: boolean // 已到 15s 并 SIGSTOP，等待 resume
  resumed: boolean // 已 resume 过 → 此后不再 cap（否则 out_time 一直 >15s 会反复 SIGSTOP）
  ended: boolean // ffmpeg 退出
  failed: boolean // 非正常退出（出错/被杀）→ 需要重转，区别于「短片正常转完」
  consumer: PassThrough | null // 当前 media://stream 的下游（单消费者）
}

const cache = new Map<string, Entry>()
let wanted: string[] = [] // 期望保留的路径，顺序为 [当前, 下一, 下二, ...]

function start(path: string): Entry {
  const proc = spawn(FFMPEG, transcodeArgs(path), { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] })
  const entry: Entry = {
    proc,
    chunks: [],
    capped: false,
    resumed: false,
    ended: false,
    failed: false,
    consumer: null
  }

  proc.stderr?.resume() // 排空日志，避免缓冲区写满阻塞 ffmpeg

  // 有消费者就直通给它（不留存，界定内存）；还没有就先缓存，供之后秒开回放
  proc.stdout?.on('data', (d: Buffer) => {
    const c = entry.consumer
    if (c && !c.destroyed) c.write(d)
    else if (!c) entry.chunks.push(d)
  })

  // fd3：ffmpeg -progress 输出，按行解析 out_time_us，到 15s 就暂停冻结（只暂停一次）
  const progress = proc.stdio[3] as Readable | undefined
  let line = ''
  progress?.on('data', (d: Buffer) => {
    line += d.toString()
    let nl: number
    while ((nl = line.indexOf('\n')) >= 0) {
      const cur = line.slice(0, nl)
      line = line.slice(nl + 1)
      const m = /^out_time_us=(\d+)/.exec(cur)
      if (m && !entry.capped && !entry.resumed && Number(m[1]) >= CAP_SECONDS * 1e6) {
        entry.capped = true
        try {
          proc.kill('SIGSTOP')
        } catch {
          /* ignore */
        }
        schedule() // 这一路转够 15s 了，腾出并发名额给下一条预取
      }
    }
  })

  const finish = (code: number | null): void => {
    entry.ended = true
    if (code !== 0) entry.failed = true // 正常转完 code=0；出错/被杀则需重转
    entry.consumer?.end()
    schedule()
  }
  proc.on('close', (code) => finish(code))
  proc.on('error', () => finish(-1))

  return entry
}

function kill(e: Entry): void {
  // 先解冻再 SIGKILL（SIGKILL 对 stopped 进程也能送达，这里保险起见）
  try {
    e.proc.kill('SIGCONT')
  } catch {
    /* ignore */
  }
  try {
    e.proc.kill('SIGKILL')
  } catch {
    /* ignore */
  }
  e.consumer?.end()
  e.consumer = null
}

function ensure(path: string): Entry {
  const existing = cache.get(path)
  // 正常转完的短片（ended 但未 failed）保留其 chunks 供秒开回放，不重转；只有失败才重转
  if (existing && !existing.failed) return existing
  if (existing) kill(existing)
  const e = start(path)
  cache.set(path, e)
  return e
}

// 调度：回收非期望条目，确保当前条在转，并按并发上限补齐预取
function schedule(): void {
  const keep = new Set(wanted)
  for (const [p, e] of cache) {
    if (!keep.has(p)) {
      kill(e)
      cache.delete(p)
    }
  }
  if (wanted.length === 0) return
  ensure(wanted[0]) // 当前条始终在转

  // 统计正在「主动转码」（未 cap、未结束）的预取路数
  let active = 0
  for (const p of wanted.slice(1)) {
    const e = cache.get(p)
    if (e && !e.capped && !e.ended) active++
  }
  // 在并发上限内，按顺序补齐尚未开始/需重转的预取
  for (const p of wanted.slice(1)) {
    if (active >= PREFETCH_CONCURRENCY) break
    const e = cache.get(p)
    if (!e || e.failed) {
      ensure(p)
      active++
    }
  }
}

// media://stream 调用：即时回放已缓存的前 15s，再挂上 live 直通
export function serve(path: string): PassThrough {
  const e = ensure(path)
  const pass = new PassThrough()
  for (const c of e.chunks) pass.write(c)
  if (e.ended) {
    pass.end()
  } else {
    if (e.consumer && e.consumer !== pass) e.consumer.end()
    e.consumer = pass // 同步赋值，与上面写 chunks 之间不会插入新数据
  }
  return pass
}

// stream 请求 abort：仅解绑下游，不杀进程（进程生命周期交给 reconcile/schedule）
export function detach(path: string, pass: PassThrough): void {
  const e = cache.get(path)
  if (e && e.consumer === pass) e.consumer = null
  pass.destroy()
}

// 播放到 10s（渲染层判定）后续转剩余部分。设 resumed=true 永久关闭 cap，
// 既处理「已 cap → SIGCONT」，也处理「还没 cap → 别再 cap，免得之后又卡在 15s」。
export function resume(path: string): void {
  const e = cache.get(path)
  if (!e || e.ended) return
  e.resumed = true
  if (e.capped) {
    e.capped = false
    try {
      e.proc.kill('SIGCONT')
    } catch {
      /* ignore */
    }
  }
}

// 打开/切换素材时调用：当前条 + 后续若干条进入期望集，回收其余。传 (null, []) 即清空。
export function reconcile(currentPath: string | null, nextPaths: string[]): void {
  wanted = []
  if (currentPath) wanted.push(currentPath)
  for (const p of nextPaths.slice(0, PREFETCH_AHEAD)) {
    if (p && !wanted.includes(p)) wanted.push(p)
  }
  schedule()
}

// 退出前清理：杀掉所有转码进程，否则被 SIGSTOP 暂停的 ffmpeg 会变成孤儿进程残留
export function killAll(): void {
  for (const [, e] of cache) kill(e)
  cache.clear()
  wanted = []
}
