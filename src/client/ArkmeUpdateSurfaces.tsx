import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { X } from '@phosphor-icons/react/dist/icons/X'
import {
  arkmeAppUpdateStore,
} from './app-update-store.js'
import {
  arkmePluginUpdateStore,
} from './plugin-update-store.js'
import { useArkmeUpdateUiSnapshot, type ArkmeUpdateTarget } from './update-ui-controller.js'
import { deriveArkmeUpdatePresentation, type ArkmeUpdateItem } from './update-presentation.js'
export { deriveArkmeUpdatePresentation, appUpdateProgress } from './update-presentation.js'
export type { ArkmeUpdateNote, ArkmeUpdateItem, ArkmeUpdatePresentation } from './update-presentation.js'

function railLabel(item: ArkmeUpdateItem): string {
  if (item.uncertain) return '待确认'
  if (item.active) return item.restarting ? '重启' : item.progress === undefined ? '更新中' : `${item.progress}%`
  if (item.ready) return '待安装'
  if (item.failed) return '重试'
  return '更新'
}

function updateMeta(item: ArkmeUpdateItem): string {
  return `${item.productLabel} ${item.latestVersion}${item.packageSize === undefined ? '' : ` · ${item.packageSize}`}`
}

function updateSelectionKey(item: ArkmeUpdateItem): string {
  return `${item.target}:${item.latestVersion}`
}

const ArkmeUpdatePopover = forwardRef<HTMLElement, {
  item: ArkmeUpdateItem
  style?: CSSProperties
  onClose(): void
  onStart(): void
}>(function ArkmeUpdatePopover({ item, style, onClose, onStart }, ref) {
  return <section ref={ref} style={style} className="arkme-update-popover" role="dialog" aria-modal="false" aria-labelledby="arkme-update-title">
    <div className="arkme-update-popover-heading">
      <div><span>{updateMeta(item)}</span><h2 id="arkme-update-title">{item.title}</h2></div>
      <button type="button" onClick={onClose} aria-label="关闭更新内容"><X size={14} /></button>
    </div>
    <p className="arkme-update-popover-summary">
      {item.target === 'plugin' ? '更新会在后台进行，完成后将自动重启。' : '可在后台下载，不影响你继续使用。'}
    </p>
    {item.notes.length > 0 && <div className="arkme-update-release-notes" aria-label="更新内容">
      {item.notes.map((note, index) => <div key={`${index}-${note.title}`}>
        <span>{String(index + 1).padStart(2, '0')}</span>
        <p><strong>{note.title}</strong>{note.detail !== undefined && <small>{note.detail}</small>}</p>
      </div>)}
    </div>}
    {item.blockedReason !== undefined && <p className="arkme-update-message is-error" role="alert">{item.blockedReason}</p>}
    <div className="arkme-update-popover-actions">
      <button type="button" className="arkme-update-later" onClick={onClose}>稍后</button>
      <button type="button" className="arkme-update-now" disabled={item.blockedReason !== undefined} onClick={onStart}>立即更新</button>
    </div>
  </section>
})

