import { ClipType, Period } from '../../shared/types'

export function mediaUrl(path: string | null): string {
  if (!path) return ''
  return `media://file/${encodeURIComponent(path)}`
}

// 是否需要走转码：Chromium 能直接硬解的 H.264（≤1080p）走原文件渐进播放，零转码、原画；
// 其余（HEVC、10bit、4K 等）走主进程按需流式转码。
export function isTranscoded(codec: string | null, height: number | null): boolean {
  const c = (codec ?? '').toLowerCase()
  const nativeH264 = (c === 'h264' || c === 'avc1') && (!height || height <= 1080)
  return !nativeH264
}

// 预览视频源
export function previewSrc(path: string, codec: string | null, height: number | null): string {
  if (!isTranscoded(codec, height)) return mediaUrl(path)
  return `media://stream/${encodeURIComponent(path)}`
}

export function fmtSize(bytes: number | null): string {
  if (!bytes && bytes !== 0) return '—'
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB'
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

export function fmtDuration(sec: number | null): string {
  if (!sec && sec !== 0) return '—'
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export function fmtBitrate(bps: number | null): string {
  if (!bps) return '—'
  return Math.round(bps / 1_000_000) + 'M'
}

export function fmtResolution(w: number | null, h: number | null): string {
  if (!w || !h) return '—'
  return `${w}×${h}`
}

// 可读拍摄时间：1月29日 6点42分（秒省略）
export function fmtShoot(ms: number | null): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}点${String(d.getMinutes()).padStart(2, '0')}分`
}

export const PERIOD_LABEL: Record<Period, string> = {
  dawn: '早晨',
  am: '上午',
  pm: '下午',
  night: '晚上'
}

export const PERIOD_STYLE: Record<Period, { bg: string; fg: string }> = {
  dawn: { bg: '#FAD0C4', fg: '#9a3b1c' },
  am: { bg: '#FFF2CC', fg: '#8a6a14' },
  pm: { bg: '#E67E22', fg: '#ffffff' },
  night: { bg: '#1A252C', fg: '#ffffff' }
}

export const STATUS_COLOR = {
  unused: '#0a84ff',
  used: '#8e8e93',
  deleted: '#1c1c1e'
}

// 素材类型标签与颜色（后续可扩展）
export const CLIP_TYPE: Record<ClipType, { label: string; color: string }> = {
  broll: { label: 'B-roll', color: '#5c8e10' },
  intro: { label: 'Intro', color: '#255bb1' }
}
