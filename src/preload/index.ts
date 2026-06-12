import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

const api = {
  // dialogs
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  // folders
  listFolders: () => ipcRenderer.invoke('folders:list'),
  importFolder: (opts: unknown) => ipcRenderer.invoke('folders:import', opts),
  updateFolder: (id: number, patch: unknown) => ipcRenderer.invoke('folders:update', id, patch),
  deleteFolder: (id: number) => ipcRenderer.invoke('folders:delete', id),
  rescanFolder: (id: number) => ipcRenderer.invoke('folders:rescan', id),

  // materials
  listMaterials: (filter: unknown) => ipcRenderer.invoke('materials:list', filter),
  getMaterial: (id: number) => ipcRenderer.invoke('materials:get', id),
  setMaterialStatus: (ids: number[], status: string) =>
    ipcRenderer.invoke('materials:setStatus', ids, status),
  setClipType: (ids: number[], type: string | null) =>
    ipcRenderer.invoke('materials:setClipType', ids, type),
  setAlias: (ids: number[], alias: string | null) => ipcRenderer.invoke('materials:setAlias', ids, alias),

  // tags
  listTags: () => ipcRenderer.invoke('tags:list'),
  createTag: (name: string) => ipcRenderer.invoke('tags:create', name),
  renameTag: (id: number, name: string) => ipcRenderer.invoke('tags:rename', id, name),
  deleteTag: (id: number) => ipcRenderer.invoke('tags:delete', id),
  assignTag: (materialIds: number[], name: string) => ipcRenderer.invoke('tags:assign', materialIds, name),
  unassignTag: (materialId: number, name: string) => ipcRenderer.invoke('tags:unassign', materialId, name),

  // stages
  listStages: () => ipcRenderer.invoke('stages:list'),
  createStage: (name: string, color: string) => ipcRenderer.invoke('stages:create', name, color),
  updateStage: (id: number, patch: unknown) => ipcRenderer.invoke('stages:update', id, patch),
  deleteStage: (id: number) => ipcRenderer.invoke('stages:delete', id),
  reorderStages: (ids: number[]) => ipcRenderer.invoke('stages:reorder', ids),

  // programs
  listPrograms: () => ipcRenderer.invoke('programs:list'),
  createProgram: (name: string) => ipcRenderer.invoke('programs:create', name),
  updateProgram: (id: number, patch: unknown) => ipcRenderer.invoke('programs:update', id, patch),
  deleteProgram: (id: number) => ipcRenderer.invoke('programs:delete', id),
  addMaterialToProgram: (programId: number, materialId: number) =>
    ipcRenderer.invoke('programs:addMaterial', programId, materialId),
  removeMaterialFromProgram: (programId: number, materialId: number) =>
    ipcRenderer.invoke('programs:removeMaterial', programId, materialId),
  reorderProgram: (programId: number, ids: number[]) =>
    ipcRenderer.invoke('programs:reorder', programId, ids),
  exportFcpxml: (programId: number) => ipcRenderer.invoke('programs:exportFcpxml', programId),

  // devices
  listDevices: () => ipcRenderer.invoke('devices:list'),
  createDevice: (name: string) => ipcRenderer.invoke('devices:create', name),
  renameDevice: (id: number, name: string) => ipcRenderer.invoke('devices:rename', id, name),
  deleteDevice: (id: number) => ipcRenderer.invoke('devices:delete', id),

  // filter options
  filterDates: () => ipcRenderer.invoke('filters:dates'),
  filterLocations: () => ipcRenderer.invoke('filters:locations'),

  // settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),

  // preview transcode cache：分段转码 + 预取下一条
  previewPrepare: (currentPath: string | null, nextPaths: string[]) =>
    ipcRenderer.invoke('preview:prepare', currentPath, nextPaths),
  previewResume: (path: string) => ipcRenderer.invoke('preview:resume', path),

  // events
  onImportProgress: (cb: (p: unknown) => void) => {
    const fn = (_e: IpcRendererEvent, p: unknown): void => cb(p)
    ipcRenderer.on('import:progress', fn)
    return () => ipcRenderer.removeListener('import:progress', fn)
  },
  onMaterialsChanged: (cb: (p: unknown) => void) => {
    const fn = (_e: IpcRendererEvent, p: unknown): void => cb(p)
    ipcRenderer.on('materials:changed', fn)
    return () => ipcRenderer.removeListener('materials:changed', fn)
  },
  onCopyProgress: (cb: (p: unknown) => void) => {
    const fn = (_e: IpcRendererEvent, p: unknown): void => cb(p)
    ipcRenderer.on('copy:progress', fn)
    return () => ipcRenderer.removeListener('copy:progress', fn)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
