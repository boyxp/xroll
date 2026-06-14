import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { statSync } from 'fs'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { thumbnailsDir } from './paths'
import { parseShootFromName, shootFromMtime } from './filename'

const execFileP = promisify(execFile)

// 打包后 ffmpeg-static 路径会落在 app.asar.unpacked，需要修正
function fixPath(p: string | null): string {
  if (!p) return ''
  return p.replace('app.asar', 'app.asar.unpacked')
}
export const FFMPEG = fixPath(ffmpegStatic as unknown as string)
const FFPROBE = fixPath(ffprobeStatic.path)

export interface ProbedMeta {
  fileSize: number | null
  durationSec: number | null
  width: number | null
  height: number | null
  bitrate: number | null
  format: string | null
  codec: string | null
  shootAt: number | null
  period: string | null
}

export async function probeMeta(path: string, fileName: string): Promise<ProbedMeta> {
  let fileSize: number | null = null
  let mtimeMs = Date.now()
  try {
    const st = statSync(path)
    fileSize = st.size
    mtimeMs = st.mtimeMs
  } catch {
    /* ignore */
  }

  // 拍摄时间：优先文件名，失败用 mtime
  let shoot = parseShootFromName(fileName)
  if (shoot.shootAt === null) shoot = shootFromMtime(mtimeMs)

  let durationSec: number | null = null
  let width: number | null = null
  let height: number | null = null
  let bitrate: number | null = null
  let format: string | null = null
  let codec: string | null = null

  try {
    const { stdout } = await execFileP(FFPROBE, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,codec_name,bit_rate:format=duration,bit_rate,format_name',
      '-of',
      'json',
      path
    ])
    const j = JSON.parse(stdout)
    const s = (j.streams && j.streams[0]) || {}
    const f = j.format || {}
    width = s.width ?? null
    height = s.height ?? null
    codec = s.codec_name ?? null
    durationSec = f.duration ? parseFloat(f.duration) : null
    bitrate = f.bit_rate ? parseInt(f.bit_rate, 10) : s.bit_rate ? parseInt(s.bit_rate, 10) : null
    format = extFormat(fileName)
  } catch {
    format = extFormat(fileName)
  }

  return {
    fileSize,
    durationSec,
    width,
    height,
    bitrate,
    format,
    codec,
    shootAt: shoot.shootAt,
    period: shoot.period
  }
}

// 按需流式转码参数：用 VideoToolbox 硬解（与 Finder 同一条硬件通道）→ 实时硬编 720p H.264，
// 输出 fragmented MP4 到 stdout 管道，供 media://stream 渐进播放。源文件只读，不写任何磁盘文件。
// 追加 -progress pipe:3 输出转码进度（out_time_us），preview.ts 据此在 15s 处暂停。
export function transcodeArgs(path: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-progress', 'pipe:3', // 进度写到 fd3，供分段转码探测已输出时长
    '-hwaccel', 'videotoolbox', // 硬件解码（HEVC/10bit 同样适用）
    '-i', path,
    '-vf', 'scale=-2:720', // 预览只需大致看清，720p 足够且转码更快
    '-c:v', 'h264_videotoolbox', // 硬件编码 H.264，Chromium 可硬解
    '-b:v', '4M',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    // empty_moov + frag_keyframe：moov 前置，首个分片到达即可起播 → 边加载边播
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1'
  ]
}

function extFormat(fileName: string): string {
  const m = /\.([^.]+)$/.exec(fileName)
  return m ? m[1].toUpperCase() : ''
}

