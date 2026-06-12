import { useState } from 'react'
import { Modal, ModalHeader } from './Modal'
import { useStore } from '../store'

const api = window.api

export function AddFolderDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const devices = useStore((s) => s.devices)
  const [path, setPath] = useState<string | null>(null)
  const [device, setDevice] = useState('')
  const [location, setLocation] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    const p = await api.selectFolder()
    if (p) setPath(p)
  }

  const submit = async (): Promise<void> => {
    if (!path) return
    setBusy(true)
    const folderId = await api.importFolder({
      path,
      device: device || null,
      location: location || null,
      category: category || null,
      description: description || null
    })
    await useStore.getState().refreshSidebar()
    await useStore.getState().refreshOptions()
    await useStore.getState().openFolder(folderId as number)
    onClose()
  }

  return (
    <Modal onClose={onClose} width={520}>
      <ModalHeader title="添加素材文件夹" onClose={onClose} />
      <div className="p-4 space-y-3">
        <div>
          <div className="text-[11px] text-[var(--text3)] mb-1">文件夹（一级目录，内含视频）</div>
          <div className="flex gap-2">
            <div className="flex-1 text-xs bg-white border-[0.5px] border-[var(--line)] rounded-lg px-3 py-2 truncate text-[var(--text2)]">
              {path ?? '尚未选择'}
            </div>
            <button
              onClick={pick}
              className="bg-[#f1f1f3] border-[0.5px] border-[var(--line)] rounded-lg px-3 text-xs"
            >
              选择…
            </button>
          </div>
        </div>

        <Field label="拍摄设备">
          <select
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            className="w-full text-xs bg-white border-[0.5px] border-[var(--line)] rounded-lg px-3 py-2"
          >
            <option value="">（不指定）</option>
            {devices.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="拍摄地点（可选）">
          <Input value={location} onChange={setLocation} placeholder="如 杭州" />
        </Field>
        <Field label="素材分类（可选）">
          <Input value={category} onChange={setCategory} placeholder="如 风光 / 人物" />
        </Field>
        <Field label="描述（可选）">
          <Input value={description} onChange={setDescription} placeholder="备注信息" />
        </Field>

        <div className="text-[11px] text-[var(--text3)]">
          拍摄日期将从文件名自动解析（如 DJI_20260129100313_…）。
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg bg-[#f1f1f3]">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!path || busy}
            className="px-4 py-2 text-xs rounded-lg bg-accent text-white disabled:opacity-40"
          >
            {busy ? '导入中…' : '添加并导入'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-[11px] text-[var(--text3)] mb-1">{label}</div>
      {children}
    </div>
  )
}

function Input({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}): JSX.Element {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-xs bg-white border-[0.5px] border-[var(--line)] rounded-lg px-3 py-2"
    />
  )
}
