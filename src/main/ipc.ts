import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { existsSync, promises as fsp } from 'fs'
import { join } from 'path'
import * as dbm from './db'
import { importFolder, processFolder } from './importer'
import { probeFps, probeStartTimecode } from './media'
import { reconcile as previewReconcile, resume as previewResume } from './preview'
import { buildFcpxml } from './fcpxml'
import { thumbnailsDir } from './paths'
import { ClipType, MaterialFilter, MaterialStatus } from '../shared/types'

export function registerIpc(): void {
  /* dialogs */
  ipcMain.handle('dialog:selectFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()!
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  /* folders */
  ipcMain.handle('folders:list', () => dbm.listFolders())
  // 返回路径已失效（移动硬盘拔出 / 改名 / 移动 / 删除）的文件夹 id
  ipcMain.handle('folders:missing', () =>
    dbm
      .listFolders()
      .filter((f) => !existsSync(f.path))
      .map((f) => f.id)
  )
  ipcMain.handle('folders:import', (_e, opts) => importFolder(opts))
  ipcMain.handle('folders:update', (_e, id: number, patch) => {
    dbm.updateFolder(id, patch)
    return dbm.listFolders()
  })
  ipcMain.handle('folders:delete', async (_e, id: number) => {
    // 先取该文件夹的素材 id，删库后顺带删掉缩略图文件，释放磁盘
    const ids = dbm.materialIdsInFolder(id)
    dbm.deleteFolder(id)
    const dir = thumbnailsDir()
    for (const mid of ids) {
      try {
        await fsp.unlink(join(dir, `${mid}.jpg`))
      } catch {
        /* 文件可能不存在，忽略 */
      }
    }
    return dbm.listFolders()
  })
  ipcMain.handle('folders:rescan', async (_e, id: number) => {
    void processFolder(id)
    return true
  })

  /* materials */
  ipcMain.handle('materials:list', (_e, filter: MaterialFilter) => dbm.listMaterials(filter))
  ipcMain.handle('materials:get', (_e, id: number) => dbm.getMaterial(id))
  ipcMain.handle('materials:setStatus', (_e, ids: number[], status: MaterialStatus) => {
    dbm.setMaterialStatus(ids, status)
    // 若恢复，需要根据是否被节目使用重算
    if (status === 'unused') ids.forEach((id) => dbm.recomputeUsage(id))
    return true
  })
  ipcMain.handle('materials:setClipType', (_e, ids: number[], type: ClipType | null) => {
    dbm.setClipType(ids, type)
    return true
  })
  ipcMain.handle('materials:setAlias', (_e, ids: number[], alias: string | null) => {
    dbm.setAlias(ids, alias)
    return true
  })

  /* tags */
  ipcMain.handle('tags:list', () => dbm.listTags())
  ipcMain.handle('tags:create', (_e, name: string) => dbm.createTag(name))
  ipcMain.handle('tags:rename', (_e, id: number, name: string) => {
    dbm.renameTag(id, name)
    return dbm.listTags()
  })
  ipcMain.handle('tags:delete', (_e, id: number) => {
    dbm.deleteTag(id)
    return dbm.listTags()
  })
  ipcMain.handle('tags:assign', (_e, materialIds: number[], name: string) => {
    dbm.assignTag(materialIds, name)
    return true
  })
  ipcMain.handle('tags:unassign', (_e, materialId: number, name: string) => {
    dbm.unassignTag(materialId, name)
    return true
  })

  /* stages */
  ipcMain.handle('stages:list', () => dbm.listStages())
  ipcMain.handle('stages:create', (_e, name: string, color: string) => {
    dbm.createStage(name, color)
    return dbm.listStages()
  })
  ipcMain.handle('stages:update', (_e, id: number, patch) => {
    dbm.updateStage(id, patch)
    return dbm.listStages()
  })
  ipcMain.handle('stages:delete', (_e, id: number) => {
    dbm.deleteStage(id)
    return dbm.listStages()
  })
  ipcMain.handle('stages:reorder', (_e, ids: number[]) => {
    dbm.reorderStages(ids)
    return dbm.listStages()
  })

  /* programs */
  ipcMain.handle('programs:list', () => dbm.listPrograms())
  ipcMain.handle('programs:create', (_e, name: string) => {
    dbm.createProgram(name)
    return dbm.listPrograms()
  })
  ipcMain.handle('programs:update', (_e, id: number, patch) => {
    dbm.updateProgram(id, patch)
    return dbm.listPrograms()
  })
  ipcMain.handle('programs:delete', (_e, id: number) => {
    dbm.deleteProgram(id)
    return dbm.listPrograms()
  })
  ipcMain.handle('programs:addMaterial', (_e, programId: number, materialId: number) => {
    dbm.addMaterialToProgram(programId, materialId)
    return true
  })
  ipcMain.handle('programs:removeMaterial', (_e, programId: number, materialId: number) => {
    dbm.removeMaterialFromProgram(programId, materialId)
    return true
  })
  ipcMain.handle('programs:reorder', (_e, programId: number, ids: number[]) => {
    dbm.reorderProgramMaterials(programId, ids)
    return true
  })

  // 按当前节目排序导出 Final Cut Pro 可用的 fcpxml（FCP / DaVinci Resolve 均可导入）
  ipcMain.handle('programs:exportFcpxml', async (_e, programId: number) => {
    const win = BrowserWindow.getFocusedWindow()!
    const program = dbm.listPrograms().find((p) => p.id === programId)
    if (!program) throw new Error('节目不存在')
    const mats = dbm.programOrderedMaterials(programId)
    if (!mats.length) return { canceled: false, empty: true }

    // 导出前校验每个源文件仍可访问，发现失效（硬盘拔出 / 移动 / 删除）即中止
    const missing = mats.filter((m) => !existsSync(m.path)).map((m) => m.fileName)
    if (missing.length) return { canceled: false, missing }

    const safeName = program.name.replace(/[/\\:*?"<>|]/g, '_')
    const res = await dialog.showSaveDialog(win, {
      title: '导出 FCPXML',
      defaultPath: `${safeName}.fcpxml`,
      filters: [{ name: 'Final Cut Pro XML', extensions: ['fcpxml'] }]
    })
    if (res.canceled || !res.filePath) return { canceled: true }

    // 逐条探测帧率与源时间码（节目素材数量有限，开销可接受）
    const clips = []
    for (const m of mats) {
      const fps = await probeFps(m.path)
      const startTime = await probeStartTimecode(m.path, fps)
      clips.push({ material: m, fps, startTime })
    }
    const xml = buildFcpxml(program.name, clips)
    await fsp.writeFile(res.filePath, xml, 'utf8')
    dbm.updateProgram(programId, { outputDir: res.filePath })
    shell.showItemInFolder(res.filePath)
    return { canceled: false, path: res.filePath, count: mats.length }
  })

  /* devices */
  ipcMain.handle('devices:list', () => dbm.listDevices())
  ipcMain.handle('devices:create', (_e, name: string) => {
    dbm.createDevice(name)
    return dbm.listDevices()
  })
  ipcMain.handle('devices:rename', (_e, id: number, name: string) => {
    dbm.renameDevice(id, name)
    return dbm.listDevices()
  })
  ipcMain.handle('devices:delete', (_e, id: number) => {
    dbm.deleteDevice(id)
    return dbm.listDevices()
  })

  /* filter options */
  ipcMain.handle('filters:dates', () => dbm.distinctDates())
  ipcMain.handle('filters:locations', () => dbm.distinctLocations())

  /* preview transcode cache：分段转码 + 预取下一条 */
  ipcMain.handle('preview:prepare', (_e, currentPath: string | null, nextPaths: string[]) => {
    previewReconcile(currentPath, nextPaths)
  })
  ipcMain.handle('preview:resume', (_e, path: string) => {
    previewResume(path)
  })

  /* settings */
  ipcMain.handle('settings:get', (_e, key: string) => dbm.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    dbm.setSetting(key, value)
    return true
  })
}
