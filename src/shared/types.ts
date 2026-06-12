// 全应用共享的数据类型

export type Period = 'dawn' | 'am' | 'pm' | 'night'
export type MaterialStatus = 'unused' | 'used' | 'deleted'
// 素材类型，后续可扩展更多
export type ClipType = 'broll' | 'intro'

export interface Folder {
  id: number
  path: string
  name: string
  shootDate: string | null // YYYY-MM-DD
  location: string | null
  category: string | null
  description: string | null
  device: string | null
  addedAt: number
  count?: number // 关联素材数（查询时附带）
}

export interface Material {
  id: number
  folderId: number
  folderName?: string
  path: string
  fileName: string
  fileSize: number | null
  durationSec: number | null
  width: number | null
  height: number | null
  bitrate: number | null // bps
  format: string | null
  codec: string | null
  thumbnailPath: string | null
  shootAt: number | null // epoch ms（精确到秒，用于排序与时段）
  period: Period | null
  status: MaterialStatus
  clipType: ClipType | null // B-roll / Intro 等
  alias: string | null // 别名（可多个素材共用）
  addedAt: number
  metaReady: number // 0/1 快元信息是否就绪
  thumbReady: number // 0/1 缩略图是否就绪
  tags: string[]
  usedByPrograms: { id: number; name: string }[]
}

export interface Tag {
  id: number
  name: string
  count?: number
}

export interface Stage {
  id: number
  name: string
  color: string
  sortOrder: number
  count?: number
}

export interface Program {
  id: number
  name: string
  stageId: number | null
  stageName?: string
  stageColor?: string
  stageOrder?: number
  outputDir: string | null
  createdAt: number
}

export interface Device {
  id: number
  name: string
  count?: number
}

export interface ImportProgress {
  folderId: number
  phase: 'scanning' | 'meta' | 'thumbs' | 'done'
  total: number
  metaDone: number
  thumbDone: number
}

export interface MaterialFilter {
  folderId?: number | null // null = 全部素材
  programId?: number | null // 节目维度浏览
  statuses?: MaterialStatus[]
  period?: Period | null
  dates?: string[] // YYYY-MM-DD
  devices?: string[]
  locations?: string[]
  tags?: string[]
  sort?: 'time' | 'manual'
}

export interface AppSettings {
  lastView: { type: 'folder' | 'program' | null; id: number | null }
}
