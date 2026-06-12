import { Period } from '../../../shared/types'
import { PERIOD_LABEL, PERIOD_STYLE } from '../format'

export function PeriodChip({ period, fixedWidth = true }: { period: Period | null; fixedWidth?: boolean }): JSX.Element | null {
  if (!period) return null
  const s = PERIOD_STYLE[period]
  return (
    <span
      style={{ background: s.bg, color: s.fg, width: fixedWidth ? 30 : undefined }}
      className="inline-block text-center text-[10px] font-bold leading-[1.5] rounded-[5px] px-[5px] whitespace-nowrap flex-shrink-0"
    >
      {PERIOD_LABEL[period]}
    </span>
  )
}
