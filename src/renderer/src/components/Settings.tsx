import { useEffect, useState, ReactNode } from 'react'
import { useStore } from '../store'
import { Stage, Tag, Device, Folder, Program } from '../../../shared/types'

const api = window.api

type TabKey = 'folder' | 'program' | 'tag' | 'stage' | 'dev'

const TITLES: Record<TabKey, string> = {
  folder: '文件夹管理',
  program: '节目管理',
  tag: '标签管理',
  stage: '节目进度',
  dev: '拍摄设备'
}

export function Settings(): JSX.Element {
  const [tab, setTab] = useState<TabKey>('folder')
  const close = (): void => useStore.getState().setSettingsOpen(false)

  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  const title = TITLES[tab]

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="w-[680px] h-[480px] bg-[var(--bg)] rounded-xl overflow-hidden flex shadow-[0_30px_80px_rgba(0,0,0,0.4)]">
        <div className="w-[170px] bg-[var(--sidebar)] border-r-[0.5px] border-[var(--line)] p-4">
          <div className="text-[11px] font-bold text-[var(--text3)] uppercase px-2 py-[6px]">设置</div>
          <Nav label="📁 文件夹管理" on={tab === 'folder'} onClick={() => setTab('folder')} />
          <Nav label="🎬 节目管理" on={tab === 'program'} onClick={() => setTab('program')} />
          <Nav label="🏷️ 标签管理" on={tab === 'tag'} onClick={() => setTab('tag')} />
          <Nav label="🚦 节目进度" on={tab === 'stage'} onClick={() => setTab('stage')} />
          <Nav label="📷 拍摄设备" on={tab === 'dev'} onClick={() => setTab('dev')} />
        </div>
        <div className="flex-1 flex flex-col">
          <div className="h-[46px] border-b-[0.5px] border-[var(--line)] flex items-center justify-between px-4 font-semibold text-sm bg-[rgba(245,245,247,0.6)]">
            {title}
            <span className="cursor-pointer text-[var(--text3)] text-base" onClick={close}>
              ✕
            </span>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {tab === 'folder' && <FolderPanel />}
            {tab === 'program' && <ProgramPanel />}
            {tab === 'tag' && <TagPanel />}
            {tab === 'stage' && <StagePanel />}
            {tab === 'dev' && <DevicePanel />}
          </div>
        </div>
      </div>
    </div>
  )
}

function Nav({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <div
      onClick={onClick}
      className={`px-[10px] py-[7px] rounded-md text-[13px] cursor-pointer ${
        on ? 'bg-accent text-white' : 'text-[var(--text)]'
      }`}
    >
      {label}
    </div>
  )
}

function AddBar({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }): JSX.Element {
  const [v, setV] = useState('')
  const add = (): void => {
    if (v.trim()) {
      onAdd(v.trim())
      setV('')
    }
  }
  return (
    <div className="flex gap-2 mb-[14px]">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        placeholder={placeholder}
        className="flex-1 border-[0.5px] border-[var(--line)] rounded-[7px] px-[10px] py-[7px] text-[13px] bg-white"
      />
      <button onClick={add} className="bg-accent text-white rounded-[7px] px-[14px] text-[13px]">
        添加
      </button>
    </div>
  )
}

// 通用可管理行：行内重命名 + 删除
function ManageRow({
  name,
  meta,
  left,
  onRename,
  onDelete
}: {
  name: string
  meta: string
  left?: ReactNode
  onRename?: (v: string) => void
  onDelete: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(name)
  const commit = (): void => {
    setEditing(false)
    if (onRename && v.trim() && v.trim() !== name) onRename(v.trim())
  }
  return (
    <div className="flex items-center gap-[10px] px-[10px] py-[9px] rounded-lg bg-white border-[0.5px] border-[var(--line)] mb-[7px]">
      {left}
      {editing ? (
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setV(name)
              setEditing(false)
            }
          }}
          className="flex-1 text-[13px] border-[0.5px] border-accent rounded-md px-2 py-[2px] bg-white"
        />
      ) : (
        <span
          className={`flex-1 text-[13px] ${onRename ? 'cursor-text' : ''}`}
          onDoubleClick={() => onRename && setEditing(true)}
        >
          {name}
        </span>
      )}
      <span className="text-[11px] text-[var(--text3)]">{meta}</span>
      {onRename && (
        <span
          onClick={() => {
            setV(name)
            setEditing(true)
          }}
          className="text-xs text-[var(--text2)] cursor-pointer px-2 py-[3px] rounded-md hover:bg-[#f1f1f3]"
        >
          重命名
        </span>
      )}
      <span
        onClick={onDelete}
        className="text-xs text-[var(--text2)] cursor-pointer px-2 py-[3px] rounded-md hover:bg-[#ffe5e3] hover:text-xred"
      >
        删除
      </span>
    </div>
  )
}

function Hint({ text }: { text: string }): JSX.Element {
  return <div className="text-[11px] text-[var(--text3)] mb-[10px] leading-[1.6]">{text}</div>
}

