import { create } from 'zustand'
import {
  Folder,
  Material,
  MaterialFilter,
  MaterialStatus,
  ClipType,
  Period,
  Program,
  Stage,
  Tag,
  Device
} from '../../shared/types'

const api = window.api

export interface Filters {
  statuses: MaterialStatus[]
  period: Period | 'all'
  dates: string[]
  devices: string[]
  locations: string[]
  tags: string[]
}

interface AppState {
  folders: Folder[]
  programs: Program[]
  tags: Tag[]
  stages: Stage[]
  devices: Device[]
  dateOptions: string[]
  locationOptions: string[]

  view: { type: 'folder' | 'program' | null; id: number | null }
  activeProgram: { id: number; name: string } | null
  materials: Material[]
  loading: boolean

  filters: Filters
  viewMode: 'grid' | 'list'
  programSort: 'manual' | 'time'

  selection: Set<number>
  preview: { open: boolean; index: number }
  settingsOpen: boolean
  importProgress: Record<number, { phase: string; total: number; metaDone: number; thumbDone: number }>

  // actions
  bootstrap: () => Promise<void>
  refreshSidebar: () => Promise<void>
  refreshOptions: () => Promise<void>
  openFolder: (id: number | null) => Promise<void>
  openProgram: (id: number) => Promise<void>
  reloadMaterials: () => Promise<void>
  toggleProgramUse: (materialId: number) => Promise<void>
  setProgramUse: (materialId: number, use: boolean) => Promise<void>
  setMaterialStatusLocal: (ids: number[], status: MaterialStatus) => Promise<void>
  setClipTypeLocal: (ids: number[], type: ClipType | null) => Promise<void>
  setAliasLocal: (ids: number[], alias: string | null) => Promise<void>
  setFilters: (patch: Partial<Filters>) => void
  setViewMode: (m: 'grid' | 'list') => void
  setProgramSort: (s: 'manual' | 'time') => void

  toggleSelect: (id: number, additive: boolean) => void
  setSelection: (ids: number[]) => void
  clearSelection: () => void
  addToProgram: (programId: number, ids: number[]) => Promise<number>
  removeFromProgram: (ids: number[]) => Promise<void>

  openPreviewAt: (index: number) => void
  closePreview: () => void
  movePreview: (delta: number) => void

  setSettingsOpen: (open: boolean) => void
}

function buildFilter(state: AppState): MaterialFilter {
  const f = state.filters
  return {
    folderId: state.view.type === 'folder' ? state.view.id : null,
    programId: state.view.type === 'program' ? state.view.id : null,
    statuses: f.statuses,
    period: f.period === 'all' ? null : f.period,
    dates: f.dates,
    devices: f.devices,
    locations: f.locations,
    tags: f.tags,
    sort: state.view.type === 'program' ? state.programSort : 'time'
  }
}

