import { useState } from 'react'
import { useStore } from '../store'
import { AddFolderDialog } from './AddFolderDialog'
import { Modal, ModalHeader } from './Modal'
import { MATERIAL_DRAG_TYPE } from './List'

const api = window.api

export function Sidebar(): JSX.Element {
  const folders = useStore((s) => s.folders)
  const programs = useStore((s) => s.programs)
  const view = useStore((s) => s.view)
  const activeProgram = useStore((s) => s.activeProgram)
  const missingFolders = useStore((s) => s.missingFolders)
  const importProgress = useStore((s) => s.importProgress)
  const selection = useStore((s) => s.selection)
  const materials = useStore((s) => s.materials)
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [showAddProgram, setShowAddProgram] = useState(false)
  // 拖素材悬停在某节目上：记录该节目 id，用于高亮 + 显示 +n
  const [dragOverProgram, setDragOverProgram] = useState<number | null>(null)

  // 本次拖动会给该节目「新增」多少素材（已在节目中的忽略不计）
  const newCountFor = (programId: number): number => {
    let n = 0
    for (const m of materials) {
      if (selection.has(m.id) && !m.usedByPrograms.some((p) => p.id === programId)) n++
    }
    return n
  }

  const isMaterialDrag = (e: React.DragEvent): boolean =>
    e.dataTransfer.types.includes(MATERIAL_DRAG_TYPE)

  const onProgramDrop = async (programId: number, e: React.DragEvent): Promise<void> => {
    if (!isMaterialDrag(e)) return
    e.preventDefault()
    setDragOverProgram(null)
    let ids: number[] = []
    try {
      ids = JSON.parse(e.dataTransfer.getData(MATERIAL_DRAG_TYPE) || '[]')
    } catch {
      /* ignore */
    }
    if (ids.length) await useStore.getState().addToProgram(programId, ids)
  }

  return (
    <div className="w-[232px] bg-[var(--sidebar)] border-r-[0.5px] border-[var(--line)] flex flex-col flex-shrink-0">
      <div className="h-[38px] drag flex-shrink-0" />
      <div className="flex-1 overflow-auto px-[10px] pb-2">
        <GroupHead
          title="素材文件夹"
          onAdd={() => setShowAddFolder(true)}
          onRefresh={() => void useStore.getState().refreshSidebar()}
        />
        <Row
          icon="🗂️"
          label="全部素材"
          meta={folders.reduce((a, f) => a + (f.count ?? 0), 0)}
          active={view.type === 'folder' && view.id === null}
          onClick={() => useStore.getState().openFolder(null)}
        />
        {folders.map((f) => {
          const ip = importProgress[f.id]
          const importing = ip && ip.phase !== 'done'
          const broken = missingFolders.has(f.id)
          return (
            <Row
              key={f.id}
              icon={broken ? '⛓️‍💥' : '📁'}
              label={f.name}
              broken={broken}
              meta={importing ? undefined : f.shootDate ? mmdd(f.shootDate) : ''}
              spinner={importing}
              active={view.type === 'folder' && view.id === f.id}
              onClick={() => useStore.getState().openFolder(f.id)}
            />
          )
        })}

        <GroupHead title="节目" onAdd={() => setShowAddProgram(true)} />
        {programs.map((p) => {
          // 「打开中」的节目（最后打开 = 正在为其挑选素材）：高亮强调，其余灰底
          const opened = activeProgram?.id === p.id
          const viewing = view.type === 'program' && view.id === p.id
          const bg = opened
            ? p.stageColor
              ? tint(p.stageColor, 0.22)
              : '#e6effb'
            : 'rgba(0,0,0,0.045)'
          return (
            <Row
              key={p.id}
              icon={opened ? '📥' : '🎬'}
              label={p.name}
              opened={opened}
              flag={opened}
              count={opened ? selection.size : undefined}
              ring={viewing}
              bg={bg}
              stage={p.stageName ?? undefined}
              stageColor={p.stageColor ?? undefined}
              onClick={() => useStore.getState().openProgram(p.id)}
              dragActive={dragOverProgram === p.id}
              dragBadge={dragOverProgram === p.id ? newCountFor(p.id) : undefined}
              onDragOver={(e) => {
                if (!isMaterialDrag(e)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                if (dragOverProgram !== p.id) setDragOverProgram(p.id)
              }}
              onDragLeave={() => setDragOverProgram((cur) => (cur === p.id ? null : cur))}
              onDrop={(e) => void onProgramDrop(p.id, e)}
            />
          )
        })}
      </div>

      <div className="px-[10px] py-2 border-t-[0.5px] border-[var(--line)]">
        <div
          className="flex items-center gap-2 px-2 py-[6px] rounded-md text-[13px] text-[var(--text2)] cursor-pointer hover:bg-black/5"
          onClick={() => useStore.getState().setSettingsOpen(true)}
        >
          <span>⚙️</span>设置
        </div>
      </div>

      {showAddFolder && <AddFolderDialog onClose={() => setShowAddFolder(false)} />}
      {showAddProgram && <AddProgramDialog onClose={() => setShowAddProgram(false)} />}
    </div>
  )
}

function GroupHead({
  title,
  onAdd,
  onRefresh
}: {
  title: string
  onAdd: () => void
  onRefresh?: () => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-2 pt-3 pb-1">
      <span className="text-[11px] font-bold tracking-wide text-[var(--text3)] uppercase">{title}</span>
      <div className="flex items-center gap-[2px]">
        {onRefresh && (
          <div
            className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center text-[var(--text2)] cursor-pointer text-[12px] hover:bg-black/5"
            onClick={onRefresh}
            title={'刷新文件夹状态'}
          >
            ↻
          </div>
        )}
        <div
          className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center text-[var(--text2)] cursor-pointer text-[15px] hover:bg-black/5"
          onClick={onAdd}
          title={'添加'}
        >
          ＋
        </div>
      </div>
    </div>
  )
}

function Row({
  icon,
  label,
  meta,
  stage,
  stageColor,
  bg,
  active,
  spinner,
  opened,
  flag,
  count,
  broken,
  ring,
  onClick,
  dragActive,
  dragBadge,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  icon: string
  label: string
  meta?: number | string
  stage?: string
  stageColor?: string
  bg?: string
  active?: boolean
  spinner?: boolean
  opened?: boolean // 节目：当前打开中（强调样式）
  flag?: boolean // 节目：显示 🚩（正在为其挑选素材）
  count?: number // 节目：已选中素材数量
  broken?: boolean // 文件夹：路径失效
  ring?: boolean // 描边强调（正在浏览）
  onClick: () => void
  dragActive?: boolean
  dragBadge?: number
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}): JSX.Element {
  return (
    <div
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={!active && bg ? { background: bg } : undefined}
      className={`flex items-center gap-2 px-2 ${opened ? 'py-[9px]' : 'py-[6px]'} rounded-md ${
        opened ? 'text-[14px]' : 'text-[13px]'
      } cursor-pointer mb-[2px] ${active ? 'bg-accent text-white' : 'hover:brightness-[0.97]'} ${
        ring && !active ? 'ring-2 ring-inset ring-accent' : ''
      } ${dragActive ? 'ring-2 ring-inset ring-accent !bg-[#eaf3ff]' : ''}`}
    >
      <span className="text-sm w-4 text-center opacity-85 flex-shrink-0">{icon}</span>
      <span className={`truncate ${opened ? 'font-semibold' : ''} ${broken ? 'text-[var(--text3)]' : ''}`}>
        {label}
      </span>
      {flag && (
        <span className="flex-shrink-0 text-[12px]" title="正在为此节目挑选素材">
          🚩
        </span>
      )}
      {count !== undefined && count > 0 && (
        <span
          className="flex-shrink-0 text-[10px] font-bold px-[6px] py-[1px] rounded-full bg-accent text-white"
          title="已选中素材数量"
        >
          {count}
        </span>
      )}
      {broken && (
        <span className="flex-shrink-0 text-[12px]" title="文件夹路径失效（设备断开 / 被移动改名 / 已删除）">
          ⚠️
        </span>
      )}
      {dragActive && dragBadge !== undefined && (
        <span
          className={`text-[10px] font-bold px-[5px] py-[1px] rounded-full flex-shrink-0 ${
            dragBadge > 0 ? 'bg-accent text-white' : 'bg-black/15 text-[var(--text3)]'
          }`}
        >
          +{dragBadge}
        </span>
      )}
      {spinner && <div className="spin ml-auto !w-3 !h-3" />}
      {stage && (
        <span
          style={{ background: active ? 'rgba(255,255,255,0.28)' : stageColor }}
          className="ml-auto text-[10px] px-[6px] py-[1px] rounded-md text-white flex-shrink-0"
        >
          {stage}
        </span>
      )}
      {meta !== undefined && meta !== '' && !stage && !spinner && (
        <span className={`ml-auto text-[10px] ${active ? 'text-white/80' : 'text-[var(--text3)]'}`}>
          {meta}
        </span>
      )}
    </div>
  )
}

function AddProgramDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [name, setName] = useState('')
  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    const programs = (await api.createProgram(name.trim())) as { id: number }[]
    await useStore.getState().refreshSidebar()
    const created = programs[programs.length - 1]
    if (created) await useStore.getState().openProgram(created.id)
    onClose()
  }
  return (
    <Modal onClose={onClose}>
      <ModalHeader title="新建节目" onClose={onClose} />
      <div className="p-4 space-y-3">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="节目名称"
          className="w-full text-sm bg-white border-[0.5px] border-[var(--line)] rounded-lg px-3 py-2"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg bg-[#f1f1f3]">
            取消
          </button>
          <button onClick={submit} className="px-4 py-2 text-xs rounded-lg bg-accent text-white">
            创建
          </button>
        </div>
      </div>
    </Modal>
  )
}

function mmdd(date: string): string {
  // YYYY-MM-DD → MM-DD（今年）/ 原样（往年）
  const now = new Date().getFullYear()
  const [y, m, d] = date.split('-')
  return Number(y) === now ? `${m}-${d}` : date
}

function tint(hex: string, alpha = 0.12): string {
  // 将进度色淡化为行底色
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