function FolderPanel(): JSX.Element {
  const folders = useStore((s) => s.folders)
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <>
      <Hint text="仅从素材库移除文件夹记录及其素材信息，本地文件夹和视频文件不会被删除；该文件夹素材生成的缩略图会一并清理以释放空间。" />
      {busy && (
        <div className="flex items-center gap-2 text-[12px] text-accent mb-[10px] px-1">
          <span className="spin !w-3 !h-3" />
          {busy}
        </div>
      )}
      {folders.length === 0 && <div className="text-[13px] text-[var(--text3)] px-1">还没有添加文件夹。</div>}
      {folders.map((f: Folder) => (
        <ManageRow
          key={f.id}
          name={f.name}
          meta={`${f.count ?? 0} 个素材`}
          onDelete={async () => {
            if (busy) return
            if (!confirm(`从素材库移除文件夹「${f.name}」？\n本地文件不会被删除。`)) return
            const cur = useStore.getState().view
            setBusy('正在删除缩略图，释放空间…')
            try {
              await api.deleteFolder(f.id)
              await useStore.getState().refreshSidebar()
              await useStore.getState().refreshOptions()
              if (cur.type === 'folder' && cur.id === f.id)
                useStore.setState({ view: { type: null, id: null }, materials: [], selection: new Set() })
            } finally {
              setBusy(null)
            }
          }}
        />
      ))}
    </>
  )
}

function ProgramPanel(): JSX.Element {
  const programs = useStore((s) => s.programs)
  const stages = useStore((s) => s.stages)
  const refresh = (): Promise<void> => useStore.getState().refreshSidebar()
  return (
    <>
      <Hint text="可修改节目名称与进度阶段，或删除节目。删除仅移除数据库记录，已拷贝的本地文件不受影响。" />
      {programs.length === 0 && <div className="text-[13px] text-[var(--text3)] px-1">还没有创建节目。</div>}
      {programs.map((p: Program) => (
        <ManageRow
          key={p.id}
          name={p.name}
          meta=""
          left={
            <select
              value={p.stageId ?? ''}
              onChange={async (e) => {
                await api.updateProgram(p.id, { stageId: Number(e.target.value) })
                await refresh()
              }}
              style={{ borderColor: p.stageColor ?? 'var(--line)', color: p.stageColor ?? 'var(--text2)' }}
              className="text-[12px] rounded-md px-[6px] py-[3px] border-[0.5px] bg-white cursor-pointer font-medium"
            >
              {stages.map((s: Stage) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          }
          onRename={async (v) => {
            await api.updateProgram(p.id, { name: v })
            const ap = useStore.getState().activeProgram
            if (ap && ap.id === p.id) useStore.setState({ activeProgram: { id: ap.id, name: v } })
            await refresh()
          }}
          onDelete={async () => {
            if (!confirm(`删除节目「${p.name}」？\n仅删除数据库记录，本地文件不受影响。`)) return
            const cur = useStore.getState().view
            await api.deleteProgram(p.id)
            await useStore.getState().refreshSidebar()
            if (cur.type === 'program' && cur.id === p.id)
              useStore.setState({
                view: { type: null, id: null },
                materials: [],
                activeProgram: null,
                selection: new Set()
              })
          }}
        />
      ))}
    </>
  )
}

function TagPanel(): JSX.Element {
  const tags = useStore((s) => s.tags)
  const refresh = async (): Promise<void> => {
    await useStore.getState().refreshSidebar()
    await useStore.getState().reloadMaterials()
  }
  return (
    <>
      <AddBar
        placeholder="新建标签，如「航拍」「人物」…"
        onAdd={async (v) => {
          await api.createTag(v)
          await refresh()
        }}
      />
      {tags.map((t: Tag) => (
        <ManageRow
          key={t.id}
          name={t.name}
          meta={`用于 ${t.count ?? 0} 个素材`}
          onRename={async (v) => {
            await api.renameTag(t.id, v)
            await refresh()
          }}
          onDelete={async () => {
            if (confirm(`删除标签「${t.name}」？`)) {
              await api.deleteTag(t.id)
              await refresh()
            }
          }}
        />
      ))}
    </>
  )
}

function StagePanel(): JSX.Element {
  const stages = useStore((s) => s.stages)
  const refresh = (): Promise<void> => useStore.getState().refreshSidebar()
  return (
    <>
      <AddBar
        placeholder="新建节目进度阶段…"
        onAdd={async (v) => {
          await api.createStage(v, '#0a84ff')
          await refresh()
        }}
      />
      <div className="text-[11px] text-[var(--text3)] mb-2">
        左侧色块可修改进度颜色，导航中对应节目会以该色为底色。
      </div>
      {stages.map((s: Stage) => (
        <ManageRow
          key={s.id}
          name={s.name}
          meta={`${s.count ?? 0} 个节目`}
          left={
            <>
              <span className="text-[var(--text4)] cursor-grab">⠿</span>
              <input
                type="color"
                value={s.color}
                onChange={async (e) => {
                  await api.updateStage(s.id, { color: e.target.value })
                  await refresh()
                }}
                className="w-[22px] h-[22px] rounded-md cursor-pointer p-0 border-none bg-transparent"
              />
            </>
          }
          onRename={async (v) => {
            await api.updateStage(s.id, { name: v })
            await refresh()
          }}
          onDelete={async () => {
            if (confirm(`删除阶段「${s.name}」？`)) {
              await api.deleteStage(s.id)
              await refresh()
            }
          }}
        />
      ))}
    </>
  )
}

function DevicePanel(): JSX.Element {
  const devices = useStore((s) => s.devices)
  const refresh = (): Promise<void> => useStore.getState().refreshSidebar()
  return (
    <>
      <AddBar
        placeholder="新建拍摄设备…"
        onAdd={async (v) => {
          await api.createDevice(v)
          await refresh()
        }}
      />
      {devices.map((d: Device) => (
        <ManageRow
          key={d.id}
          name={d.name}
          meta={`${d.count ?? 0} 个文件夹`}
          onRename={async (v) => {
            await api.renameDevice(d.id, v)
            await refresh()
          }}
          onDelete={async () => {
            if (confirm(`删除设备「${d.name}」？`)) {
              await api.deleteDevice(d.id)
              await refresh()
            }
          }}
        />
      ))}
    </>
  )
}
