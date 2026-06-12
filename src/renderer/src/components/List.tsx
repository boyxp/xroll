import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { ClipType, Material } from '../../../shared/types'
import { mediaUrl, fmtDuration, fmtSize, fmtShoot, fmtResolution, fmtBitrate, CLIP_TYPE } from '../format'
import { PeriodChip } from './PeriodChip'

const DOT = { unused: '#0a84ff', used: '#8e8e93', deleted: '#1c1c1e' }

const api = window.api

interface HoverState {
  src: string
  x: number
  y: number
}
interface MenuState {
  x: number
  y: number
  ids: number[]
  alias: string
}
interface CtxState {
  x: number
  y: number
  ids: number[]
}

// 节目右键菜单「修改类型」子项：A-roll 即清空类型(null)
const TYPE_OPTIONS: { label: string; value: ClipType | null }[] = [
  { label: 'A-roll', value: null },
  { label: 'B-roll', value: 'broll' },
  { label: 'Intro', value: 'intro' }
]

// 节目手动列表的「块」：intro 组、别名组、未分组单条
type Block =
  | { key: string; kind: 'intro'; items: Material[] }
  | { key: string; kind: 'group'; alias: string; items: Material[] }
  | { key: string; kind: 'single'; items: Material[] }

// 当前拖拽对象：组内单条(item) 或 整块(block)
type DragRef =
  | { type: 'item'; blockKey: string; id: number }
  | { type: 'block'; blockIndex: number }
  | null

const aliasKey = (m: Material): string | null => (m.alias && m.alias.trim() ? m.alias.trim() : null)

// 把素材切成块：
// - 每个素材只出现一条（按 id 去重）
// - intro 整体置顶为一个组
// - 同一别名的素材合并为唯一一个组，落在其首次出现的位置（不要求相邻）
// - 别名仅出现一次的素材不成组，按普通单条渲染
function buildBlocks(mats: Material[]): Block[] {
  const seen = new Set<number>()
  const uniq = mats.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))

  const intro = uniq.filter((m) => m.clipType === 'intro')
  const rest = uniq.filter((m) => m.clipType !== 'intro')

  // 统计别名出现次数：至少 2 条才算组
  const counts = new Map<string, number>()
  for (const m of rest) {
    const a = aliasKey(m)
    if (a) counts.set(a, (counts.get(a) ?? 0) + 1)
  }

  const blocks: Block[] = []
  if (intro.length) blocks.push({ key: 'intro', kind: 'intro', items: intro })

  const groupItems = new Map<string, Material[]>()
  for (const m of rest) {
    const a = aliasKey(m)
    if (a && (counts.get(a) ?? 0) >= 2) {
      let items = groupItems.get(a)
      if (!items) {
        items = []
        groupItems.set(a, items)
        blocks.push({ key: 'g:' + a, kind: 'group', alias: a, items }) // 在首次出现处占位，后续成员填入同一数组
      }
      items.push(m)
    } else {
      blocks.push({ key: 's:' + m.id, kind: 'single', items: [m] })
    }
  }
  return blocks
}

// 文件夹视图拖素材到节目的 dataTransfer 标记类型（Sidebar 据此识别这是「素材拖拽」）
export const MATERIAL_DRAG_TYPE = 'application/x-claude-materials'

// 构造拖拽影像：缩略图堆叠 + 数量角标（而不是拖一整行）。返回的元素需在 dragstart 后移除。
function buildDragGhost(items: Material[]): HTMLElement {
  const box = document.createElement('div')
  box.style.cssText =
    'position:fixed;top:-1000px;left:-1000px;width:96px;height:60px;pointer-events:none;'
  const thumbs = items.filter((m) => m.thumbReady && m.thumbnailPath).slice(0, 3)
  const shown = thumbs.length ? thumbs : items.slice(0, 1)
  shown.forEach((m, k) => {
    const card = document.createElement('div')
    const off = k * 6
    card.style.cssText = `position:absolute;left:${off}px;top:${off}px;width:80px;height:46px;border-radius:6px;overflow:hidden;background:#15151a;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);transform:rotate(${(k - 1) * 3}deg);`
    if (m.thumbnailPath) {
      const img = document.createElement('img')
      img.src = mediaUrl(m.thumbnailPath)
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;'
      card.appendChild(img)
    }
    box.appendChild(card)
  })
  const badge = document.createElement('div')
  badge.textContent = String(items.length)
  badge.style.cssText =
    'position:absolute;right:0;top:0;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#0a84ff;color:#fff;font:bold 11px -apple-system,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.4);'
  box.appendChild(badge)
  return box
}

