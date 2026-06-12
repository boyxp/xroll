import { useStore } from '../store'
import { HoverMenu } from './HoverMenu'
import { Period, MaterialStatus } from '../../../shared/types'
import { PERIOD_LABEL, PERIOD_STYLE } from '../format'

const PERIODS: (Period | 'all')[] = ['all', 'dawn', 'am', 'pm', 'night']
const STATUSES: { v: MaterialStatus; label: string; color: string }[] = [
  { v: 'unused', label: '未使用', color: '#0a84ff' },
  { v: 'used', label: '已使用', color: '#8e8e93' },
  { v: 'deleted', label: '已删除', color: '#1c1c1e' }
]

export function FilterBar(): JSX.Element {
  const filters = useStore((s) => s.filters)
  const tags = useStore((s) => s.tags)
  const devices = useStore((s) => s.devices)
  const dateOptions = useStore((s) => s.dateOptions)
  const locationOptions = useStore((s) => s.locationOptions)
  const view = useStore((s) => s.view)
  const importProgress = useStore((s) => s.importProgress)
  const set = useStore.getState().setFilters

  const importing =
    view.type === 'folder' &&
    Object.entries(importProgress).some(
      ([fid, p]) => p.phase !== 'done' && (view.id === null || Number(fid) === view.id)
    )

  const toggle = (key: 'tags' | 'dates' | 'devices' | 'locations', value: string): void => {
    const arr = filters[key]
    set({ [key]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] } as never)
  }

  const toggleStatus = (v: MaterialStatus): void => {
    const arr = filters.statuses
    set({ statuses: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] })
  }

  return (
    <div className="flex gap-2 px-4 py-2 border-b-[0.5px] border-[var(--line)] bg-[rgba(245,245,247,0.4)] items-center flex-wrap">
      <HoverMenu
        label="标签"
        options={tags.map((t) => ({ value: t.name, label: t.name }))}
        selected={filters.tags}
        onToggle={(v) => toggle('tags', v)}
        onClear={() => set({ tags: [] })}
      />
      <HoverMenu
        label="日期"
        options={dateOptions.map((d) => ({ value: d, label: d }))}
        selected={filters.dates}
        onToggle={(v) => toggle('dates', v)}
        onClear={() => set({ dates: [] })}
      />
      <HoverMenu
        label="设备"
        options={devices.map((d) => ({ value: d.name, label: d.name }))}
        selected={filters.devices}
        onToggle={(v) => toggle('devices', v)}
        onClear={() => set({ devices: [] })}
      />
      <HoverMenu
        label="拍摄地"
        options={locationOptions.map((l) => ({ value: l, label: l }))}
        selected={filters.locations}
        onToggle={(v) => toggle('locations', v)}
        onClear={() => set({ locations: [] })}
      />

      <div className="w-px h-[22px] bg-[var(--line)] mx-1" />

      <div className="flex items-center gap-[6px]">
        <span className="text-[11px] text-[var(--text3)] mr-[2px]">时段</span>
        {PERIODS.map((p) => {
          const on = filters.period === p
          const style =
            p === 'all'
              ? { background: '#dfe7f5', color: 'var(--accent)' }
              : { background: PERIOD_STYLE[p].bg, color: PERIOD_STYLE[p].fg }
          return (
            <span
              key={p}
              onClick={() => set({ period: p })}
              style={{ ...style, outline: on ? '2px solid var(--accent)' : '2px solid transparent', outlineOffset: 1 }}
              className="inline-block text-center text-[10px] font-bold leading-[1.5] rounded-[5px] px-[5px] w-[30px] cursor-pointer"
            >
              {p === 'all' ? '全部' : PERIOD_LABEL[p]}
            </span>
          )
        })}
      </div>

      <div className="w-px h-[22px] bg-[var(--line)] mx-1" />

      <div className="flex items-center gap-[6px]">
        <span className="text-[11px] text-[var(--text3)] mr-[2px]">状态</span>
        <Chip
          label="全部"
          all
          on={filters.statuses.length === 3}
          onClick={() => set({ statuses: ['unused', 'used', 'deleted'] })}
        />
        {STATUSES.map((s) => (
          <Chip
            key={s.v}
            label={s.label}
            color={s.color}
            on={filters.statuses.includes(s.v)}
            onClick={() => toggleStatus(s.v)}
          />
        ))}
      </div>

      {importing && (
        <span className="ml-auto flex items-center gap-2 text-[11px] text-accent">
          <span className="spin !w-3 !h-3" />
          导入中 · 暂忽略筛选，实时显示
        </span>
      )}
    </div>
  )
}

function Chip({
  label,
  color,
  on,
  all,
  onClick
}: {
  label: string
  color?: string
  on: boolean
  all?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <span
      onClick={onClick}
      style={{ outline: on ? '2px solid var(--accent)' : undefined }}
      className={`inline-flex items-center gap-[5px] text-[11px] px-[9px] py-[3px] rounded-[7px] cursor-pointer border border-[var(--line)] ${
        on ? 'bg-white text-[var(--text)]' : 'bg-[#f1f1f3] text-[var(--text2)]'
      } ${all ? 'text-accent' : ''}`}
    >
      {color && <i style={{ background: color }} className="w-2 h-2 rounded-full" />}
      {label}
    </span>
  )
}
