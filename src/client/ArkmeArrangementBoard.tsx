import { ArkmeArrangementRecognition } from './ArkmeArrangementRecognition.js'
import { readArrangementBoardMemory, loadArrangementBoardCache, saveArrangementBoardCache } from './arrangement-board-cache.js'
import { ArkmeArrangementContent } from './ArkmeArrangementContent.js'
import { Fragment, useEffect, useRef, useState } from 'react'
import { DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, pointerWithin, closestCenter, useSensor, useSensors, type DragStartEvent, type DragOverEvent, type DragEndEvent, type CollisionDetection } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { ArrangementPointerSensor, ArrangementSortableCard, ArrangementDropList, ArrangementDropHeader, ArrangementDragSnapshot } from './ArrangementSortable.js'
import { placementOf, projectPlacement, samePlacement, type BoardItems, type Placement } from './arrangement-sort-model.js'
import { Lightbulb } from '@phosphor-icons/react/dist/icons/Lightbulb'
import { ArrowsClockwise } from '@phosphor-icons/react/dist/icons/ArrowsClockwise'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import type { ArkmeArrangementItem, ArkmeArrangementPage, ArkmeArrangementReorderResult } from '../types.js'
import { callArkme } from './api.js'
import { tr, useArkmeLocale } from './locale.js'
import { ArkmeArrangementReminder, validArrangementReminderTime } from './ArkmeArrangementReminder.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arrangementColumns, arrangementColumnLabels, moveArrangement, type ArrangementColumn } from './arrangement-board-model.js'

type ColumnState = { cached?: boolean; board?: { supported: boolean; version: string } | undefined; total: number | undefined; items: ArkmeArrangementItem[]; loading: boolean; error: boolean; nextOffset: number | undefined }
type PendingMove = { item: ArkmeArrangementItem; target: ArrangementColumn; placement: Placement }
const columnIcons = { identified: Lightbulb, following: ArrowsClockwise, completed: Check }
const emptyColumn = (): ColumnState => ({ total: undefined, items: [], loading: false, error: false, nextOffset: undefined })

export function ArkmeArrangementBoard(props: { accountScope: string; onBack(): void; onAddArrangement?(): void; createdItems?: ArkmeArrangementItem[] }) {
  return <ArrangementBoard key={props.accountScope} {...props} />
}