// 读取媒体内嵌起始时间码（SMPTE），换算成「秒」的有理数 {num,den}，按视频帧率计。
// 达芬奇导入 FCPXML 时按「文件名 + 源时间码」套底，asset/asset-clip 的 start 必须等于
// 素材真实时间码，否则套不上 → 素材离线（界面提示「找不到素材」）。无时间码返回 null。
export async function probeStartTimecode(
  path: string,
  fps: { num: number; den: number }
): Promise<{ num: number; den: number } | null> {
  let tc: string | null = null
  // 时间码轨（tmcd）的帧率可能与视频帧率不同：DJI 59.94fps 视频常把时间码按 29.97 存储。
  // 必须按时间码「自身」帧率换算成秒，否则会偏差几帧 → 达芬奇按时间码套底时每个片头出现
  // 一截离线媒体（in 点落在素材真实首帧之前）。回退用视频帧率。
  let tcRate: { num: number; den: number } | null = null
  try {
    const { stdout } = await execFileP(FFPROBE, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_tag_string,avg_frame_rate:stream_tags=timecode:format_tags=timecode',
      '-of',
      'json',
      path
    ])
    const j = JSON.parse(stdout)
    // 优先取时间码轨（tmcd），同时拿它的帧率
    for (const s of j.streams ?? []) {
      if (s.codec_tag_string === 'tmcd' && s.tags?.timecode) {
        tc = s.tags.timecode
        tcRate = parseRate(s.avg_frame_rate)
        break
      }
    }
    // 回退：任意带 timecode 标签的流，再回退容器级标签
    if (!tc) {
      for (const s of j.streams ?? []) {
        if (s.tags?.timecode) {
          tc = s.tags.timecode
          break
        }
      }
    }
    if (!tc && j.format?.tags?.timecode) tc = j.format.tags.timecode
  } catch {
    return null
  }
  if (!tc) return null

  // HH:MM:SS:FF（非丢帧）或 HH:MM:SS;FF / .FF（丢帧）
  const m = /^(\d+):(\d+):(\d+)[:;.](\d+)$/.exec(tc.trim())
  if (!m) return null
  const hh = +m[1]
  const mm = +m[2]
  const ss = +m[3]
  const ff = +m[4]
  const dropFrame = /[;.]/.test(tc)
  const rate = tcRate ?? fps // 时间码帧率优先，缺失回退视频帧率
  const nominal = Math.round(rate.num / rate.den) // 30 / 60 ...

  let frames: number
  if (dropFrame && (nominal === 30 || nominal === 60)) {
    // 丢帧：每分钟丢 nominal/15 帧（30→2、60→4），每 10 分钟不丢
    const dropPerMin = nominal / 15
    const totalMin = hh * 60 + mm
    const dropped = dropPerMin * (totalMin - Math.floor(totalMin / 10))
    frames = (hh * 3600 + mm * 60 + ss) * nominal + ff - dropped
  } else {
    frames = (hh * 3600 + mm * 60 + ss) * nominal + ff
  }
  // 秒 = frames * den/num；约分让分子分母更小（与达芬奇一致，值相等即可）
  let num = frames * rate.den
  let den = rate.num
  const g = gcd(num, den)
  if (g > 1) {
    num /= g
    den /= g
  }
  return { num, den }
}

// 解析 ffprobe 帧率字符串（"30000/1001" / "60/1"），无效（如 "0/0"）返回 null
function parseRate(s?: string): { num: number; den: number } | null {
  if (!s) return null
  const [n, d] = s.split('/').map((x) => parseInt(x, 10))
  if (n > 0 && d > 0) return { num: n, den: d }
  return null
}

// 视频流精确帧数，用于 FCPXML 片段时长（与达芬奇一致按「视频帧数」取齐）。
// 注意：不能用容器时长（format.duration），它常被更长的音频轨拉长，四舍五入会多出 1 帧
// → 片尾多一帧离线。优先 nb_frames，缺失时用视频流时长×帧率。失败返回 null（调用方回退）。
export async function probeFrameCount(
  path: string,
  fps: { num: number; den: number }
): Promise<number | null> {
  try {
    const { stdout } = await execFileP(FFPROBE, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=nb_frames,duration',
      '-of',
      'json',
      path
    ])
    const s = (JSON.parse(stdout).streams || [])[0] || {}
    const n = parseInt(s.nb_frames, 10)
    if (n > 0) return n
    const d = parseFloat(s.duration)
    if (d > 0) return Math.max(1, Math.round((d * fps.num) / fps.den))
  } catch {
    /* ignore */
  }
  return null
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a || 1
}

// 帧率（r_frame_rate，形如 "60/1" / "60000/1001"），导出 FCPXML 时用于换算时间。失败回退 60。
export async function probeFps(path: string): Promise<{ num: number; den: number }> {
  try {
    const { stdout } = await execFileP(FFPROBE, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=r_frame_rate',
      '-of',
      'default=nokey=1:noprint_wrappers=1',
      path
    ])
    const [n, d] = stdout.trim().split('/').map((x) => parseInt(x, 10))
    if (n > 0 && d > 0) return { num: n, den: d }
  } catch {
    /* ignore */
  }
  return { num: 60, den: 1 }
}

// 在 ~10% 处抓一帧，缩到宽 1280（兼顾清晰度与体积；仅对 thumb_ready=0 的素材调用）
export async function makeThumbnail(materialId: number, path: string, durationSec: number | null): Promise<string> {
  const out = join(thumbnailsDir(), `${materialId}.jpg`)
  const seek = durationSec && durationSec > 2 ? Math.min(durationSec * 0.1, durationSec - 0.5) : 0
  await execFileP(FFMPEG, [
    '-y',
    '-ss',
    String(seek.toFixed(2)),
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    'scale=1280:-2',
    '-q:v',
    '3',
    out
  ])
  return out
}
