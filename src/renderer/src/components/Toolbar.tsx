import { useState } from 'react'
import { useStore } from '../store'

const api = window.api

export function Toolbar(): JSX.Element {
  const view = useStore((s) => s.view)
  const folders = useStore((s) => s.folders)
  const programs = useStore((s) => s.programs)
  const viewMode = useStore((s) => s.viewMode)
  const programSort = useStore((s) => s.programSort)
  const [exporting, setExporting] = useState(false)

  const folder = view.type === 'folder' && view.id ? folders.find((f) => f.id === view.id) : null
  const program = view.type === 'program' ? programs.find((p) => p.id === view.id) : null
  const title =
    view.type === 'folder' ? (view.id === null ? '全部素材' : (folder?.name ?? '')) : `🎬 ${program?.name ?? ''}`

  const doExport = async (): Promise<void> => {
    if (!program) return
    setExporting(true)
    try {
      const res = (await api.exportFcpxml(program.id)) as {
        canceled?: boolean
        empty?: boolean
        path?: string
        count?: number
      }
      if (res.empty) {
        alert('当前节目还没有素材可导出')
      } else if (!res.canceled) {
        alert(`已按当前排序导出 ${res.count} 个素材到：\n${res.path}\n\n可在 Final Cut Pro 或 DaVinci Resolve 中导入。`)
        await useStore.getState().refreshSidebar()
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="min-h-[52px] flex-shrink-0 border-b-[0.5px] border-[var(--line)] flex items-center gap-[10px] px-4 py-2 bg-[rgba(245,245,247,0.7)] flex-wrap">
      <div className="text-[15px] font-semibold flex items-center gap-[10px]">
        <span>{title}</span>
        {folder && (
          <div className="text-xs font-medium text-[var(--text3)] flex gap-[10px] items-center">
            {folder.device && (
              <span className="text-white bg-[#5856d6] px-2 py-[2px] rounded-md text-[11px] font-semibold">
                📷 {folder.device}
              </span>
            )}
            {folder.shootDate && <span>📅 {folder.shootDate}</span>}
            {folder.location && <span>📍 {folder.location}</span>}
            {folder.category && <span>{folder.category}</span>}
          </div>
        )}
        {program && (
          <div className="flex items-center gap-[10px]">
            <span
              style={{ background: program.stageColor ?? '#8e8e93' }}
              className="text-[10px] px-[6px] py-[1px] rounded-md text-white font-medium"
            >
              {program.stageName}
            </span>
            <Seg
              value={programSort}
              options={[
                ['manual', '手动排序'],
                ['time', '时间排序']
              ]}
              onChange={(v) => useStore.getState().setProgramSort(v as 'manual' | 'time')}
            />
            <button
              onClick={doExport}
              disabled={exporting}
              title="按当前排序导出 fcpxml，供 Final Cut Pro / DaVinci Resolve 导入"
              className="bg-accent text-white rounded-[7px] px-[13px] py-[6px] text-xs font-medium flex items-center gap-[6px] disabled:opacity-50"
            >
              ⤓ {exporting ? '导出中…' : '导出 FCPXML'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1" />

      <Seg
        value={viewMode}
        options={[
          ['grid', '▦ 大图'],
          ['list', '☰ 列表']
        ]}
        onChange={(v) => useStore.getState().setViewMode(v as 'grid' | 'list')}
      />
    </div>
  )
}

function Seg({
  value,
  options,
  onChange
}: {
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="flex bg-[#f1f1f3] rounded-[7px] border-[0.5px] border-[var(--line)] overflow-hidden">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-[11px] py-[5px] text-xs ${
            value === v ? 'bg-white text-[var(--text)] shadow-[0_0_0_0.5px_rgba(0,0,0,0.06)]' : 'text-[var(--text2)]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
