import { useStore } from '../store'
import { Material } from '../../../shared/types'
import { mediaUrl, fmtDuration } from '../format'
import { PeriodChip } from './PeriodChip'

const BORDER = { unused: '#0a84ff', used: '#8e8e93', deleted: '#1c1c1e' }

export function Grid(): JSX.Element {
  const materials = useStore((s) => s.materials)
  const openPreviewAt = useStore((s) => s.openPreviewAt)

  if (!materials.length) return <Empty />

  return (
    <div className="grid grid-cols-4 gap-[14px] p-4">
      {materials.map((m, i) => (
        <Card key={m.id} m={m} onClick={() => openPreviewAt(i)} />
      ))}
    </div>
  )
}

function Card({ m, onClick }: { m: Material; onClick: () => void }): JSX.Element {
  const hasThumb = m.thumbReady && m.thumbnailPath
  const filterStyle =
    m.status === 'used'
      ? 'grayscale brightness-95'
      : m.status === 'deleted'
        ? 'grayscale brightness-[0.55]'
        : ''
  return (
    <div
      onClick={onClick}
      style={{ borderColor: BORDER[m.status] }}
      className="bg-black rounded-[9px] overflow-hidden relative aspect-video cursor-pointer border-[2.5px] shadow-[0_1px_3px_rgba(0,0,0,0.18)]"
    >
      {hasThumb ? (
        <img src={mediaUrl(m.thumbnailPath)} className={`absolute inset-0 w-full h-full object-cover ${filterStyle}`} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[#15151a]">
          <div className="spin" />
        </div>
      )}

      {m.status === 'deleted' && (
        <div className="absolute inset-0 flex items-center justify-center text-[54px] text-xred font-light [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
          ✕
        </div>
      )}

      {m.status !== 'unused' && (
        <span
          className="absolute top-2 right-2 text-[10px] font-semibold px-[7px] py-[2px] rounded-md text-white backdrop-blur"
          style={{ background: m.status === 'used' ? 'rgba(120,120,128,0.85)' : 'rgba(28,28,30,0.85)' }}
        >
          {m.status === 'used' ? '已使用' : '已删除'}
        </span>
      )}

      {m.period && (
        <div className="absolute top-2 left-2 opacity-95">
          <PeriodChip period={m.period} />
        </div>
      )}

      {m.durationSec != null && (
        <span className="absolute bottom-[7px] right-[7px] text-[10px] font-semibold text-white bg-black/60 px-[6px] py-[2px] rounded-[5px]">
          {fmtDuration(m.durationSec)}
        </span>
      )}

      {m.tags.length > 0 && (
        <div className="absolute bottom-[7px] left-[7px] flex gap-1">
          {m.tags.slice(0, 2).map((t) => (
            <span
              key={t}
              className="text-[9px] text-white bg-white/20 backdrop-blur px-[6px] py-[2px] rounded-[5px]"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Empty(): JSX.Element {
  const view = useStore((s) => s.view)
  return (
    <div className="text-[var(--text3)] text-sm text-center pt-24">
      {view.type === null ? '在左侧选择文件夹或节目浏览素材' : '没有符合当前筛选条件的素材'}
    </div>
  )
}
