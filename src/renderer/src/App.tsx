import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { FilterBar } from './components/FilterBar'
import { Grid } from './components/Grid'
import { List } from './components/List'
import { Preview } from './components/Preview'
import { Settings } from './components/Settings'

export default function App(): JSX.Element {
  const view = useStore((s) => s.view)
  const viewMode = useStore((s) => s.viewMode)
  const preview = useStore((s) => s.preview)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const folders = useStore((s) => s.folders)
  const missingFolders = useStore((s) => s.missingFolders)
  const brokenFolder =
    view.type === 'folder' && view.id !== null && missingFolders.has(view.id)
      ? (folders.find((f) => f.id === view.id) ?? null)
      : null

  useEffect(() => {
    void useStore.getState().bootstrap()

    const offProgress = window.api.onImportProgress((p) => {
      const pr = p as { folderId: number; phase: string; total: number; metaDone: number; thumbDone: number }
      useStore.setState((s) => ({ importProgress: { ...s.importProgress, [pr.folderId]: pr } }))
    })
    const offChanged = window.api.onMaterialsChanged((p) => {
      const pr = p as { folderId: number }
      const v = useStore.getState().view
      // 当前正浏览受影响的文件夹（或全部素材）时刷新
      if (v.type === 'folder' && (v.id === null || v.id === pr.folderId)) {
        void useStore.getState().reloadMaterials()
      }
      void useStore.getState().refreshSidebar()
      void useStore.getState().refreshOptions()
    })

    return () => {
      offProgress()
      offChanged()
    }
  }, [])

  return (
    <div className="h-full flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Toolbar />
        {view.type !== null && <FilterBar />}
        {brokenFolder && (
          <div className="flex items-start gap-2 px-4 py-[10px] bg-[#fff4e5] border-b-[0.5px] border-[#f0d9b0] text-[12px] text-[#8a5a00]">
            <span className="text-[14px] leading-none mt-[1px]">⛓️‍💥</span>
            <div>
              <div className="font-semibold">「{brokenFolder.name}」的素材当前无法访问</div>
              <div className="text-[#9a6a1a] mt-[2px]">
                该文件夹所在设备可能已断开（移动硬盘拔出），或文件夹被移动、改名、删除。请重新连接设备或恢复路径后再浏览；缩略图仍可查看，但预览与导出将不可用。
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {view.type === null ? (
            <div className="text-[var(--text3)] text-sm text-center pt-32">在左侧选择文件夹或节目浏览素材</div>
          ) : viewMode === 'grid' ? (
            <Grid />
          ) : (
            <List />
          )}
        </div>
      </div>

      {preview.open && <Preview />}
      {settingsOpen && <Settings />}
    </div>
  )
}