export function ArkmeUpdateTopCapsule({ item, onClose, onRetry, onOpenDownloaded, onCheckStatus }: {
  item: ArkmeUpdateItem
  onClose(): void
  onRetry(): void
  onOpenDownloaded(): void
  onCheckStatus?(): void
}) {
  const active = item.active && !item.restarting && !item.ready && !item.failed
  const hasAction = (item.ready && item.target === 'app') || item.failed || item.uncertain
  const title = item.uncertain ? '更新状态待确认' : item.restarting ? '正在自动重启…' : item.ready ? '安装包已下载' : item.failed ? '更新未完成' : '正在更新'
  const detail = item.restarting
    ? '即将打开新版本'
    : item.ready
      ? item.target === 'app' ? `已下载 ${item.latestVersion}` : `已安装 ${item.latestVersion}`
      : item.phaseMessage ?? '可继续使用'
  return <section
    className={`arkme-update-capsule${item.ready ? ' is-ready' : ''}${item.restarting ? ' is-restarting' : ''}${item.failed ? ' is-error' : ''}`}
    data-layout={item.restarting ? 'restarting' : active ? 'progress' : hasAction ? 'action' : 'message'}
    role={item.failed ? 'alert' : 'status'}
    aria-live={item.failed ? 'assertive' : 'polite'}
    aria-label={item.uncertain ? '更新状态待确认' : item.restarting ? '正在自动重启客户端' : item.ready ? '安装包已下载' : item.failed ? '更新未完成' : `正在更新，${item.progress ?? 0}%`}
  >
    <div className="arkme-update-capsule-copy"><strong>{title}</strong><small title={detail}>{detail}</small></div>
    {active && <>
      <div className={`arkme-update-progress${item.progress === undefined ? ' is-indeterminate' : ''}`} aria-hidden>
        <span style={item.progress === undefined ? {} : { width: `${item.progress}%` }} />
      </div>
      <b>{item.progress === undefined ? '···' : `${item.progress}%`}</b>
    </>}
    {item.ready && item.target === 'app' && <button type="button" className="arkme-update-ready-action" onClick={onOpenDownloaded}>打开文件夹</button>}
    {item.failed && <button type="button" className="arkme-update-ready-action" onClick={onRetry}>重新尝试</button>}
    {item.uncertain && <button type="button" className="arkme-update-ready-action" disabled={item.checkingStatus} aria-busy={item.checkingStatus} onClick={onCheckStatus}>{item.checkingStatus ? '检查中…' : '检查状态'}</button>}
    {!item.restarting && <button type="button" className="arkme-update-capsule-close" onClick={onClose} aria-label="关闭更新进度"><X size={14} /></button>}
  </section>
}
/** Demo-aligned update entry, anchored popover, and recoverable top progress capsule. */
export function ArkmeUpdateRailSlot() {
  const app = useSyncExternalStore(arkmeAppUpdateStore.subscribe, arkmeAppUpdateStore.getSnapshot, arkmeAppUpdateStore.getSnapshot)
  const plugin = useSyncExternalStore(arkmePluginUpdateStore.subscribe, arkmePluginUpdateStore.getSnapshot, arkmePluginUpdateStore.getSnapshot)
  const request = useArkmeUpdateUiSnapshot()
  const presentation = useMemo(() => deriveArkmeUpdatePresentation({ app, plugin }), [app, plugin])
  const [selectedKey, setSelectedKey] = useState<string | undefined>()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [topOpen, setTopOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; bottom: number }>()
  const railRef = useRef<HTMLButtonElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLElement>(null)
  const handledRequestRef = useRef(0)
  const activeKeyRef = useRef<string>()
  const phaseRef = useRef<string>()
  const restoreRailFocusRef = useRef(false)
  // Selection belongs to a release, while instanceKey tracks request/job activity.
  // Accepting or rejecting a request must not change the user's open/closed choice.
  const selectedItem = presentation.items.find(item => updateSelectionKey(item) === selectedKey)

  useEffect(() => {
    if (selectedKey === undefined || selectedItem !== undefined) return
    setSelectedKey(undefined)
    setPopoverOpen(false)
    setTopOpen(false)
    setPopoverPosition(undefined)
  }, [selectedKey, selectedItem])

  useEffect(() => {
    if (request.revision === 0 || request.revision === handledRequestRef.current) return
    handledRequestRef.current = request.revision
    const requested = presentation.items.find(item => request.target === undefined || item.target === request.target) ?? presentation.primary
    if (requested === undefined) return
    setSelectedKey(updateSelectionKey(requested))
    if (requested.available) {
      setTopOpen(false)
      setPopoverOpen(true)
    } else {
      setPopoverOpen(false)
      setTopOpen(true)
    }
  }, [presentation, request])

  useEffect(() => {
    const active = presentation.items.find(item => item.active)
    if (active === undefined) {
      if (presentation.items.length === 0) {
        activeKeyRef.current = undefined
        phaseRef.current = undefined
      }
      return
    }
    const phaseKey = `${active.instanceKey}:${active.phase ?? 'active'}`
    if (activeKeyRef.current !== active.instanceKey || (active.restarting && phaseRef.current !== phaseKey)) {
      const continuesRequest = active.target === 'plugin' && !active.restarting
        && activeKeyRef.current === `plugin:pending:${active.latestVersion}`
      activeKeyRef.current = active.instanceKey
      phaseRef.current = phaseKey
      setSelectedKey(updateSelectionKey(active))
      if (!continuesRequest) {
        setPopoverOpen(false)
        setTopOpen(true)
      }
    } else {
      phaseRef.current = phaseKey
    }
  }, [presentation])

  useLayoutEffect(() => {
    if (!topOpen && restoreRailFocusRef.current) {
      restoreRailFocusRef.current = false
      railRef.current?.focus()
    }
  }, [topOpen])

  useEffect(() => {
    if (!popoverOpen) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)
        || slotRef.current?.contains(event.target)
        || popoverRef.current?.contains(event.target)) return
      setPopoverOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPopoverOpen(false)
      railRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', escape)
    }
  }, [popoverOpen])

  useLayoutEffect(() => {
    if (!popoverOpen || typeof window === 'undefined') return
    const position = () => {
      const rail = railRef.current?.getBoundingClientRect()
      if (rail === undefined) return
      // Measure layout size rather than the entrance animation's scaled bounds.
      const popover = popoverRef.current
      setPopoverPosition({
        left: Math.round(Math.max(8, Math.min(rail.right + 8, window.innerWidth - (popover?.offsetWidth ?? 356) - 8))),
        bottom: Math.round(Math.max(8, Math.min(window.innerHeight - rail.bottom - 2, window.innerHeight - (popover?.offsetHeight ?? 0) - 8))),
      })
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [popoverOpen, selectedItem])

  if (presentation.primary === undefined) return null
  const railItem = selectedItem ?? presentation.primary
  const railHidden = topOpen && selectedItem !== undefined && (railItem.active || railItem.ready || railItem.failed || railItem.uncertain)
  const openFromRail = () => {
    setSelectedKey(updateSelectionKey(railItem))
    if (railItem.active || railItem.ready || railItem.failed || railItem.uncertain) {
      setPopoverOpen(false)
      setTopOpen(true)
    } else {
      setTopOpen(false)
      setPopoverOpen(value => !value)
    }
  }
  const start = () => {
    if (selectedItem === undefined || selectedItem.blockedReason !== undefined) return
    setPopoverOpen(false)
    setTopOpen(true)
    if (selectedItem.target === 'plugin') void arkmePluginUpdateStore.install()
    else void arkmeAppUpdateStore.download()
  }
  const retry = () => {
    setTopOpen(true)
    if (railItem.target === 'plugin') void arkmePluginUpdateStore.install()
    else void arkmeAppUpdateStore.download()
  }

  return <>
    {!railHidden && <div className="arkme-update-rail-slot" ref={slotRef}><button
      ref={railRef}
      type="button"
      className={`arkme-update-rail ${railItem.available ? 'is-available' : railItem.active ? 'is-downloading' : railItem.failed ? 'is-error' : 'is-ready'}${popoverOpen ? ' is-active' : ''}`}
      title={railItem.uncertain ? '更新状态待确认' : railItem.available ? '更新 Arkme' : railItem.active ? '查看更新进度' : railItem.failed ? '重试更新' : '查看更新状态'}
      aria-label={railItem.uncertain ? '更新状态待确认' : railItem.available ? '更新 Arkme' : railItem.active ? `查看更新进度，${railItem.progress ?? 0}%` : railItem.failed ? '重试更新' : '查看更新状态'}
      aria-expanded={popoverOpen || topOpen}
      onClick={openFromRail}
    ><ArrowClockwise size={17} weight="regular" /><span>{railLabel(railItem)}</span></button></div>}
    {popoverOpen && selectedItem?.available && typeof document !== 'undefined' && createPortal(<ArkmeUpdatePopover
      ref={popoverRef}
      item={selectedItem}
      {...(popoverPosition === undefined ? {} : { style: popoverPosition })}
      onClose={() => { setPopoverOpen(false); railRef.current?.focus() }}
      onStart={start}
    />, document.body)}
    {topOpen && selectedItem !== undefined && (selectedItem.active || selectedItem.ready || selectedItem.failed || selectedItem.uncertain)
      && typeof document !== 'undefined' && createPortal(<ArkmeUpdateTopCapsule
        item={selectedItem}
        onClose={() => { restoreRailFocusRef.current = true; setTopOpen(false) }}
        onRetry={retry}
        onCheckStatus={() => { void arkmePluginUpdateStore.checkInstallStatus() }}
        onOpenDownloaded={() => { void arkmeAppUpdateStore.showDownloadedFile() }}
      />, document.body)}
  </>
}
