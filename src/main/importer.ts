import { readdirSync, statSync } from 'fs'
import { join, basename, extname } from 'path'
import { BrowserWindow } from 'electron'
import * as dbm from './db'
import { probeMeta, makeThumbnail } from './media'
import { parseShootFromName } from './filename'

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.hevc'])

function emit(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload))
}

function scanVideos(dir: string): string[] {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((name) => !name.startsWith('.') && VIDEO_EXT.has(extname(name).toLowerCase()))
    .map((name) => join(dir, name))
    .filter((p) => {
      try {
        return statSync(p).isFile()
      } catch {
        return false
      }
    })
    .sort()
}

// 后台元信息 + 缩略图处理。分阶段：先全部快元信息回填，再逐个缩略图。
export async function processFolder(folderId: number): Promise<void> {
  const metaPending = dbm.materialsPendingMeta(folderId)
  const total = metaPending.length

  // 阶段二：快元信息
  let metaDone = 0
  emit('import:progress', { folderId, phase: 'meta', total, metaDone, thumbDone: 0 })
  for (const m of metaPending) {
    try {
      const meta = await probeMeta(m.path, m.fileName)
      dbm.updateMaterialMeta(m.id, meta)
      // 回填文件夹拍摄日期
      const parsed = parseShootFromName(m.fileName)
      if (parsed.shootDate) dbm.setFolderShootDateIfEmpty(folderId, parsed.shootDate)
    } catch {
      dbm.updateMaterialMeta(m.id, {
        fileSize: null,
        durationSec: null,
        width: null,
        height: null,
        bitrate: null,
        format: null,
        codec: null,
        shootAt: null,
        period: null
      })
    }
    metaDone++
    if (metaDone % 5 === 0 || metaDone === total) {
      emit('import:progress', { folderId, phase: 'meta', total, metaDone, thumbDone: 0 })
      emit('materials:changed', { folderId })
    }
  }

  // 阶段三：缩略图（慢，逐个）
  const thumbPending = dbm.materialsPendingThumb(folderId)
  let thumbDone = 0
  for (const m of thumbPending) {
    const mat = dbm.getMaterial(m.id)
    try {
      const out = await makeThumbnail(m.id, m.path, mat?.durationSec ?? null)
      dbm.updateMaterialThumb(m.id, out)
    } catch {
      /* 缩略图失败不阻塞 */
    }
    thumbDone++
    if (thumbDone % 3 === 0 || thumbDone === thumbPending.length) {
      emit('import:progress', {
        folderId,
        phase: 'thumbs',
        total,
        metaDone,
        thumbDone
      })
      emit('materials:changed', { folderId })
    }
  }

  emit('import:progress', { folderId, phase: 'done', total, metaDone, thumbDone })
  emit('materials:changed', { folderId })
}

// 阶段一：立即扫描文件列表并落库占位，返回 folderId，随后异步处理
export async function importFolder(opts: {
  path: string
  location: string | null
  category: string | null
  description: string | null
  device: string | null
}): Promise<number> {
  const files = scanVideos(opts.path)
  const folderId = dbm.addFolder({
    path: opts.path,
    name: basename(opts.path),
    shootDate: null,
    location: opts.location,
    category: opts.category,
    description: opts.description,
    device: opts.device
  })
  emit('import:progress', { folderId, phase: 'scanning', total: files.length, metaDone: 0, thumbDone: 0 })
  for (const f of files) dbm.insertMaterialStub(folderId, f, basename(f))
  emit('materials:changed', { folderId })

  // 异步后台处理，不阻塞返回
  void processFolder(folderId)
  return folderId
}

// 重新处理尚未完成的素材（应用重启后续跑）
export async function resumePending(): Promise<void> {
  const folders = dbm.listFolders()
  for (const f of folders) {
    const pendingMeta = dbm.materialsPendingMeta(f.id)
    const pendingThumb = dbm.materialsPendingThumb(f.id)
    if (pendingMeta.length || pendingThumb.length) void processFolder(f.id)
  }
}