function ArrangementBoard({ accountScope, onBack, onAddArrangement, createdItems }: { accountScope: string; onBack(): void; onAddArrangement?(): void; createdItems?: ArkmeArrangementItem[] }) {
  useArkmeLocale()
  const [expanded, setExpanded] = useState(new Set<string>())
  const suppressedClick = useRef(false)
  const pointerStart = useRef<{ x: number; y: number }>()
  function toggleCard(ref: string) {
    setExpanded(previous => { const next = new Set(previous); if (next.has(ref)) next.delete(ref); else next.add(ref); return next })
  }
  const [now, setNow] = useState(Date.now)
  const [columns, setColumns] = useState(() => {
    const pages = readArrangementBoardMemory(accountScope)
    return Object.fromEntries(arrangementColumns.map(status => {
      const page = pages[status]
      return [status, { ...emptyColumn(), ...(page ? { items: page.items, total: page.total, board: page.board, nextOffset: page.nextOffset, cached: true } : {}), loading: !!accountScope }]
    })) as Record<ArrangementColumn, ColumnState>
  })
  const liveColumns = useRef(new Set<ArrangementColumn>())
  const state = useRef(columns)
  const staleColumns = useRef(new Set<ArrangementColumn>())
  const requests = useRef(new Map<ArrangementColumn, AbortController>())
  const lifetime = useRef<AbortController>()
  const pending = useRef(new Map<string, PendingMove>())
  const [moves, setMoves] = useState(new Map<string, PendingMove>())
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState<ArkmeArrangementItem>()
  const dragRef = useRef<ArkmeArrangementItem>()
  const [projection, setProjection] = useState<BoardItems>()
  const projected = useRef<BoardItems>()
  const initialPlacement = useRef<Placement>()
  const collisionGeometry = useRef<{ pointer: { x: number; y: number } | null; rects: Map<string, { top: number; height: number }> }>({ pointer: null, rects: new Map() })
  const lastProjectionProbe = useRef<{ x: number; y: number; scrollTop: number; status: ArrangementColumn }>()
  const [snapshot, setSnapshot] = useState<{node: HTMLElement; width: number; height: number}>()
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined
    if (!media) return
    const change = () => setReducedMotion(media.matches)
    change(); media.addEventListener?.('change', change)
    return () => media.removeEventListener?.('change', change)
  }, [])
  const sensors = useSensors(useSensor(ArrangementPointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const locked = (status: ArrangementColumn) => [...pending.current.values()].some(move => move.item.status === status || move.target === status || move.item.status === 'completed' && move.target === 'identified' && status === 'following')
  const enabled = (status: ArrangementColumn) => !state.current[status].cached && !!state.current[status].board?.supported && (!state.current[status].loading || state.current[status].items.length > 0) && !state.current[status].error && !locked(status)
  const boardItems = (): BoardItems => Object.fromEntries(arrangementColumns.map(status => [status, state.current[status].items])) as BoardItems
  const [over, setOver] = useState<ArrangementColumn>()
  const lists = useRef(new Map<ArrangementColumn, HTMLDivElement>())

  function update(status: ArrangementColumn, value: ColumnState) {
    state.current = { ...state.current, [status]: value }
    setColumns(state.current)
  }
  function persist(statuses: ArrangementColumn[]) {
    saveArrangementBoardCache(accountScope, Object.fromEntries(statuses.flatMap(status => {
      const value = state.current[status]
      return value.total === undefined || value.cached || value.error ? [] : [[status, {
        items: value.items.slice(0, 50), total: value.total, board: value.board,
        hasMore: value.total > Math.min(50, value.items.length),
      }]]
    })))
  }
  async function load(status: ArrangementColumn, reset = false): Promise<boolean> {
    if (!accountScope || lifetime.current?.signal.aborted || locked(status)) return false
    if (!reset && staleColumns.current.has(status)) return reconcile([status], lifetime.current!.signal)
    const before = state.current[status]
    if (!reset && (before.loading || before.nextOffset === undefined)) return false
    if (!reset && before.cached) return load(status, true)
    requests.current.get(status)?.abort()
    const controller = new AbortController()
    requests.current.set(status, controller)
    const offset = reset ? 0 : before.nextOffset!
    if (reset && dragRef.current) clearDrag()
    update(status, { ...before, loading: true, error: false })
    try {
      const page = await withArkmeReadDeadline(signal => callArkme<ArkmeArrangementPage>('arrangements.list', { status, limit: 50, offset, order: 'board', ...(!reset && before.board?.version ? { boardVersion: before.board.version } : {}) }, signal), controller.signal)
      if (controller.signal.aborted) return false
      const items = [...new Map([...(reset ? [] : before.items), ...page.items].filter(item => item.status === status).map(item => [item.arrangementRef, item])).values()]
      if (projected.current && !reset) {
        const refs = new Set(arrangementColumns.flatMap(key => projected.current![key].map(item => item.arrangementRef)))
        projected.current = { ...projected.current, [status]: [...projected.current[status], ...items.filter(item => !refs.has(item.arrangementRef))] }
        setProjection(projected.current)
      }
      liveColumns.current.add(status)
      update(status, { cached: false, board: page.board, total: page.total, items, loading: false, error: false, nextOffset: page.hasMore && page.nextOffset !== undefined && page.nextOffset > offset ? page.nextOffset : undefined })
      if (reset) persist([status])
      return true
    } catch (error) {
      if (!controller.signal.aborted && !reset && typeof error === 'object' && error !== null && 'code' in error && error.code === 'arrangement-board-conflict') return load(status, true)
      if (!controller.signal.aborted) update(status, { ...state.current[status], loading: false, error: true })
      return false
    }
  }
  // Read a coherent loaded prefix in the background. Keep the rendered list and
  // scroll container intact, and publish all affected columns together.
  async function reconcile(statuses: ArrangementColumn[], signal: AbortSignal): Promise<boolean> {
    const results = await Promise.all(statuses.map(async status => {
      requests.current.get(status)?.abort()
      const controller = new AbortController()
      requests.current.set(status, controller)
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) controller.abort()
      const before = state.current[status]
      const wanted = Math.max(1, before.items.length)
      try {
        let offset = 0
        let version: string | undefined
        const items = new Map<string, ArkmeArrangementItem>()
        let value: ColumnState
        do {
          const page = await withArkmeReadDeadline(readSignal => callArkme<ArkmeArrangementPage>('arrangements.list', {
            status, limit: 50, offset, order: 'board', ...(version ? { boardVersion: version } : {}),
          }, readSignal), controller.signal)
          controller.signal.throwIfAborted()
          if (version && page.board?.version !== version) throw new Error('Board version changed')
          version = page.board?.version
          for (const item of page.items) if (item.status === status) items.set(item.arrangementRef, item)
          const nextOffset = page.hasMore && page.nextOffset !== undefined && page.nextOffset > offset ? page.nextOffset : undefined
          value = { items: [...items.values()], total: page.total, board: page.board, loading: false, error: false, nextOffset }
          if (nextOffset === undefined || items.size >= wanted) break
          offset = nextOffset
        } while (true)
        return { status, value, controller }
      } catch {
        return { status, value: { ...before, loading: false, error: true }, controller }
      } finally { signal.removeEventListener('abort', abort) }
    }))
    if (signal.aborted) return false
    const accepted = results.filter(({ status, controller }) => !controller.signal.aborted && requests.current.get(status) === controller)
    state.current = { ...state.current, ...Object.fromEntries(accepted.map(({ status, value }) => [status, value])) }
    for (const { status, value } of accepted) if (!value.error) { staleColumns.current.delete(status); liveColumns.current.add(status) }
    setColumns(state.current)
    persist(accepted.map(({ status }) => status))
    return accepted.length === statuses.length && accepted.every(({ value }) => !value.error)
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    if (accountScope) {
      void loadArrangementBoardCache(accountScope, controller.signal).then(pages => {
        if (controller.signal.aborted) return
        for (const status of arrangementColumns) {
          const page = pages[status]
          const before = state.current[status]
          if (!page || liveColumns.current.has(status) || before.total !== undefined) continue
          update(status, { ...before, items: page.items, total: page.total, board: page.board, nextOffset: page.nextOffset, cached: true })
        }
      })
      for (const status of arrangementColumns) void load(status, true)
    }
    return () => { controller.abort(); for (const request of requests.current.values()) request.abort() }
  }, [accountScope])

  const previousCreatedItems = useRef(createdItems)
  useEffect(() => {
    if (previousCreatedItems.current === createdItems) return
    previousCreatedItems.current = createdItems
    const signal = lifetime.current?.signal
    if (accountScope && signal && createdItems?.length) {
      // Creation and recognition update in place, preserving list scroll and cards.
      void reconcile(arrangementColumns.filter(status => !locked(status)), signal)
    }
  }, [createdItems, accountScope])

  // One clock for the board: expire at the next visible deadline, and reconcile
  // after sleep/focus or system-clock changes without reloading arrangement data.
  useEffect(() => {
    const times = [...arrangementColumns.flatMap(status => columns[status].items), ...[...moves.values()].map(move => move.item)]
      .map(item => item.remindAtMillis).filter(validArrangementReminderTime)
    if (!times.length) return
    const current = Date.now()
    const crossedDeadline = times.some(time => (time > now) !== (time > current))
    const nextDelay = crossedDeadline ? 0 : times.reduce((delay, time) => time > current ? Math.min(delay, time - current) : delay, 60_000)
    const refresh = () => setNow(Date.now())
    const timer = setTimeout(refresh, nextDelay)
    if (typeof window !== 'undefined') window.addEventListener('focus', refresh)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      if (typeof window !== 'undefined') window.removeEventListener('focus', refresh)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', refresh)
    }
  }, [columns, moves, now])

  function clearDrag() { collisionGeometry.current = { pointer: null, rects: new Map() }; lastProjectionProbe.current = undefined; dragRef.current = undefined; setDragging(undefined); setOver(undefined); projected.current = undefined; setProjection(undefined) }
  function startDrag(event: DragStartEvent) {
    const item = arrangementColumns.flatMap(status => state.current[status].items).find(item => item.arrangementRef === event.active.id)
    if (!item || item.status === 'unknown' || !enabled(item.status)) return
    suppressedClick.current = true; dragRef.current = item; setDragging(item)
    initialPlacement.current = placementOf(boardItems(), item.arrangementRef)
    projected.current = boardItems(); setProjection(projected.current)
    const node = lists.current.get(item.status)?.querySelector<HTMLElement>(`[data-arrangement-ref="${CSS.escape(item.arrangementRef)}"]`)
    if (node) { const rect = node.getBoundingClientRect(); setSnapshot({node: node.cloneNode(true) as HTMLElement, width: rect.width, height: rect.height}) }
  }
  function projectDrag(event: DragOverEvent) {
    const item = dragRef.current
    if (!item || !event.over || !projected.current) { setOver(undefined); return }
    const target = event.over.data.current?.status as ArrangementColumn | undefined
    if (!target || !enabled(target)) { setOver(undefined); return }
    // Sensor delta includes scroll adjustment; collision coordinates are viewport coordinates.
    const pointer = collisionGeometry.current.pointer
    const translated = event.active.rect.current.translated
    const x = pointer ? pointer.x : (translated?.left ?? 0) + (translated?.width ?? 0) / 2
    const y = pointer ? pointer.y : (translated?.top ?? 0) + (translated?.height ?? 0) / 2
    const scrollTop = lists.current.get(target)?.scrollTop ?? 0
    const previousProbe = lastProjectionProbe.current
    // A layout update can fire onDragOver again at the same pointer position.
    // Keep the previous insertion instead of chasing the card as it makes room.
    if (previousProbe && previousProbe.x === x && previousProbe.y === y && previousProbe.scrollTop === scrollTop && previousProbe.status === target) { setOver(target); return }
    const rows = projected.current[target].filter(row => row.arrangementRef !== item.arrangementRef)
    let index = rows.findIndex(row => row.arrangementRef === event.over?.id)
    if (event.over.data.current?.edge === 'start') {
      index = 0
    } else if (index < 0) {
      if (event.over.id === item.arrangementRef) return
      // Container collisions include the gaps between cards. Find the next visible
      // midpoint rather than interpreting every gap as the end of the column.
      index = rows.findIndex(row => {
        const rect = collisionGeometry.current.rects.get(row.arrangementRef)
        return rect !== undefined && y < rect.top + rect.height / 2
      })
      if (index < 0) index = rows.length
    } else {
      const midpoint = event.over.rect.top + event.over.rect.height / 2
      const keyboardDown = !pointer && (previousProbe ? y > previousProbe.y : (event.delta?.y ?? 0) > 0)
      if (y > midpoint || y === midpoint && keyboardDown) index++
    }
    lastProjectionProbe.current = { x, y, scrollTop, status: target }
    const next = projectPlacement(projected.current, item, target, index)
    if (!samePlacement(placementOf(next,item.arrangementRef),placementOf(projected.current,item.arrangementRef))) {
      projected.current = next; setProjection(next)
    }
    setOver(target)
  }
  const collisionDetection: CollisionDetection = args => {
    collisionGeometry.current = { pointer: args.pointerCoordinates, rects: new Map([...args.droppableRects].map(([id, rect]) => [String(id), rect])) }
    if (!args.pointerCoordinates) return closestCenter(args)
    const hits = pointerWithin(args)
    const cards = hits.filter(hit => !String(hit.id).startsWith('column:') && !String(hit.id).startsWith('top:'))
    return cards.length ? cards : hits
  }
  async function finishDrag(event: DragEndEvent) {
    const item = dragRef.current
    const placement = item && projected.current ? placementOf(projected.current,item.arrangementRef) : undefined
    const committed = projected.current
    clearDrag()
    if (!item || !event.over || !placement || samePlacement(initialPlacement.current, placement) || !enabled(placement.status) || pending.current.has(item.arrangementRef)) return
    const controller = lifetime.current
    if (!controller || controller.signal.aborted) return
    const target = placement.status
    const affected = new Set<ArrangementColumn>([item.status as ArrangementColumn, target])
    if (item.status === 'completed' && target === 'identified') affected.add('following')
    for (const status of affected) {
      requests.current.get(status)?.abort()
      const column = state.current[status]
      const delta = item.status === target ? 0 : status === target ? 1 : status === item.status ? -1 : 0
      update(status, { ...column, loading: false,
        items: (committed?.[status] ?? column.items).map(row => row.arrangementRef === item.arrangementRef ? { ...row, status: target } : row),
        total: column.total === undefined ? undefined : Math.max(0, column.total + delta),
      })
    }
    pending.current.set(item.arrangementRef, { item, target, placement }); setMoves(new Map(pending.current)); setMessage('')
    try {
      // A prior move out of this column invalidated its version. Reconcile only
      // when the column is used again, never on the previous save's critical path.
      if (staleColumns.current.has(target) && !await reconcile([target], controller.signal)) throw new Error('Board reconciliation failed')
      let version = state.current[target].board?.version
      let confirmedItem: ArkmeArrangementItem | undefined
      if (item.status !== target) {
        confirmedItem = await moveArrangement(item, target, controller.signal)
        // The state transition advances the target version; keep the user's anchors.
        const fresh = await withArkmeReadDeadline(signal => callArkme<ArkmeArrangementPage>('arrangements.list', { status: target, limit: 1, offset: 0, order: 'board' }, signal), controller.signal)
        if (!fresh.board?.supported) throw new Error('Board sorting unavailable')
        version = fresh.board.version
      }
      controller.signal.throwIfAborted()
      if (!version) throw new Error('Board sorting unavailable')
      const result = await callArkme<ArkmeArrangementReorderResult>('arrangements.reorder', { arrangementRef: item.arrangementRef, ...placement, boardVersion: version, requestId: crypto.randomUUID() }, controller.signal)
      controller.signal.throwIfAborted()
      if (!result.board?.supported || !result.board.version) throw new Error('Board version missing')
      // The successful CAS confirms this placement. Keep the loaded prefix and
      // advance its cursor locally instead of fetching every page again.
      const current = state.current[target]
      const rows = current.items.filter(row => row.arrangementRef !== item.arrangementRef)
      const before = rows.findIndex(row => row.arrangementRef === placement.beforeRef)
      const after = rows.findIndex(row => row.arrangementRef === placement.afterRef)
      // Reconciliation may have removed the optimistic card before the state
      // transition. Insert the confirmed result, including reminder/source fields.
      const actual = confirmedItem ?? current.items.find(row => row.arrangementRef === item.arrangementRef) ?? { ...item, status: target }
      rows.splice(before >= 0 ? before : after >= 0 ? after + 1 : 0, 0, actual)
      update(target, { ...current, items: rows, board: result.board,
        nextOffset: current.nextOffset === undefined ? undefined : current.nextOffset + (item.status === target ? 0 : 1),
      })
      for (const status of affected) if (status !== target) staleColumns.current.add(status)
      persist([...affected])
    } catch {
      if (!controller.signal.aborted) {
        const synced = await reconcile([...affected], controller.signal)
        if (!controller.signal.aborted) setMessage(tr(synced ? '安排未能完成移动，已重新读取实际状态；请确认后重试。' : '部分安排暂未同步，请重试加载后再操作。'))
      }
    } finally {
      if (!controller.signal.aborted) {
        pending.current.delete(item.arrangementRef); setMoves(new Map(pending.current))
      }
    }
  }

  return <section className="arkme-arrangement-board" aria-label={tr('安排')}>
    <header className="arkme-arrangement-header"><button type="button" aria-label={tr('返回日历')} onClick={onBack}><ArrowLeft size={20} aria-hidden /></button><h2>{tr('安排')}</h2>{onAddArrangement && <button type="button" className="arkme-arrangement-add" data-arkme-hover="none" onClick={onAddArrangement}><Plus size={16} aria-hidden />{tr('添加安排')}</button>}</header>
    {message && <p role="status" className="arkme-arrangement-message">{message}</p>}
    {!accountScope && <p role="status">{tr('请先登录')}</p>}
    {arrangementColumns.some(status => !columns[status].cached && columns[status].board?.supported === false) && <p className="arkme-arrangement-message" role="status">{tr('当前服务暂不支持手动排序')}</p>}
    <DndContext sensors={sensors} collisionDetection={collisionDetection} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      autoScroll={{ canScroll: (element: HTMLElement) => element === (over ? lists.current.get(over) : undefined) }}
      onDragStart={startDrag} onDragOver={projectDrag} onDragMove={projectDrag} onDragCancel={clearDrag} onDragEnd={finishDrag}
      accessibility={{ screenReaderInstructions: { draggable: tr('按空格开始排序，方向键移动，空格放置，Escape 取消。按 Enter 展开原文。') }, announcements: {
        onDragStart: () => tr('已开始拖动安排'), onDragOver: ({over}: DragOverEvent) => over ? tr('已更新安排插入位置') : tr('当前位置不可放置'), onDragEnd: () => tr('拖动结束'), onDragCancel: () => tr('已取消拖动'),
      } }}>
    <div className="arkme-arrangement-columns">
      {arrangementColumns.map(status => {
        const column = columns[status]
        const StatusIcon = columnIcons[status]
        let display = projection ?? boardItems()
        for (const move of moves.values()) {
          const rows = display[move.target].filter(row => row.arrangementRef !== move.item.arrangementRef)
          const before = rows.findIndex(row => row.arrangementRef === move.placement.beforeRef)
          const after = rows.findIndex(row => row.arrangementRef === move.placement.afterRef)
          display = projectPlacement(display, move.item, move.target, before >= 0 ? before : after >= 0 ? after + 1 : 0)
        }
        const items = display[status]
        return <section key={status} className="arkme-arrangement-column" data-arrangement-column={status} data-drag-over={over === status}
          aria-label={tr(arrangementColumnLabels[status])}>
          <ArrangementDropHeader id={status} disabled={!enabled(status)}>
            <span className="arkme-arrangement-status-icon" aria-hidden="true"><StatusIcon size={16} weight="bold" /></span>
            <div className="arkme-arrangement-heading-copy">
              <h3>{tr(arrangementColumnLabels[status])}<span className="arkme-arrangement-count" data-arrangement-count={status} data-wide={column.total !== undefined && column.total >= 100}>{column.total === undefined && column.loading ? <span className="arkme-arrangement-skeleton-count" aria-label={tr('加载中…')} /> : column.total ?? '—'}</span></h3>
            </div>
          </ArrangementDropHeader>
          <div className="arkme-arrangement-list" data-arrangement-list={status} ref={element => { if (element) lists.current.set(status, element); else lists.current.delete(status) }}
            onScroll={event => { const el = event.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 100 && !column.error) return load(status).then(() => {}) }}>
            <ArrangementDropList id={status} disabled={!enabled(status)}>
            <SortableContext items={items.map(item => item.arrangementRef)} strategy={verticalListSortingStrategy}>
            {items.map((item, index) => <Fragment key={item.arrangementRef}>
            {dragging && dragging.status === status && over && over !== status && snapshot && index === column.items.findIndex(row => row.arrangementRef === dragging.arrangementRef) && <div className="arkme-arrangement-origin-placeholder" aria-hidden="true" style={{ height: snapshot.height }} />}
            <ArrangementSortableCard id={item.arrangementRef} status={status} disabled={!enabled(status)} reducedMotion={reducedMotion} key={item.arrangementRef} className="arkme-arrangement-card"
              tabIndex={0} aria-expanded={expanded.has(item.arrangementRef)}
              onPointerDown={event => { suppressedClick.current = false; pointerStart.current = { x: event.clientX, y: event.clientY } }}
              onPointerMove={event => { const start = pointerStart.current; if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) suppressedClick.current = true }}
              onPointerUp={() => { pointerStart.current = undefined }}
              onPointerCancel={() => { pointerStart.current = undefined; suppressedClick.current = true }}
              onClick={event => {
                if (suppressedClick.current) { suppressedClick.current = false; return }
                if ((event.target as Element)?.closest?.('button, a, input, textarea, select, [contenteditable=true]')) return
                if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
                toggleCard(item.arrangementRef)
              }}
              onKeyDown={event => { if (event.target === event.currentTarget && !event.repeat && (event.key === 'Enter' || !enabled(status) && event.key === ' ')) { event.preventDefault(); toggleCard(item.arrangementRef) } }}
              aria-busy={moves.has(item.arrangementRef)} style={dragging?.arrangementRef === item.arrangementRef && snapshot ? { height: snapshot.height, boxSizing: 'border-box', overflow: 'hidden' } : {}}>
              <div className="arkme-arrangement-card-content">
                <div className="arkme-arrangement-title-row">{item.recognitionState === 'recognizing' && <ArkmeArrangementRecognition />}<h4 title={item.title}>{item.title}</h4></div>
                
                {status !== 'completed' && <ArkmeArrangementReminder atMillis={item.remindAtMillis} now={now} />}
                {moves.has(item.arrangementRef) && <small role="status">{tr('正在保存…')}</small>}
                <ArkmeArrangementContent item={item} expanded={dragging?.arrangementRef !== item.arrangementRef && expanded.has(item.arrangementRef)} />
              </div>
            </ArrangementSortableCard></Fragment>)}
            {dragging && dragging.status === status && over && over !== status && snapshot && column.items.findIndex(row => row.arrangementRef === dragging.arrangementRef) >= items.length && <div className="arkme-arrangement-origin-placeholder" aria-hidden="true" style={{ height: snapshot.height }} />}
            </SortableContext>
            {column.loading && column.total === undefined && <div role="status" aria-label={tr('加载中…')} className="arkme-arrangement-skeletons">
              {[0, 1, 2, 3].map(key => <div key={key} data-arrangement-skeleton={true} className="arkme-arrangement-skeleton-card" aria-hidden="true"><span /><span /></div>)}
            </div>}
            {column.loading && column.total !== undefined && <p role="status">{tr(column.cached ? '正在更新…' : '加载中…')}</p>}
            {column.error && <div role="alert"><p>{tr(column.total !== undefined ? '更新失败，已保留当前内容' : '安排加载失败')}</p><button type="button" onClick={() => { const signal = lifetime.current?.signal; if (column.board && !column.cached && signal) void reconcile(arrangementColumns.filter(key => state.current[key].error), signal); else void load(status, column.nextOffset === undefined) }}>{tr('重试')}</button></div>}
            {!column.loading && !column.error && !items.length && <p className="arkme-arrangement-empty">{tr('暂无安排，可将其他区块的安排拖到这里')}</p>}
            {!column.loading && !column.error && !column.cached && column.nextOffset !== undefined && <button type="button" onClick={() => { void load(status) }}>{tr('加载更多')}</button>}
            </ArrangementDropList>
          </div>
        </section>
      })}
    </div>
    <DragOverlay dropAnimation={reducedMotion ? null : { duration: 180, easing: 'ease' }}>
      {dragging && snapshot ? <ArrangementDragSnapshot {...snapshot} /> : null}
    </DragOverlay>
    </DndContext>
  </section>
}