const flattenIds = (blocks: Block[]): number[] => blocks.flatMap((b) => b.items.map((m) => m.id))

// 键盘调序的目标：整块（单条/别名组）或组内单条。intro 整组置顶不可移动 → 返回 null。
type Reorder =
  | { kind: 'block'; blockIndex: number; blockKey: string }
  | { kind: 'item'; blockKey: string; id: number }
  | null

// 由当前选中集合推断可调序目标：选满某块=整块；仅选组内一条=组内单条；其余=不可调序
function resolveReorder(blocks: Block[], selection: Set<number>): Reorder {
  if (selection.size === 0) return null
  const idx = blocks.findIndex(
    (b) => b.items.length === selection.size && b.items.every((m) => selection.has(m.id))
  )
  if (idx >= 0) {
    if (blocks[idx].kind === 'intro') return null
    return { kind: 'block', blockIndex: idx, blockKey: blocks[idx].key }
  }
  if (selection.size === 1) {
    const id = [...selection][0]
    const b = blocks.find((bl) => bl.items.some((m) => m.id === id))
    if (b && b.items.length > 1) return { kind: 'item', blockKey: b.key, id }
  }
  return null
}
const pointerAfter = (e: React.DragEvent): boolean => {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientY > r.top + r.height / 2
}

