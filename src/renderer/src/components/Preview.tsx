import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  mediaUrl,
  previewSrc,
  isTranscoded,
  fmtDuration,
  fmtSize,
  fmtBitrate,
  fmtResolution,
  fmtShoot,
  PERIOD_LABEL,
  CLIP_TYPE
} from '../format'

const api = window.api

export function Preview(): JSX.Element | null {
  const preview = useStore((s) => s.preview)
  const materials = useStore((s) => s.materials)
  const view = useStore((s) => s.view)
  const activeProgram = useStore((s) => s.activeProgram)
  const [tagInput, setTagInput] = useState('')
  const [showTagBox, setShowTagBox] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // 播放进度：cur=已播放秒数，buf=已渲染（转码+缓冲）秒数，paused=暂停态
  const [cur, setCur] = useState(0)
  const [buf, setBuf] = useState(0)
  const [paused, setPaused] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  // 本条是否已触发「播到 10s 续转剩余」，随素材切换重置
  const resumedRef = useRef(false)

  const m = preview.open ? materials[preview.index] : null

  // 切换素材时重置「视频已加载」状态与进度，重新显示模糊占位
  useEffect(() => {
    setLoaded(false)
    setCur(0)
    setBuf(0)
    resumedRef.current = false
  }, [m?.id])

  // 分段转码 + 预取：通知主进程「当前条」开始转码、「后续 5 条」各预取前 15s，并回收其余（释放 RAM）
  useEffect(() => {
    if (!preview.open || !m) {
      void api.previewPrepare(null, [])
      return
    }
    const curPath = isTranscoded(m.codec, m.height) ? m.path : null
    const nextPaths: string[] = []
    for (let i = 1; i <= 5; i++) {
      const nm = materials[preview.index + i]
      if (nm && isTranscoded(nm.codec, nm.height)) nextPaths.push(nm.path)
    }
    void api.previewPrepare(curPath, nextPaths)
  }, [preview.open, preview.index, m?.id, materials])

  // rAF 轮询播放进度：直接读 video.currentTime / buffered，配合元数据总时长渲染进度条，
  // 不依赖流式源那个会跳变的 video.duration，避免进度条闪烁。
  useEffect(() => {
    if (!preview.open) return
    let raf = 0
    let last = 0
    const tick = (ts: number): void => {
      // 节流到 ~10fps：进度条够平滑，又不让大组件每帧重渲染
      if (ts - last >= 100) {
        last = ts
        const v = videoRef.current
        if (v) {
          setCur(v.currentTime)
          setPaused(v.paused)
          try {
            if (v.buffered.length) setBuf(v.buffered.end(v.buffered.length - 1))
          } catch {
            /* buffered 偶发 InvalidStateError，忽略 */
          }
          // 播到 10s 还没切走 → 让主进程续转该条剩余部分（每条只触发一次）
          if (!resumedRef.current && m && isTranscoded(m.codec, m.height) && v.currentTime >= 10) {
            resumedRef.current = true
            void api.previewResume(m.path)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [preview.open, m?.id])

  const usedHere =
    view.type === 'program'
      ? true
      : activeProgram
        ? !!m && m.usedByPrograms.some((p) => p.id === activeProgram.id)
        : false

  // 软删除 / 恢复：删除时先提示，1 秒后落库并跳到下一个
  const handleDelete = useCallback((): void => {
    if (!m) return
    if (m.status === 'deleted') {
      void useStore.getState().setMaterialStatusLocal([m.id], 'unused')
      return
    }
    const id = m.id
    setToast('已删除')
    setTimeout(() => {
      void useStore.getState().setMaterialStatusLocal([id], 'deleted')
      setToast(null)
    }, 1000)
  }, [m])

  useEffect(() => {
    if (!preview.open) return
    const fn = (e: KeyboardEvent): void => {
      const inInput = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (e.key === 'Escape') {
        useStore.getState().closePreview()
        return
      }
      if (inInput || !m) return
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          useStore.getState().movePreview(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          useStore.getState().movePreview(1)
          break
        case 'ArrowDown':
          e.preventDefault()
          void useStore.getState().setProgramUse(m.id, true)
          break
        case 'ArrowUp':
          e.preventDefault()
          void useStore.getState().setProgramUse(m.id, false)
          break
        case ' ': {
          e.preventDefault()
          const v = videoRef.current
          if (v) v.paused ? void v.play() : v.pause()
          break
        }
        case 'Enter':
          e.preventDefault()
          void useStore.getState().setProgramUse(m.id, true)
          break
        case 'Backspace':
        case 'Delete':
          e.preventDefault()
          handleDelete()
          break
        case 'b':
        case 'B':
          e.preventDefault()
          void useStore.getState().setClipTypeLocal([m.id], m.clipType === 'broll' ? null : 'broll')
          break
        case 'i':
        case 'I':
          e.preventDefault()
          void useStore.getState().setClipTypeLocal([m.id], m.clipType === 'intro' ? null : 'intro')
          break
        case 'a':
        case 'A':
          // A-roll 为主，直接清空类型
          e.preventDefault()
          void useStore.getState().setClipTypeLocal([m.id], null)
          break
        case 'q':
        case 'Q':
          useStore.getState().closePreview()
          break
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [preview.open, preview.index, m, handleDelete])

  if (!m) return null

  const addTag = async (): Promise<void> => {
    const name = tagInput.trim()
    if (!name) return
    await api.assignTag([m.id], name)
    setTagInput('')
    await useStore.getState().refreshSidebar()
    await useStore.getState().reloadMaterials()
  }
  const removeTag = async (t: string): Promise<void> => {
    await api.unassignTag(m.id, t)
    await useStore.getState().reloadMaterials()
  }

  const useLabel =
    view.type === 'program'
      ? '放弃使用'
      : activeProgram
        ? usedHere
          ? `已选用·放弃《${activeProgram.name}》`
          : `选用到《${activeProgram.name}》`
        : '（先打开一个节目）'

  // 进度条：总时长用元数据（稳定，不闪烁）；绿=已播放，蓝=已渲染，灰=未渲染（轨道底色）
  const dur = m.durationSec && m.durationSec > 0 ? m.durationSec : Math.max(buf, cur, 0.001)
  const pctPlayed = Math.max(0, Math.min(100, (cur / dur) * 100))
  const pctBuffered = Math.max(0, Math.min(100, (buf / dur) * 100))
  // 仅能跳转到已渲染范围内（流式转码未到的部分无法跳）
  const seek = (e: React.MouseEvent<HTMLDivElement>): void => {
    const v = videoRef.current
    if (!v) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - rect.left) / rect.width) * dur
    v.currentTime = Math.max(0, Math.min(t, Math.max(0, buf - 0.05)))
  }

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex flex-col p-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) useStore.getState().closePreview()
      }}
    >
      {/* 视频区：占满剩余空间 */}
      <div className="flex-1 min-h-0 relative">
        <video
          key={m.id}
          ref={videoRef}
          src={previewSrc(m.path, m.codec, m.height)}
          autoPlay
          onClick={() => {
            const v = videoRef.current
            if (v) v.paused ? void v.play() : v.pause()
          }}
          onCanPlay={() => setLoaded(true)}
          onLoadedData={() => setLoaded(true)}
          className="w-full h-full object-contain bg-black rounded-lg cursor-pointer"
        />

        {/* 低画质预览版提示：仅转码流显示 */}
        {isTranscoded(m.codec, m.height) && (
          <div className="absolute bottom-2 right-2 text-[10px] text-white/80 bg-black/55 px-2 py-[2px] rounded pointer-events-none">
            720P 低画质预览版
          </div>
        )}

        {/* 加载占位：模糊缩略图 + 转圈，加载好后消失 */}
        {!loaded && (
          <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none">
            {m.thumbnailPath && (
              <img src={mediaUrl(m.thumbnailPath)} className="w-full h-full object-contain blur-[3px] opacity-90" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="spin !w-6 !h-6" />
              <span className="text-white/70 text-xs">视频加载中…</span>
            </div>
          </div>
        )}

        {/* 片段类型大字提示：始终居中显示，半透明，不挡视频与操作 */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            style={{
              color: m.clipType ? CLIP_TYPE[m.clipType].color : '#ffffff',
              textShadow: '0 2px 24px rgba(0,0,0,0.6)'
            }}
            className="text-[100px] leading-none font-black opacity-30 tracking-wide select-none"
          >
            {m.clipType ? CLIP_TYPE[m.clipType].label : 'A-roll'}
          </span>
        </div>

        {/* 删除提示 */}
        {toast && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/75 text-white text-sm px-4 py-2 rounded-xl z-10 flex items-center gap-2">
            🗑 {toast}
          </div>
        )}

        <div className="absolute top-2 left-2 flex gap-2 items-center pointer-events-none">
          {m.period && (
            <span className="text-[10px] font-bold px-2 py-[2px] rounded text-white bg-black/55">
              {PERIOD_LABEL[m.period]}
            </span>
          )}
          <span className="text-white/90 text-xs bg-black/40 px-2 py-[2px] rounded">{fmtShoot(m.shootAt)}</span>
          {m.clipType && (
            <span
              style={{ background: CLIP_TYPE[m.clipType].color }}
              className="text-[10px] font-semibold px-2 py-[2px] rounded text-white"
            >
              {CLIP_TYPE[m.clipType].label}
            </span>
          )}
          {m.status !== 'unused' && (
            <span className="text-[10px] px-2 py-[2px] rounded text-white bg-black/55">
              {m.status === 'used' ? '已使用' : '已删除'}
            </span>
          )}
        </div>
      </div>

      {/* 自定义控制条：播放/暂停 + 三色进度条 + 时间（总时长取自元数据，稳定不闪烁） */}
      <div className="flex items-center gap-3 pt-2 flex-shrink-0">
        <button
          onClick={() => {
            const v = videoRef.current
            if (v) v.paused ? void v.play() : v.pause()
          }}
          className="text-white/90 text-base w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 flex-shrink-0"
        >
          {paused ? '▶' : '❚❚'}
        </button>
        <div
          onClick={seek}
          title="可跳转到已渲染（蓝色）范围内"
          className="relative flex-1 h-[6px] rounded-full bg-white/20 cursor-pointer overflow-hidden"
        >
          {/* 蓝：已渲染（转码+缓冲） */}
          <div
            className="absolute inset-y-0 left-0 bg-blue-500/70 rounded-full"
            style={{ width: `${pctBuffered}%` }}
          />
          {/* 绿：已播放 */}
          <div
            className="absolute inset-y-0 left-0 bg-green-500 rounded-full"
            style={{ width: `${pctPlayed}%` }}
          />
        </div>
        <span className="text-white/70 text-[11px] tabular-nums flex-shrink-0 w-[88px] text-right">
          {fmtDuration(cur)} / {fmtDuration(dur)}
        </span>
      </div>

      {/* 底部：信息 + 标签 + 快捷键提示 + 按钮，合并为一行 */}
      <div className="flex items-center gap-3 text-white pt-2 flex-shrink-0">
        <div className="min-w-0 max-w-[260px]">
          <div className="text-[13px] font-semibold truncate leading-tight">{m.fileName}</div>
          <div className="text-[10px] text-white/45 flex gap-2 flex-wrap leading-tight">
            <span>{fmtResolution(m.width, m.height)}</span>
            <span>{fmtDuration(m.durationSec)}</span>
            <span>{fmtBitrate(m.bitrate)}bps</span>
            <span>{fmtSize(m.fileSize)}</span>
            <span>{m.codec?.toUpperCase()}</span>
          </div>
        </div>

        <div className="flex gap-[5px] flex-wrap max-w-[200px] overflow-hidden">
          {m.tags.map((t) => (
            <span
              key={t}
              onClick={() => removeTag(t)}
              title="点击移除"
              className="text-[11px] text-white bg-white/15 px-2 py-[1px] rounded-md cursor-pointer hover:bg-white/25"
            >
              {t} ✕
            </span>
          ))}
        </div>

        <div className="text-white/35 text-[10px] hidden xl:flex gap-3 ml-1 whitespace-nowrap">
          <span>←→ 切换</span>
          <span>↓ 选中</span>
          <span>↑ 取消</span>
          <span>空格 播放</span>
          <span>B B-roll</span>
          <span>I Intro</span>
          <span>A A-roll</span>
          <span>删除键 软删</span>
          <span>Q 关闭</span>
        </div>

        <div className="ml-auto flex gap-2 items-center flex-shrink-0">
          {showTagBox ? (
            <input
              autoFocus
              list="all-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTag()
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setShowTagBox(false)
                }
              }}
              onBlur={() => setShowTagBox(false)}
              placeholder="标签名，回车添加"
              className="text-xs text-black rounded-lg px-2 py-[6px] w-[140px]"
            />
          ) : (
            <Btn onClick={() => setShowTagBox(true)}>＋ 标签</Btn>
          )}
          <Btn onClick={handleDelete}>{m.status === 'deleted' ? '↩︎ 恢复' : '🗑 软删除'}</Btn>
          <Btn primary onClick={() => useStore.getState().toggleProgramUse(m.id)}>
            {useLabel}
          </Btn>
          <Btn onClick={() => useStore.getState().closePreview()}>关闭 (Q)</Btn>
        </div>
      </div>

      <datalist id="all-tags">
        {useStore.getState().tags.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
    </div>
  )
}

function Btn({
  children,
  primary,
  onClick
}: {
  children: React.ReactNode
  primary?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`text-xs text-white border-none px-[13px] py-[7px] rounded-lg flex items-center gap-[6px] whitespace-nowrap ${
        primary ? 'bg-accent' : 'bg-white/15 hover:bg-white/25'
      }`}
    >
      {children}
    </button>
  )
}