export const useStore = create<AppState>((set, get) => ({
  folders: [],
  programs: [],
  tags: [],
  stages: [],
  devices: [],
  dateOptions: [],
  locationOptions: [],

  view: { type: null, id: null },
  activeProgram: null,
  materials: [],
  loading: false,

  filters: { statuses: ['unused', 'used'], period: 'all', dates: [], devices: [], locations: [], tags: [] },
  viewMode: 'grid',
  programSort: 'manual',

  selection: new Set(),
  preview: { open: false, index: 0 },
  settingsOpen: false,
  importProgress: {},

  bootstrap: async () => {
    await get().refreshSidebar()
    await get().refreshOptions()
    // 恢复上次浏览
    const last = await api.getSetting('lastView')
    if (last) {
      try {
        const v = JSON.parse(last) as { type: 'folder' | 'program'; id: number }
        if (v.type === 'folder') await get().openFolder(v.id)
        else if (v.type === 'program') await get().openProgram(v.id)
        return
      } catch {
        /* ignore */
      }
    }
    // 默认打开第一个文件夹
    const folders = get().folders
    if (folders.length) await get().openFolder(folders[0].id)
  },

  refreshSidebar: async () => {
    const [folders, programs, tags, stages, devices] = await Promise.all([
      api.listFolders(),
      api.listPrograms(),
      api.listTags(),
      api.listStages(),
      api.listDevices()
    ])
    set({ folders, programs, tags, stages, devices })
  },

  refreshOptions: async () => {
    const [dateOptions, locationOptions] = await Promise.all([api.filterDates(), api.filterLocations()])
    set({ dateOptions, locationOptions })
  },

  openFolder: async (id) => {
    set({ view: { type: 'folder', id }, selection: new Set() })
    await get().reloadMaterials()
    if (id) void api.setSetting('lastView', JSON.stringify({ type: 'folder', id }))
  },

  openProgram: async (id) => {
    const p = get().programs.find((x) => x.id === id)
    set({
      view: { type: 'program', id },
      activeProgram: p ? { id, name: p.name } : { id, name: '' },
      viewMode: 'list',
      selection: new Set()
    })
    await get().reloadMaterials()
    void api.setSetting('lastView', JSON.stringify({ type: 'program', id }))
  },

  // 选用 / 放弃：在节目视图里放弃→从节目移除；在文件夹视图里对活动节目切换选用
  toggleProgramUse: async (materialId) => {
    const { view, activeProgram, materials } = get()
    if (view.type === 'program' && view.id) {
      await api.removeMaterialFromProgram(view.id, materialId)
    } else if (activeProgram) {
      const m = materials.find((x) => x.id === materialId)
      const already = m?.usedByPrograms.some((p) => p.id === activeProgram.id)
      if (already) await api.removeMaterialFromProgram(activeProgram.id, materialId)
      else await api.addMaterialToProgram(activeProgram.id, materialId)
    } else {
      return
    }
    await get().refreshSidebar()
    await get().reloadMaterials()
  },

  setProgramUse: async (materialId, use) => {
    const { view, activeProgram } = get()
    const programId = view.type === 'program' ? view.id : activeProgram?.id
    if (!programId) return
    if (use) await api.addMaterialToProgram(programId, materialId)
    else await api.removeMaterialFromProgram(programId, materialId)
    await get().refreshSidebar()
    await get().reloadMaterials()
  },

  // 批量加入节目：跳过已在该节目中的素材（拖放时不小心带上的会被忽略）。返回实际新增数。
  addToProgram: async (programId, ids) => {
    const mats = get().materials
    const toAdd = ids.filter((id) => {
      const m = mats.find((x) => x.id === id)
      return m && !m.usedByPrograms.some((p) => p.id === programId)
    })
    for (const id of toAdd) await api.addMaterialToProgram(programId, id)
    if (toAdd.length) {
      await get().refreshSidebar()
      await get().reloadMaterials()
    }
    return toAdd.length
  },

  // 从当前节目批量移除选中素材（仅在节目视图有效）
  removeFromProgram: async (ids) => {
    const { view } = get()
    if (view.type !== 'program' || !view.id) return
    for (const id of ids) await api.removeMaterialFromProgram(view.id, id)
    await get().refreshSidebar()
    await get().reloadMaterials()
    get().clearSelection()
  },

  setMaterialStatusLocal: async (ids, status) => {
    await api.setMaterialStatus(ids, status)
    await get().refreshSidebar()
    await get().reloadMaterials()
  },

  setClipTypeLocal: async (ids, type) => {
    await api.setClipType(ids, type)
    await get().reloadMaterials()
  },

  setAliasLocal: async (ids, alias) => {
    await api.setAlias(ids, alias)
    await get().reloadMaterials()
  },

  reloadMaterials: async () => {
    const state = get()
    if (state.view.type === null) return
    set({ loading: true })
    // 导入进行中时忽略筛选项，实时看到素材进来
    const importing =
      state.view.type === 'folder' &&
      Object.entries(state.importProgress).some(
        ([fid, p]) => p.phase !== 'done' && (state.view.id === null || Number(fid) === state.view.id)
      )
    const filter = importing
      ? {
          folderId: state.view.id,
          programId: null,
          statuses: ['unused', 'used'] as never,
          period: null,
          dates: [],
          devices: [],
          locations: [],
          tags: [],
          sort: 'time' as const
        }
      : buildFilter(state)
    const materials = await api.listMaterials(filter)
    set({ materials, loading: false })
  },

  setFilters: (patch) => {
    set({ filters: { ...get().filters, ...patch } })
    void get().reloadMaterials()
  },

  setViewMode: (m) => set({ viewMode: m }),
  setProgramSort: (s) => {
    set({ programSort: s })
    void get().reloadMaterials()
  },

  toggleSelect: (id, additive) => {
    const sel = new Set(get().selection)
    if (additive) {
      sel.has(id) ? sel.delete(id) : sel.add(id)
    } else {
      sel.clear()
      sel.add(id)
    }
    set({ selection: sel })
  },
  setSelection: (ids) => set({ selection: new Set(ids) }),
  clearSelection: () => set({ selection: new Set() }),

  openPreviewAt: (index) => set({ preview: { open: true, index } }),
  closePreview: () => set({ preview: { open: false, index: 0 } }),
  movePreview: (delta) => {
    const { preview, materials } = get()
    let i = preview.index + delta
    if (i < 0) i = 0
    if (i > materials.length - 1) i = materials.length - 1
    set({ preview: { open: true, index: i } })
  },

  setSettingsOpen: (open) => set({ settingsOpen: open })
}))