export function List(): JSX.Element {
  const materials = useStore((s) => s.materials)
  const view = useStore((s) => s.view)
  const selection = useStore((s) => s.selection)
  const programSort = useStore((s) => s.programSort)
  const isProgram = view.type === 'program'
  const manualProgram = isProgram && programSort === 'manual'
  const anchor = useRef<number | null>(null)
  const drag = useRef<DragRef>(null)
  // 键盘调序后需要滚动进可视区的素材 id（避免选中分组移出视线）
  const keepId = useRef<number | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [ctx, setCtx] = useState<CtxState | null>(null)

  // 键盘调序：手动节目视图下，选中一个素材或一个分组时，上/下箭头移动其排序位置。
  // 必须在任何提前 return 之前声明，否则 Hook 数量会随渲染变化而崩溃。
  useEffect(() => {
    if (!manualProgram) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (useStore.getState().preview.open) return
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return

      const mats = useStore.getState().materials
      const sel = useStore.getState().selection
      const blks = buildBlocks(mats)
      const introOff = blks[0]?.kind === 'intro' ? 1 : 0
      const r = resolveReorder(blks, sel)
      if (!r) return
      e.preventDefault()
      const dir = e.key === 'ArrowUp' ? -1 : 1

      // 写回排序（与归一化幂等）：顺序无变化则跳过。从 store 即时读取，避免闭包旧值。
      const persist = async (ids: number[]): Promise<void> => {
        const st = useStore.getState()
        if (st.view.type !== 'program' || !st.view.id) return
        const cur = st.materials.map((m) => m.id)
        if (ids.length === cur.length && ids.every((id, k) => id === cur[k])) return
        await api.reorderProgram(st.view.id, ids)
        await st.setProgramSort('manual')
      }

      if (r.kind === 'block') {
        const target = r.blockIndex + dir
        if (target < introOff || target >= blks.length) return
        const arr = [...blks]
        const [mv] = arr.splice(r.blockIndex, 1)
        arr.splice(target, 0, mv)
        // 向下移动时保持组尾可见，向上移动时保持组首可见
        keepId.current = dir === 1 ? mv.items[mv.items.length - 1].id : mv.items[0].id
        void persist(flattenIds(arr))
      } else {
        const blk = blks.find((b) => b.key === r.blockKey)
        if (!blk) return
        const from = blk.items.findIndex((m) => m.id === r.id)
        const to = from + dir
        if (to < 0 || to >= blk.items.length) return
        const next = [...blk.items]
        const [mv] = next.splice(from, 1)
        next.splice(to, 0, mv)
        const newBlocks = blks.map((b) => (b.key === blk.key ? { ...b, items: next } : b))
        keepId.current = r.id
        void persist(flattenIds(newBlocks))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualProgram])

  // 调序后让目标素材滚动进可视区（仅键盘调序触发，其它刷新不滚动）
  useEffect(() => {
    if (keepId.current == null) return
    const id = keepId.current
    keepId.current = null
    document.querySelector(`[data-mid="${id}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [materials])

  if (!materials.length) {
    return (
      <div className="text-[var(--text3)] text-sm text-center pt-24">
        {view.type === null ? '在左侧选择文件夹或节目浏览素材' : '没有符合当前筛选条件的素材'}
      </div>
    )
  }

  // 预览 拍摄时间 时长 类型 标签 文件名 大小 技术参数(含设备)
  const cols = '54px 132px 50px 76px minmax(120px,1.5fr) minmax(150px,1.2fr) 58px 132px'

  // 选择：普通=单选，⌘/Ctrl=切换增选，Shift=从锚点到当前区间多选
  const onSelect = (i: number, e: React.MouseEvent): void => {
    const ids = materials.map((m) => m.id)
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [anchor.current, i].sort((x, y) => x - y)
      useStore.getState().setSelection(ids.slice(a, b + 1))
    } else if (e.metaKey || e.ctrlKey) {
      useStore.getState().toggleSelect(ids[i], true)
      anchor.current = i
    } else {
      useStore.getState().setSelection([ids[i]])
      anchor.current = i
    }
  }

  // 文件夹视图：拖动素材到节目。若拖的这条未被选中，则先单选它；否则拖整批选中。
  const onFolderDragStart = (i: number, e: React.DragEvent): void => {
    const id = materials[i].id
    let sel = useStore.getState().selection
    if (!sel.has(id)) {
      useStore.getState().setSelection([id])
      anchor.current = i
      sel = new Set([id])
    }
    const picked = materials.filter((m) => sel.has(m.id))
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData(MATERIAL_DRAG_TYPE, JSON.stringify(picked.map((m) => m.id)))
    const ghost = buildDragGhost(picked)
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 24, 20)
    setTimeout(() => ghost.remove(), 0)
  }

  // 打开「修改别名」窗口：多素材别名一致时预填，否则留空
  const openAliasModal = (ids: number[], x: number, y: number): void => {
    const aliases = new Set(materials.filter((x) => ids.includes(x.id)).map((x) => x.alias ?? ''))
    const common = aliases.size === 1 ? [...aliases][0] : ''
    setMenu({ x, y, ids, alias: common })
  }

  // 右键：节目视图弹出上下文菜单；文件夹视图直接打开取别名窗口。
  // 若点中的不在已选范围内，则先单选它。
  const onContext = (i: number, e: React.MouseEvent): void => {
    e.preventDefault()
    const m = materials[i]
    let sel = useStore.getState().selection
    if (!sel.has(m.id)) {
      useStore.getState().setSelection([m.id])
      anchor.current = i
      sel = new Set([m.id])
    }
    const ids = materials.filter((x) => sel.has(x.id)).map((x) => x.id)
    if (isProgram) {
      setMenu(null)
      setCtx({ x: e.clientX, y: e.clientY, ids })
    } else {
      openAliasModal(ids, e.clientX, e.clientY)
    }
  }

  const showHover = (m: Material, e: React.MouseEvent): void => {
    if (!m.thumbReady || !m.thumbnailPath) return
    setHover({ src: mediaUrl(m.thumbnailPath), x: e.clientX, y: e.clientY })
  }

  // 写回排序（与归一化幂等）。顺序无变化则跳过，避免无谓刷新。
  // 从 store 即时读取，避免被闭包里的旧 materials/view 影响（键盘调序也复用它）。
  const persist = async (ids: number[]): Promise<void> => {
    const st = useStore.getState()
    if (st.view.type !== 'program' || !st.view.id) return
    const cur = st.materials.map((m) => m.id)
    if (ids.length === cur.length && ids.every((id, k) => id === cur[k])) return
    await api.reorderProgram(st.view.id, ids)
    await st.setProgramSort('manual')
  }

  // ---- 手动节目视图：分块 + 受约束拖拽 ----
  const blocks = manualProgram ? buildBlocks(materials) : []
  const introOffset = blocks[0]?.kind === 'intro' ? 1 : 0
  const indexOfId = new Map(materials.map((m, i) => [m.id, i]))
  // 键盘调序高亮目标（虚线框）
  const reorder = manualProgram ? resolveReorder(blocks, selection) : null
  // 当前节目里已有的别名（去重去空），供右键「选择别名」子菜单
  const programAliases = isProgram
    ? [...new Set(materials.map((m) => m.alias?.trim()).filter((a): a is string => !!a))]
    : []

  // 落点统一处理：blockIndex=目标块，memberIndex=目标块内成员下标（-1=块头）
  const onRowDrop = (blockIndex: number, memberIndex: number, e: React.DragEvent): void => {
    e.preventDefault()
    const d = drag.current
    drag.current = null
    if (!d) return

    if (d.type === 'item') {
      // 组内调序：只允许落在同一父块
      const blk = blocks[blockIndex]
      if (!blk || blk.key !== d.blockKey) return
      const items = blk.items
      const from = items.findIndex((x) => x.id === d.id)
      if (from < 0) return
      let to = memberIndex < 0 ? 0 : memberIndex + (pointerAfter(e) ? 1 : 0)
      if (to > from) to -= 1
      if (to < 0) to = 0
      if (to > items.length - 1) to = items.length - 1
      if (to === from) return
      const next = [...items]
      const [mv] = next.splice(from, 1)
      next.splice(to, 0, mv)
      const newBlocks = blocks.map((b) => (b.key === blk.key ? { ...b, items: next } : b))
      void persist(flattenIds(newBlocks))
    } else {
      // 整块移动：仅在非 intro 区域之间；不可越过 intro 置顶
      const a = d.blockIndex
      if (a === blockIndex || a < introOffset) return
      const insert = blockIndex + (pointerAfter(e) ? 1 : 0)
      const arr = [...blocks]
      const [mv] = arr.splice(a, 1)
      let t = insert > a ? insert - 1 : insert
      if (t < introOffset) t = introOffset
      if (t > arr.length) t = arr.length
      arr.splice(t, 0, mv)
      void persist(flattenIds(arr))
    }
  }

  const rowCommon = (m: Material): {
    selected: boolean
    onOpen: () => void
    onSelect: (e: React.MouseEvent) => void
    onContext: (e: React.MouseEvent) => void
    onThumbEnter: (e: React.MouseEvent) => void
    onThumbMove: (e: React.MouseEvent) => void
    onThumbLeave: () => void
    index: number
  } => {
    const gi = indexOfId.get(m.id) ?? 0
    return {
      selected: selection.has(m.id),
      onOpen: () => useStore.getState().openPreviewAt(gi),
      onSelect: (e) => onSelect(gi, e),
      onContext: (e) => onContext(gi, e),
      onThumbEnter: (e) => showHover(m, e),
      onThumbMove: (e) => showHover(m, e),
      onThumbLeave: () => setHover(null),
      index: gi
    }
  }

  return (
    <div
      className="p-4"
      onClick={() => {
        if (menu) setMenu(null)
        if (ctx) setCtx(null)
      }}
    >
      <div className="bg-white rounded-[9px] overflow-hidden border-[0.5px] border-[var(--line)]">
        <div
          className="grid items-center gap-[10px] px-[14px] py-2 text-[11px] font-bold text-[var(--text3)] uppercase border-b-[0.5px] border-[var(--line)] bg-[#fafafa]"
          style={{ gridTemplateColumns: cols }}
        >
          <div>预览</div>
          <div>拍摄时间{!manualProgram && ' ↑'}</div>
          <div>时长</div>
          <div>类型</div>
          <div>标签</div>
          <div>文件名</div>
          <div>大小</div>
          <div>技术参数</div>
        </div>

        {manualProgram
          ? blocks.map((b, bi) =>
              b.kind === 'single' ? (
                <ListRow
                  key={b.key}
                  m={b.items[0]}
                  cols={cols}
                  isProgram
                  dashed={reorder?.kind === 'block' && reorder.blockKey === b.key}
                  {...rowCommon(b.items[0])}
                  draggable
                  onDragStart={() => (drag.current = { type: 'block', blockIndex: bi })}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onRowDrop(bi, -1, e)}
                />
              ) : (
                <div
                  key={b.key}
                  style={
                    reorder?.kind === 'block' && reorder.blockKey === b.key
                      ? { outline: '2px dashed #0a84ff', outlineOffset: '-2px', borderRadius: '6px' }
                      : undefined
                  }
                >
                  <BlockHeader
                    block={b}
                    draggable={b.kind === 'group'}
                    selected={reorder?.kind === 'block' && reorder.blockKey === b.key}
                    onSelect={() => useStore.getState().setSelection(b.items.map((m) => m.id))}
                    onDragStart={() => (drag.current = { type: 'block', blockIndex: bi })}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onRowDrop(bi, -1, e)}
                  />
                  {b.items.map((m, mi) => (
                    <ListRow
                      key={m.id}
                      m={m}
                      cols={cols}
                      isProgram
                      accent={b.kind === 'intro' ? CLIP_TYPE.intro.color : '#e0a200'}
                      dashed={reorder?.kind === 'item' && reorder.id === m.id}
                      {...rowCommon(m)}
                      draggable
                      onDragStart={() => (drag.current = { type: 'item', blockKey: b.key, id: m.id })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onRowDrop(bi, mi, e)}
                    />
                  ))}
                </div>
              )
            )
          : materials.map((m, i) => (
              <ListRow
                key={m.id}
                m={m}
                cols={cols}
                isProgram={isProgram}
                {...rowCommon(m)}
                index={i}
                draggable={!isProgram}
                onDragStart={!isProgram ? (e) => onFolderDragStart(i, e) : undefined}
              />
            ))}
      </div>

      {hover && <HoverPreview hover={hover} />}
      {menu && <AliasMenu menu={menu} onClose={() => setMenu(null)} />}
      {ctx && (
        <ProgramContextMenu
          ctx={ctx}
          aliases={programAliases}
          onClose={() => setCtx(null)}
          onPickAlias={(alias) => {
            void useStore.getState().setAliasLocal(ctx.ids, alias)
            setCtx(null)
          }}
          onEditAlias={() => {
            const { x, y, ids } = ctx
            setCtx(null)
            openAliasModal(ids, x, y)
          }}
          onRemove={() => {
            void useStore.getState().removeFromProgram(ctx.ids)
            setCtx(null)
          }}
          onSetType={(type) => {
            void useStore.getState().setClipTypeLocal(ctx.ids, type)
            setCtx(null)
          }}
        />
      )}
    </div>
  )
}

// 组头：intro 组（置顶、不可整组移动）/ 别名组（带整组拖动手柄）
function BlockHeader({
  block,
  draggable,
  selected,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop
}: {
  block: Block
  draggable: boolean
  selected?: boolean
  onSelect?: () => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}): JSX.Element {
  const isIntro = block.kind === 'intro'
  return (
    <div
      draggable={draggable}
      onClick={onSelect}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex items-center gap-2 px-[14px] py-[5px] border-b-[0.5px] border-[#f0f0f2] text-[11px] cursor-pointer ${
        selected ? 'bg-[#eaf3ff]' : isIntro ? 'bg-[#eef3fb]' : 'bg-[#fff8ec]'
      }`}
    >
      {draggable ? (
        <span className="cursor-grab text-[var(--text3)] text-sm leading-none" title="整组拖动">
          ⠿
        </span>
      ) : (
        <span className="text-[13px] leading-none">🎬</span>
      )}
      <span
        className="font-semibold px-[6px] py-[1px] rounded text-white"
        style={{ background: isIntro ? CLIP_TYPE.intro.color : '#9a6a00' }}
      >
        {isIntro ? CLIP_TYPE.intro.label : block.kind === 'group' ? block.alias : ''}
      </span>
      <span className="text-[var(--text3)]">
        {block.items.length} 个素材 · {isIntro ? '置顶' : '整组可拖动'}
      </span>
    </div>
  )
}

// 鼠标悬停大图：跟随光标，避让视口边缘
function HoverPreview({ hover }: { hover: HoverState }): JSX.Element {
  const W = 380
  const H = 214
  const pad = 16
  let left = hover.x + 20
  if (left + W + pad > window.innerWidth) left = hover.x - W - 20
  let top = hover.y - H / 2
  if (top < pad) top = pad
  if (top + H + pad > window.innerHeight) top = window.innerHeight - H - pad
  return (
    <div
      className="fixed z-[70] pointer-events-none rounded-lg overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.5)] border border-black/30 bg-black"
      style={{ left, top, width: W, height: H }}
    >
      <img src={hover.src} className="w-full h-full object-contain" />
    </div>
  )
}

// 别名菜单：为一个或多个素材取别名（可相同）。相同别名即为同一组。
function AliasMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }): JSX.Element {
  const [v, setV] = useState(menu.alias)
  const left = Math.min(menu.x, window.innerWidth - 260)
  const top = Math.min(menu.y, window.innerHeight - 150)
  const commit = async (alias: string | null): Promise<void> => {
    await useStore.getState().setAliasLocal(menu.ids, alias)
    onClose()
  }
  return (
    <div
      className="fixed z-[80] w-[240px] bg-white rounded-lg shadow-[0_12px_40px_rgba(0,0,0,0.3)] border-[0.5px] border-[var(--line)] p-3"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[12px] font-semibold mb-2">
        为 {menu.ids.length} 个素材设置别名
      </div>
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit(v.trim() || null)
          if (e.key === 'Escape') onClose()
        }}
        placeholder="输入别名，回车确定"
        className="w-full text-[13px] border-[0.5px] border-[var(--line)] rounded-[7px] px-[9px] py-[6px] mb-[10px] focus:border-accent outline-none"
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => void commit(null)}
          className="text-[12px] text-[var(--text2)] px-[10px] py-[5px] rounded-md hover:bg-[#f1f1f3]"
        >
          清除别名
        </button>
        <button
          onClick={() => void commit(v.trim() || null)}
          className="text-[12px] text-white bg-accent px-[12px] py-[5px] rounded-md"
        >
          确定
        </button>
      </div>
    </div>
  )
}

