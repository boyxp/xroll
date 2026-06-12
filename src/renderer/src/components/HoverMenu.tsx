import { useRef, useState } from 'react'

// 悬停展开的多选下拉（JS 状态驱动，避免纯 CSS hover 失效）
export function HoverMenu({
  label,
  options,
  selected,
  onToggle,
  onClear
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const enter = (): void => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(true)
  }
  const leave = (): void => {
    timer.current = setTimeout(() => setOpen(false), 160)
  }

  const valText =
    selected.length === 0
      ? '全部'
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} 项`

  return (
    <div className="relative" onMouseEnter={enter} onMouseLeave={leave}>
      <div className="flex items-center gap-[5px] text-xs bg-[#f1f1f3] border-[0.5px] border-[var(--line)] rounded-[7px] px-[9px] py-[5px] hover:bg-[#e9e9ec] cursor-default">
        {label} <span className="text-accent font-semibold">{valText}</span>
        <span className="text-[var(--text3)] text-[9px]">▾</span>
      </div>
      {open && (
        <div className="absolute top-full left-0 pt-[6px] z-40 min-w-[180px]">
          <div className="bg-white border-[0.5px] border-[var(--line)] rounded-[9px] shadow-[0_12px_30px_rgba(0,0,0,0.16)] p-[6px] max-h-[300px] overflow-auto">
            <MenuItem label="全部" on={selected.length === 0} all onClick={onClear} />
            <div className="h-px bg-[var(--line)] mx-[2px] my-[4px]" />
            {options.length === 0 && (
              <div className="px-[9px] py-[6px] text-xs text-[var(--text3)]">暂无可选项</div>
            )}
            {options.map((o) => (
              <MenuItem
                key={o.value}
                label={o.label}
                on={selected.includes(o.value)}
                onClick={() => onToggle(o.value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  label,
  on,
  all,
  onClick
}: {
  label: string
  on: boolean
  all?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-[9px] py-[6px] rounded-md text-xs cursor-pointer hover:bg-[#f1f1f3] ${
        on ? 'font-semibold' : ''
      } ${all ? 'text-accent' : ''}`}
    >
      {label}
      <span className={`ml-auto text-accent ${on ? 'opacity-100' : 'opacity-0'}`}>✓</span>
    </div>
  )
}
