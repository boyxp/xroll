import { ReactNode, useEffect } from 'react'

export function Modal({
  onClose,
  children,
  width = 460
}: {
  onClose: () => void
  children: ReactNode
  width?: number
}): JSX.Element {
  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{ width }}
        className="bg-[var(--bg)] rounded-xl overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.4)]"
      >
        {children}
      </div>
    </div>
  )
}

export function ModalHeader({ title, onClose }: { title: string; onClose: () => void }): JSX.Element {
  return (
    <div className="h-[46px] border-b-[0.5px] border-[var(--line)] flex items-center justify-between px-4 font-semibold text-sm bg-[rgba(245,245,247,0.6)]">
      {title}
      <span className="cursor-pointer text-[var(--text3)] text-base" onClick={onClose}>
        ✕
      </span>
    </div>
  )
}