// 节目列表右键上下文菜单：选择别名▸ / 修改别名 / 移除素材 / 修改类型▸
function ProgramContextMenu({
  ctx,
  aliases,
  onClose: _onClose,
  onPickAlias,
  onEditAlias,
  onRemove,
  onSetType
}: {
  ctx: CtxState
  aliases: string[]
  onClose: () => void
  onPickAlias: (alias: string) => void
  onEditAlias: () => void
  onRemove: () => void
  onSetType: (type: ClipType | null) => void
}): JSX.Element {
  const [sub, setSub] = useState<'alias' | 'type' | null>(null)
  const W = 176
  const SUBW = 168
  const left = Math.min(ctx.x, window.innerWidth - W - 8)
  const top = Math.min(ctx.y, window.innerHeight - 200)
  const openLeft = left + W + SUBW + 8 > window.innerWidth
  const subPos: React.CSSProperties = openLeft
    ? { right: '100%', marginRight: 2 }
    : { left: '100%', marginLeft: 2 }

  const itemCls =
    'flex items-center justify-between w-full px-3 py-[6px] text-[13px] text-left hover:bg-[#eaf3ff] rounded-[5px] whitespace-nowrap'
  const subBoxCls =
    'absolute top-0 bg-white rounded-lg shadow-[0_12px_40px_rgba(0,0,0,0.3)] border-[0.5px] border-[var(--line)] p-1'

  return (
    <div
      className="fixed z-[80] bg-white rounded-lg shadow-[0_12px_40px_rgba(0,0,0,0.3)] border-[0.5px] border-[var(--line)] p-1"
      style={{ left, top, width: W }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-[5px] text-[11px] text-[var(--text3)]">已选 {ctx.ids.length} 个素材</div>

      <div className="relative" onMouseEnter={() => setSub('alias')}>
        <button className={itemCls}>
          <span>选择别名</span>
          <span className="text-[var(--text3)]">▸</span>
        </button>
        {sub === 'alias' && (
          <div className={`${subBoxCls} max-h-[260px] overflow-auto`} style={{ ...subPos, width: SUBW }}>
            {aliases.length ? (
              aliases.map((a) => (
                <button key={a} className={itemCls} onClick={() => onPickAlias(a)}>
                  <span className="truncate">{a}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-[6px] text-[12px] text-[var(--text3)]">暂无别名</div>
            )}
          </div>
        )}
      </div>

      <button className={itemCls} onMouseEnter={() => setSub(null)} onClick={onEditAlias}>
        <span>修改别名</span>
      </button>

      <button
        className="flex items-center w-full px-3 py-[6px] text-[13px] text-left rounded-[5px] whitespace-nowrap text-[#d70015] hover:bg-[#ffecec]"
        onMouseEnter={() => setSub(null)}
        onClick={onRemove}
      >
        移除素材
      </button>

      <div className="relative" onMouseEnter={() => setSub('type')}>
        <button className={itemCls}>
          <span>修改类型</span>
          <span className="text-[var(--text3)]">▸</span>
        </button>
        {sub === 'type' && (
          <div className={subBoxCls} style={{ ...subPos, width: SUBW }}>
            {TYPE_OPTIONS.map((o) => (
              <button key={o.label} className={itemCls} onClick={() => onSetType(o.value)}>
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ListRow({
  m,
  index,
  cols,
  isProgram,
  selected,
  accent,
  dashed,
  onOpen,
  onSelect,
  onContext,
  onThumbEnter,
  onThumbMove,
  onThumbLeave,
  draggable,
  onDragStart,
  onDragOver,
  onDrop
}: {
  m: Material
  index: number
  cols: string
  isProgram: boolean
  selected: boolean
  accent?: string
  dashed?: boolean
  onOpen: () => void
  onSelect: (e: React.MouseEvent) => void
  onContext: (e: React.MouseEvent) => void
  onThumbEnter: (e: React.MouseEvent) => void
  onThumbMove: (e: React.MouseEvent) => void
  onThumbLeave: () => void
  draggable: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}): JSX.Element {
  const dimmed = m.status === 'deleted'
  const typeColor = m.clipType ? CLIP_TYPE[m.clipType].color : null
  const typed = !!typeColor
  // 着色行内文字改用浅色以保证可读性
  const sub = typed ? 'text-white/90' : 'text-[var(--text2)]'
  const faint = typed ? 'text-white/75' : 'text-[var(--text4)]'

  const style: React.CSSProperties = { gridTemplateColumns: cols }
  if (typeColor) style.background = typeColor
  if (accent) style.boxShadow = `inset 3px 0 0 ${accent}`
  // 键盘调序高亮：虚线框（优先于选中态的实线描边）
  if (dashed) {
    style.outline = '2px dashed #0a84ff'
    style.outlineOffset = '-2px'
    style.position = 'relative'
    style.zIndex = 1
  }

  return (
    <div
      data-mid={m.id}
      style={style}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContext}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`grid items-center gap-[10px] px-[14px] py-2 text-xs border-b-[0.5px] border-[#f0f0f2] cursor-pointer ${
        typed
          ? `text-white ${selected ? 'outline outline-2 -outline-offset-2 outline-white' : ''}`
          : selected
            ? 'bg-[#eaf3ff]'
            : 'hover:bg-[#f7f7f9]'
      } ${dimmed ? 'opacity-60' : ''}`}
    >
      <div
        className="w-[54px] h-[31px] rounded-[5px] relative overflow-hidden bg-[#15151a]"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        onMouseEnter={onThumbEnter}
        onMouseMove={onThumbMove}
        onMouseLeave={onThumbLeave}
      >
        {m.thumbReady && m.thumbnailPath ? (
          <img
            src={mediaUrl(m.thumbnailPath)}
            className={`w-full h-full object-cover ${m.status !== 'unused' ? 'grayscale' : ''} ${
              m.status === 'deleted' ? 'brightness-[0.6]' : ''
            }`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="spin !w-3 !h-3" />
          </div>
        )}
        {m.status === 'deleted' && (
          <div className="absolute inset-0 flex items-center justify-center text-xred text-[19px]">✕</div>
        )}
      </div>

      <div className="flex items-center gap-[6px] whitespace-nowrap">
        <PeriodChip period={m.period} />
        <span className={`text-[11px] ${sub}`}>{fmtShoot(m.shootAt)}</span>
      </div>

      <div className={`text-[11px] ${sub}`}>{fmtDuration(m.durationSec)}</div>

      <div>
        {m.clipType ? (
          <span
            className={`text-[10px] font-semibold px-[7px] py-[2px] rounded-[5px] ${
              typed ? 'bg-white/25 text-white' : 'text-white'
            }`}
            style={typed ? undefined : { background: CLIP_TYPE[m.clipType].color }}
          >
            {CLIP_TYPE[m.clipType].label}
          </span>
        ) : (
          <span className={`text-[10px] font-medium ${faint}`}>A-roll</span>
        )}
      </div>

      <div className="flex gap-[5px] flex-wrap">
        {m.tags.map((t) => (
          <span
            key={t}
            className={`text-[10px] px-[7px] py-[1px] rounded-[5px] whitespace-nowrap ${
              typed ? 'bg-white/20 text-white' : 'bg-[#f1f1f3] text-[var(--text2)]'
            }`}
          >
            {t}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 min-w-0">
        <span style={{ background: DOT[m.status] }} className="w-2 h-2 rounded-full flex-shrink-0" />
        <div className="min-w-0">
          {m.alias && (
            <span
              className={`text-[10px] font-semibold mr-[5px] px-[5px] py-[1px] rounded ${
                typed ? 'bg-white/25 text-white' : 'bg-[#fff2d6] text-[#9a6a00]'
              }`}
            >
              {m.alias}
            </span>
          )}
          <span className="font-medium truncate text-xs align-middle">{m.fileName}</span>
        </div>
      </div>

      <div className={`text-[11px] ${sub}`}>{fmtSize(m.fileSize)}</div>
      <div className={`text-[10px] leading-[1.45] ${faint}`}>
        {(() => {
          const dev = m.folderName ? deviceOf(m) : ''
          return (
            <>
              {dev && (
                <>
                  <b className={`font-medium ${typed ? 'text-white' : 'text-[var(--text3)]'}`}>{dev}</b>
                  {' · '}
                </>
              )}
              {fmtResolution(m.width, m.height)}
            </>
          )
        })()}
        <br />
        <b className={`font-medium ${typed ? 'text-white' : 'text-[var(--text3)]'}`}>
          {m.codec?.toUpperCase() ?? '—'}
        </b>
        ·{fmtBitrate(m.bitrate)}·{m.format ?? '—'}
      </div>
    </div>
  )
}

// 设备来自文件夹，列表里直接显示文件夹设备（通过 store 查询代价高，这里用素材附带信息回退）
function deviceOf(m: Material): string {
  const folders = useStore.getState().folders
  return folders.find((f) => f.id === m.folderId)?.device ?? ''
}
