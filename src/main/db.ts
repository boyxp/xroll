import Database from 'better-sqlite3'
import { dbPath } from './paths'
import {
  Folder,
  Material,
  MaterialFilter,
  Program,
  Stage,
  Tag,
  Device,
  MaterialStatus,
  ClipType
} from '../shared/types'

let db: Database.Database

export function initDb(): void {
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  seedDefaults()
  migrateThumbnails()
  migrateColumns()
}

// 为已存在的库补充新增列（clip_type / alias），幂等
function migrateColumns(): void {
  const cols = (db.prepare('PRAGMA table_info(materials)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('clip_type')) db.exec('ALTER TABLE materials ADD COLUMN clip_type TEXT')
  if (!cols.includes('alias')) db.exec('ALTER TABLE materials ADD COLUMN alias TEXT')
}

// 缩略图尺寸升级时，重置已缓存缩略图让其按新尺寸重建
const THUMB_VERSION = '2'
function migrateThumbnails(): void {
  if (getSetting('thumbVersion') !== THUMB_VERSION) {
    db.prepare('UPDATE materials SET thumb_ready=0, thumbnail_path=NULL').run()
    setSetting('thumbVersion', THUMB_VERSION)
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  shoot_date TEXT,
  location TEXT,
  category TEXT,
  description TEXT,
  device TEXT,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  path TEXT UNIQUE NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  duration_sec REAL,
  width INTEGER,
  height INTEGER,
  bitrate INTEGER,
  format TEXT,
  codec TEXT,
  thumbnail_path TEXT,
  shoot_at INTEGER,
  period TEXT,
  status TEXT NOT NULL DEFAULT 'unused',
  added_at INTEGER NOT NULL,
  meta_ready INTEGER NOT NULL DEFAULT 0,
  thumb_ready INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_materials_folder ON materials(folder_id);
CREATE INDEX IF NOT EXISTS idx_materials_shoot ON materials(shoot_at);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS material_tags (
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (material_id, tag_id)
);

CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  output_dir TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS program_materials (
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (program_id, material_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`

function seedDefaults(): void {
  const stageCount = (db.prepare('SELECT COUNT(*) c FROM stages').get() as { c: number }).c
  if (stageCount === 0) {
    const ins = db.prepare('INSERT INTO stages (name, color, sort_order) VALUES (?, ?, ?)')
    ;[
      ['立项', '#8e8e93'],
      ['挑选素材', '#0a84ff'],
      ['确定素材', '#5e5ce6'],
      ['剪辑中', '#ff9f0a'],
      ['已发布', '#34c759']
    ].forEach((s, i) => ins.run(s[0], s[1], i))
  }
  const devCount = (db.prepare('SELECT COUNT(*) c FROM devices').get() as { c: number }).c
  if (devCount === 0) {
    const ins = db.prepare('INSERT INTO devices (name) VALUES (?)')
    ;['Pocket3', 'Action6', 'iPhone', 'Go3S'].forEach((n) => ins.run(n))
  }
}

/* ----------------------------- Folders ----------------------------- */

export function listFolders(): Folder[] {
  const rows = db
    .prepare(
      `SELECT f.*, (SELECT COUNT(*) FROM materials m WHERE m.folder_id = f.id AND m.status != 'deleted') AS count
       FROM folders f
       ORDER BY COALESCE(f.shoot_date, '') DESC, f.added_at DESC`
    )
    .all() as any[]
  return rows.map(mapFolder)
}

export function addFolder(f: {
  path: string
  name: string
  shootDate: string | null
  location: string | null
  category: string | null
  description: string | null
  device: string | null
}): number {
  const info = db
    .prepare(
      `INSERT INTO folders (path, name, shoot_date, location, category, description, device, added_at)
       VALUES (@path, @name, @shootDate, @location, @category, @description, @device, @addedAt)`
    )
    .run({ ...f, addedAt: Date.now() })
  return Number(info.lastInsertRowid)
}

export function updateFolder(
  id: number,
  patch: Partial<Pick<Folder, 'name' | 'shootDate' | 'location' | 'category' | 'description' | 'device'>>
): void {
  const cur = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as any
  if (!cur) return
  db.prepare(
    `UPDATE folders SET name=@name, shoot_date=@shootDate, location=@location,
     category=@category, description=@description, device=@device WHERE id=@id`
  ).run({
    id,
    name: patch.name ?? cur.name,
    shootDate: patch.shootDate ?? cur.shoot_date,
    location: patch.location ?? cur.location,
    category: patch.category ?? cur.category,
    description: patch.description ?? cur.description,
    device: patch.device ?? cur.device
  })
}

export function deleteFolder(id: number): void {
  db.prepare('DELETE FROM folders WHERE id = ?').run(id)
}

export function setFolderShootDateIfEmpty(id: number, date: string): void {
  db.prepare("UPDATE folders SET shoot_date = ? WHERE id = ? AND (shoot_date IS NULL OR shoot_date = '')").run(
    date,
    id
  )
}

function mapFolder(r: any): Folder {
  return {
    id: r.id,
    path: r.path,
    name: r.name,
    shootDate: r.shoot_date,
    location: r.location,
    category: r.category,
    description: r.description,
    device: r.device,
    addedAt: r.added_at,
    count: r.count
  }
}

/* ----------------------------- Materials ----------------------------- */

export function insertMaterialStub(folderId: number, path: string, fileName: string): number {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO materials (folder_id, path, file_name, status, added_at)
       VALUES (?, ?, ?, 'unused', ?)`
    )
    .run(folderId, path, fileName, Date.now())
  if (info.changes === 0) {
    const row = db.prepare('SELECT id FROM materials WHERE path = ?').get(path) as any
    return row.id
  }
  return Number(info.lastInsertRowid)
}

export function updateMaterialMeta(
  id: number,
  meta: {
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
): void {
  db.prepare(
    `UPDATE materials SET file_size=@fileSize, duration_sec=@durationSec, width=@width, height=@height,
     bitrate=@bitrate, format=@format, codec=@codec, shoot_at=@shootAt, period=@period, meta_ready=1
     WHERE id=@id`
  ).run({ id, ...meta })
}

export function updateMaterialThumb(id: number, thumbnailPath: string): void {
  db.prepare('UPDATE materials SET thumbnail_path=?, thumb_ready=1 WHERE id=?').run(thumbnailPath, id)
}

export function setMaterialStatus(ids: number[], status: MaterialStatus): void {
  const stmt = db.prepare('UPDATE materials SET status=? WHERE id=?')
  const tx = db.transaction((arr: number[]) => arr.forEach((id) => stmt.run(status, id)))
  tx(ids)
}

export function setClipType(ids: number[], type: ClipType | null): void {
  const stmt = db.prepare('UPDATE materials SET clip_type=? WHERE id=?')
  const tx = db.transaction((arr: number[]) => arr.forEach((id) => stmt.run(type, id)))
  tx(ids)
}

export function setAlias(ids: number[], alias: string | null): void {
  const v = alias && alias.trim() ? alias.trim() : null
  const stmt = db.prepare('UPDATE materials SET alias=? WHERE id=?')
  const tx = db.transaction((arr: number[]) => arr.forEach((id) => stmt.run(v, id)))
  tx(ids)
}

export function materialIdsInFolder(folderId: number): number[] {
  return (db.prepare('SELECT id FROM materials WHERE folder_id=?').all(folderId) as { id: number }[]).map(
    (r) => r.id
  )
}

// 重算 used/unused：被任意节目使用 → used，否则 unused（deleted 不动）
export function recomputeUsage(materialId: number): void {
  const used = (
    db.prepare('SELECT COUNT(*) c FROM program_materials WHERE material_id=?').get(materialId) as {
      c: number
    }
  ).c
  db.prepare("UPDATE materials SET status=? WHERE id=? AND status!='deleted'").run(
    used > 0 ? 'used' : 'unused',
    materialId
  )
}

export function materialsPendingMeta(folderId?: number): { id: number; path: string; fileName: string }[] {
  const sql = folderId
    ? 'SELECT id, path, file_name fileName FROM materials WHERE meta_ready=0 AND folder_id=?'
    : 'SELECT id, path, file_name fileName FROM materials WHERE meta_ready=0'
  return (folderId ? db.prepare(sql).all(folderId) : db.prepare(sql).all()) as any[]
}

export function materialsPendingThumb(folderId?: number): { id: number; path: string }[] {
  const sql = folderId
    ? 'SELECT id, path FROM materials WHERE thumb_ready=0 AND folder_id=?'
    : 'SELECT id, path FROM materials WHERE thumb_ready=0'
  return (folderId ? db.prepare(sql).all(folderId) : db.prepare(sql).all()) as any[]
}

export function listMaterials(filter: MaterialFilter): Material[] {
  const where: string[] = []
  const params: any[] = []

  if (filter.programId) {
    where.push('m.id IN (SELECT material_id FROM program_materials WHERE program_id = ?)')
    params.push(filter.programId)
  } else if (filter.folderId) {
    where.push('m.folder_id = ?')
    params.push(filter.folderId)
  }

  const statuses = filter.statuses && filter.statuses.length ? filter.statuses : ['unused', 'used']
  where.push(`m.status IN (${statuses.map(() => '?').join(',')})`)
  params.push(...statuses)

  if (filter.period) {
    where.push('m.period = ?')
    params.push(filter.period)
  }
  if (filter.dates && filter.dates.length) {
    where.push(`date(m.shoot_at/1000,'unixepoch','localtime') IN (${filter.dates.map(() => '?').join(',')})`)
    params.push(...filter.dates)
  }
  if (filter.devices && filter.devices.length) {
    where.push(`f.device IN (${filter.devices.map(() => '?').join(',')})`)
    params.push(...filter.devices)
  }
  if (filter.locations && filter.locations.length) {
    where.push(`f.location IN (${filter.locations.map(() => '?').join(',')})`)
    params.push(...filter.locations)
  }
  if (filter.tags && filter.tags.length) {
    where.push(
      `m.id IN (SELECT mt.material_id FROM material_tags mt JOIN tags t ON t.id=mt.tag_id WHERE t.name IN (${filter.tags
        .map(() => '?')
        .join(',')}))`
    )
    params.push(...filter.tags)
  }

  let orderBy = 'm.shoot_at ASC, m.file_name ASC'
  let join = 'JOIN folders f ON f.id = m.folder_id'
  let selectExtra = ''
  if (filter.programId && filter.sort === 'manual') {
    join += ' JOIN program_materials pm ON pm.material_id = m.id AND pm.program_id = ' + Number(filter.programId)
    selectExtra = ', pm.sort_order AS pm_order'
    orderBy = 'pm.sort_order ASC, m.shoot_at ASC'
  } else if (filter.programId) {
    // 节目维度时间排序仍需 join 以拿 sort_order 供 UI 显示
    join += ' LEFT JOIN program_materials pm ON pm.material_id = m.id AND pm.program_id = ' + Number(filter.programId)
    selectExtra = ', pm.sort_order AS pm_order'
  }

  const rows = db
    .prepare(
      `SELECT m.*, f.name AS folder_name${selectExtra}
       FROM materials m ${join}
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY ${orderBy}`
    )
    .all(...params) as any[]

  const mats = rows.map((r) => mapMaterial(r))
  // 节目维度：intro 始终置顶；手动排序时再把同别名素材聚拢成连续的组
  if (filter.programId) return orderProgramMaterials(mats, filter.sort === 'manual')
  return mats
}

// 节目列表归一化（幂等）：
// - intro 素材整体提到最前，保持彼此相对顺序
// - manual=true 时，非 intro 部分中 alias 非空且相同的素材聚成连续一段，
//   组的位置取其首个成员在当前顺序中的位置；alias 为空的素材各自独立
function orderProgramMaterials(mats: Material[], manual: boolean): Material[] {
  // 去重：每个素材在节目列表只保留一条
  const seen = new Set<number>()
  mats = mats.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
  const intro = mats.filter((m) => m.clipType === 'intro')
  const rest = mats.filter((m) => m.clipType !== 'intro')
  if (!manual) return [...intro, ...rest]

  // 先按 alias 收集各组成员（保持组内相对顺序）
  const groups = new Map<string, Material[]>()
  for (const m of rest) {
    const alias = m.alias && m.alias.trim() ? m.alias : null
    if (!alias) continue
    const g = groups.get(alias)
    if (g) g.push(m)
    else groups.set(alias, [m])
  }
  // 再按 rest 的原顺序输出：组在其首个成员位置整体展开，未分组素材原位保留
  const emitted = new Set<string>()
  const result: Material[] = []
  for (const m of rest) {
    const alias = m.alias && m.alias.trim() ? m.alias : null
    if (!alias) {
      result.push(m)
    } else if (!emitted.has(alias)) {
      emitted.add(alias)
      result.push(...groups.get(alias)!)
    }
  }
  return [...intro, ...result]
}

export function getMaterial(id: number): Material | null {
  const r = db
    .prepare('SELECT m.*, f.name AS folder_name FROM materials m JOIN folders f ON f.id=m.folder_id WHERE m.id=?')
    .get(id) as any
  return r ? mapMaterial(r) : null
}

function mapMaterial(r: any): Material {
  return {
    id: r.id,
    folderId: r.folder_id,
    folderName: r.folder_name,
    path: r.path,
    fileName: r.file_name,
    fileSize: r.file_size,
    durationSec: r.duration_sec,
    width: r.width,
    height: r.height,
    bitrate: r.bitrate,
    format: r.format,
    codec: r.codec,
    thumbnailPath: r.thumbnail_path,
    shootAt: r.shoot_at,
    period: r.period,
    status: r.status,
    clipType: r.clip_type ?? null,
    alias: r.alias ?? null,
    addedAt: r.added_at,
    metaReady: r.meta_ready,
    thumbReady: r.thumb_ready,
    tags: tagsForMaterial(r.id),
    usedByPrograms: programsForMaterial(r.id)
  }
}

function tagsForMaterial(materialId: number): string[] {
  return (
    db
      .prepare(
        'SELECT t.name FROM tags t JOIN material_tags mt ON mt.tag_id=t.id WHERE mt.material_id=? ORDER BY t.name'
      )
      .all(materialId) as any[]
  ).map((r) => r.name)
}

function programsForMaterial(materialId: number): { id: number; name: string }[] {
  return db
    .prepare(
      'SELECT p.id, p.name FROM programs p JOIN program_materials pm ON pm.program_id=p.id WHERE pm.material_id=?'
    )
    .all(materialId) as any[]
}

/* ----------------------------- Tags ----------------------------- */

export function listTags(): Tag[] {
  return db
    .prepare(
      `SELECT t.id, t.name, (SELECT COUNT(*) FROM material_tags mt WHERE mt.tag_id=t.id) AS count
       FROM tags t ORDER BY t.name`
    )
    .all() as Tag[]
}

export function createTag(name: string): number {
  const info = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name)
  if (info.changes === 0) return (db.prepare('SELECT id FROM tags WHERE name=?').get(name) as any).id
  return Number(info.lastInsertRowid)
}

export function renameTag(id: number, name: string): void {
  db.prepare('UPDATE tags SET name=? WHERE id=?').run(name, id)
}

export function deleteTag(id: number): void {
  db.prepare('DELETE FROM tags WHERE id=?').run(id)
}

export function assignTag(materialIds: number[], tagName: string): void {
  const tagId = createTag(tagName)
  const stmt = db.prepare('INSERT OR IGNORE INTO material_tags (material_id, tag_id) VALUES (?, ?)')
  const tx = db.transaction((ids: number[]) => ids.forEach((id) => stmt.run(id, tagId)))
  tx(materialIds)
}

export function unassignTag(materialId: number, tagName: string): void {
  db.prepare(
    'DELETE FROM material_tags WHERE material_id=? AND tag_id=(SELECT id FROM tags WHERE name=?)'
  ).run(materialId, tagName)
}

/* ----------------------------- Stages ----------------------------- */

export function listStages(): Stage[] {
  return (
    db
      .prepare(
        `SELECT s.id, s.name, s.color, s.sort_order AS sortOrder,
         (SELECT COUNT(*) FROM programs p WHERE p.stage_id=s.id) AS count
         FROM stages s ORDER BY s.sort_order`
      )
      .all() as any[]
  ).map((r) => r as Stage)
}

export function createStage(name: string, color: string): number {
  const max = (db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM stages').get() as any).m
  const info = db.prepare('INSERT INTO stages (name, color, sort_order) VALUES (?, ?, ?)').run(name, color, max + 1)
  return Number(info.lastInsertRowid)
}

export function updateStage(id: number, patch: { name?: string; color?: string }): void {
  const cur = db.prepare('SELECT * FROM stages WHERE id=?').get(id) as any
  if (!cur) return
  db.prepare('UPDATE stages SET name=?, color=? WHERE id=?').run(
    patch.name ?? cur.name,
    patch.color ?? cur.color,
    id
  )
}

export function deleteStage(id: number): void {
  db.prepare('DELETE FROM stages WHERE id=?').run(id)
}

export function reorderStages(ids: number[]): void {
  const stmt = db.prepare('UPDATE stages SET sort_order=? WHERE id=?')
  const tx = db.transaction((arr: number[]) => arr.forEach((id, i) => stmt.run(i, id)))
  tx(ids)
}

/* ----------------------------- Programs ----------------------------- */

export function listPrograms(): Program[] {
  return (
    db
      .prepare(
        `SELECT p.id, p.name, p.stage_id AS stageId, p.output_dir AS outputDir, p.created_at AS createdAt,
         s.name AS stageName, s.color AS stageColor, s.sort_order AS stageOrder
         FROM programs p LEFT JOIN stages s ON s.id=p.stage_id
         ORDER BY COALESCE(s.sort_order, 999) ASC, p.created_at ASC`
      )
      .all() as any[]
  ).map((r) => r as Program)
}

export function createProgram(name: string): number {
  const firstStage = db.prepare('SELECT id FROM stages ORDER BY sort_order LIMIT 1').get() as any
  const info = db
    .prepare('INSERT INTO programs (name, stage_id, created_at) VALUES (?, ?, ?)')
    .run(name, firstStage ? firstStage.id : null, Date.now())
  return Number(info.lastInsertRowid)
}

export function updateProgram(id: number, patch: { name?: string; stageId?: number; outputDir?: string }): void {
  const cur = db.prepare('SELECT * FROM programs WHERE id=?').get(id) as any
  if (!cur) return
  db.prepare('UPDATE programs SET name=?, stage_id=?, output_dir=? WHERE id=?').run(
    patch.name ?? cur.name,
    patch.stageId ?? cur.stage_id,
    patch.outputDir ?? cur.output_dir,
    id
  )
}

export function deleteProgram(id: number): void {
  const mats = db.prepare('SELECT material_id FROM program_materials WHERE program_id=?').all(id) as any[]
  db.prepare('DELETE FROM programs WHERE id=?').run(id)
  mats.forEach((m) => recomputeUsage(m.material_id))
}

export function addMaterialToProgram(programId: number, materialId: number): void {
  const max = (
    db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM program_materials WHERE program_id=?').get(programId) as any
  ).m
  db.prepare(
    'INSERT OR IGNORE INTO program_materials (program_id, material_id, sort_order, added_at) VALUES (?, ?, ?, ?)'
  ).run(programId, materialId, max + 1, Date.now())
  recomputeUsage(materialId)
}

export function removeMaterialFromProgram(programId: number, materialId: number): void {
  db.prepare('DELETE FROM program_materials WHERE program_id=? AND material_id=?').run(programId, materialId)
  recomputeUsage(materialId)
}

export function reorderProgramMaterials(programId: number, materialIds: number[]): void {
  const stmt = db.prepare('UPDATE program_materials SET sort_order=? WHERE program_id=? AND material_id=?')
  const tx = db.transaction((arr: number[]) => arr.forEach((mid, i) => stmt.run(i, programId, mid)))
  tx(materialIds)
}

// 拷贝时取的有序素材（手动优先，否则时间）
export function programOrderedMaterials(programId: number): Material[] {
  return listMaterials({ programId, statuses: ['unused', 'used'], sort: 'manual' })
}

/* ----------------------------- Devices ----------------------------- */

export function listDevices(): Device[] {
  return db
    .prepare(
      `SELECT d.id, d.name, (SELECT COUNT(*) FROM folders f WHERE f.device=d.name) AS count
       FROM devices d ORDER BY d.name`
    )
    .all() as Device[]
}

export function createDevice(name: string): number {
  const info = db.prepare('INSERT OR IGNORE INTO devices (name) VALUES (?)').run(name)
  if (info.changes === 0) return (db.prepare('SELECT id FROM devices WHERE name=?').get(name) as any).id
  return Number(info.lastInsertRowid)
}

export function renameDevice(id: number, name: string): void {
  const cur = db.prepare('SELECT name FROM devices WHERE id=?').get(id) as any
  if (!cur) return
  const tx = db.transaction(() => {
    db.prepare('UPDATE folders SET device=? WHERE device=?').run(name, cur.name)
    db.prepare('UPDATE devices SET name=? WHERE id=?').run(name, id)
  })
  tx()
}

export function deleteDevice(id: number): void {
  db.prepare('DELETE FROM devices WHERE id=?').run(id)
}

/* ----------------------------- Filter options ----------------------------- */

export function distinctDates(): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT date(shoot_at/1000,'unixepoch','localtime') d
         FROM materials WHERE shoot_at IS NOT NULL ORDER BY d DESC`
      )
      .all() as any[]
  ).map((r) => r.d)
}

export function distinctLocations(): string[] {
  return (
    db.prepare("SELECT DISTINCT location l FROM folders WHERE location IS NOT NULL AND location != ''").all() as any[]
  ).map((r) => r.l)
}

/* ----------------------------- Settings ----------------------------- */

export function getSetting(key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as any
  return r ? r.value : null
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?').run(
    key,
    value,
    value
  )
}
