import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { X } from '@phosphor-icons/react/dist/icons/X'
import {
  arkmeAppUpdateStore,
  type ArkmeAppUpdateStoreSnapshot,
} from './app-update-store.js'
import { useArkmeUpdateUiSnapshot, type ArkmeUpdateTarget } from './update-ui-controller.js'

export interface ArkmeUpdateNote {
  title: string
  detail?: string
}

export interface ArkmeUpdateItem {
  target: ArkmeUpdateTarget
  instanceKey: string
  productLabel: string
  title: string
  currentVersion: string
  latestVersion: string
  packageSize?: string
  notes: ArkmeUpdateNote[]
  available: boolean
  active: boolean
  ready: boolean
  restarting: boolean
  failed: boolean
  blockedReason?: string
  error?: string
  phase?: 'app-downloading' | 'app-downloaded' | 'app-failed'
  phaseMessage?: string
  progress?: number
}

export interface ArkmeUpdatePresentation {
  items: ArkmeUpdateItem[]
  primary?: ArkmeUpdateItem
}

function versionLabel(version: string | undefined): string {
  return version?.trim() || '…'
}

function formatBytes(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function percentage(downloaded: number | undefined, total: number | undefined): number | undefined {
  if (total === undefined || total <= 0) return undefined
  return Math.max(0, Math.min(100, Math.round((downloaded ?? 0) / total * 100)))
}

function updateNotes(summary: string | undefined): ArkmeUpdateNote[] {
  const lines = summary?.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 3) ?? []
  return lines.map(line => {
    const separator = line.search(/[：:—–]/)
    if (separator <= 0 || separator >= line.length - 1) return { title: line }
    return {
      title: line.slice(0, separator).trim(),
      detail: line.slice(separator + 1).trim(),
    }
  })
}

function appItem(snapshot: ArkmeAppUpdateStoreSnapshot): ArkmeUpdateItem | undefined {
  const status = snapshot.status
  if (status === undefined || !['available', 'downloading', 'downloaded', 'failed'].includes(status.status)) return undefined
  const latestVersion = versionLabel(status.latestVersion)
  const progress = percentage(status.downloadedBytes, status.totalBytes)
  const packageSize = formatBytes(status.totalBytes)
  const failed = status.status === 'failed'
  const ready = status.status === 'downloaded'
  return {
    target: 'app',
    instanceKey: `app:${latestVersion}`,
    productLabel: 'Arkme APP',
    title: failed ? '更新未完成' : ready ? '更新包已下载' : '发现新版本',
    currentVersion: versionLabel(status.currentVersion),
    latestVersion,
    ...(packageSize === undefined ? {} : { packageSize }),
    notes: updateNotes(status.releaseNotes),
    available: status.status === 'available',
    active: status.status === 'downloading',
    ready,
    restarting: false,
    failed,
    ...(status.status === 'downloading' ? { phase: 'app-downloading' as const, phaseMessage: '可继续使用' } : {}),
    ...(ready ? { phase: 'app-downloaded' as const, phaseMessage: `已下载 ${latestVersion}` } : {}),
    ...(failed ? { phase: 'app-failed' as const, phaseMessage: '请重新尝试下载' } : {}),
    ...(status.error?.trim() || snapshot.error.trim() ? { error: status.error?.trim() || snapshot.error.trim() } : {}),
    ...(progress === undefined ? {} : { progress }),
  }
}

/** Pure UI projection over the APP update store. Plugin updates are Release Set owned. */
export function deriveArkmeUpdatePresentation(input: {
  app: ArkmeAppUpdateStoreSnapshot
  /** Kept only so old callers cannot accidentally restore plugin update UI. */
  plugin?: unknown
}): ArkmeUpdatePresentation {
  const items = [appItem(input.app)].filter((item): item is ArkmeUpdateItem => item !== undefined)
  const primary = items.find(item => item.active)
    ?? items.find(item => item.ready || item.failed)
    ?? items.find(item => item.available)
  return { items, ...(primary === undefined ? {} : { primary }) }
}

function railLabel(item: ArkmeUpdateItem): string {
  if (item.active) return item.restarting ? '重启' : item.progress === undefined ? '更新中' : `${item.progress}%`
  if (item.ready) return '完成'
  if (item.failed) return '重试'
  return '更新'
}

function updateMeta(item: ArkmeUpdateItem): string {
  return `${item.productLabel} ${item.latestVersion}${item.packageSize === undefined ? '' : ` · ${item.packageSize}`}`
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
      可在后台下载，不影响你继续使用。
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

export function ArkmeUpdateTopCapsule({ item, onClose, onRetry, onOpenDownloaded }: {
  item: ArkmeUpdateItem
  onClose(): void
  onRetry(): void
  onOpenDownloaded(): void
}) {
  const active = item.active && !item.restarting
  const title = item.restarting ? '正在自动重启…' : item.ready ? '更新包已就绪' : item.failed ? '更新未完成' : '正在更新'
  const detail = item.restarting
    ? '即将打开新版本'
    : item.ready
      ? `已下载 ${item.latestVersion}`
      : item.phaseMessage ?? '可继续使用'
  return <section
    className={`arkme-update-capsule${item.ready ? ' is-ready' : ''}${item.restarting ? ' is-restarting' : ''}${item.failed ? ' is-error' : ''}`}
    role={item.failed ? 'alert' : 'status'}
    aria-live={item.failed ? 'assertive' : 'polite'}
    aria-label={item.restarting ? '正在自动重启客户端' : item.ready ? '更新包已就绪' : item.failed ? '更新未完成' : `正在更新，${item.progress ?? 0}%`}
  >
    <div className="arkme-update-capsule-copy"><strong>{title}</strong><small>{detail}</small></div>
    {active && <>
      <div className={`arkme-update-progress${item.progress === undefined ? ' is-indeterminate' : ''}`} aria-hidden>
        <span style={item.progress === undefined ? {} : { width: `${item.progress}%` }} />
      </div>
      <b>{item.progress === undefined ? '···' : `${item.progress}%`}</b>
    </>}
    {item.ready && <button type="button" className="arkme-update-ready-action" onClick={onOpenDownloaded}>打开文件夹</button>}
    {item.failed && <button type="button" className="arkme-update-ready-action" onClick={onRetry}>重新尝试</button>}
    {!item.restarting && <button type="button" className="arkme-update-capsule-close" onClick={onClose} aria-label="关闭更新进度"><X size={14} /></button>}
  </section>
}

/** Demo-aligned update entry, anchored popover, and recoverable top progress capsule. */
export function ArkmeUpdateRailSlot() {
  const app = useSyncExternalStore(arkmeAppUpdateStore.subscribe, arkmeAppUpdateStore.getSnapshot, arkmeAppUpdateStore.getSnapshot)
  const request = useArkmeUpdateUiSnapshot()
  const presentation = useMemo(() => deriveArkmeUpdatePresentation({ app }), [app])
  const [selectedTarget, setSelectedTarget] = useState<ArkmeUpdateTarget | undefined>()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [topOpen, setTopOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; bottom: number }>()
  const railRef = useRef<HTMLButtonElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLElement>(null)
  const handledRequestRef = useRef(0)
  const activeKeyRef = useRef<string>()
  const phaseRef = useRef<string>()
  const selectedItem = presentation.items.find(item => item.target === selectedTarget) ?? presentation.primary

  useEffect(() => {
    if (request.revision === 0 || request.revision === handledRequestRef.current) return
    handledRequestRef.current = request.revision
    const requested = presentation.items.find(item => request.target === undefined || item.target === request.target) ?? presentation.primary
    if (requested === undefined) return
    setSelectedTarget(requested.target)
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
    if (active === undefined) return
    const phaseKey = `${active.instanceKey}:${active.phase ?? 'active'}`
    if (activeKeyRef.current !== active.instanceKey || (active.restarting && phaseRef.current !== phaseKey)) {
      activeKeyRef.current = active.instanceKey
      phaseRef.current = phaseKey
      setSelectedTarget(active.target)
      setPopoverOpen(false)
      setTopOpen(true)
    } else {
      phaseRef.current = phaseKey
    }
  }, [presentation])

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
      setPopoverPosition({
        left: Math.round(rail.right + 8),
        bottom: Math.round(window.innerHeight - rail.bottom - 2),
      })
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [popoverOpen])

  if (presentation.primary === undefined) return null
  const railItem = selectedItem ?? presentation.primary
  const railHidden = topOpen && (railItem.active || railItem.ready || railItem.failed)
  const openFromRail = () => {
    setSelectedTarget(railItem.target)
    if (railItem.active || railItem.ready || railItem.failed) {
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
    void arkmeAppUpdateStore.download()
  }
  const retry = () => {
    setTopOpen(true)
    void arkmeAppUpdateStore.download()
  }

  return <div className="arkme-update-rail-slot" ref={slotRef}>
    {!railHidden && <button
      ref={railRef}
      type="button"
      className={`arkme-update-rail ${railItem.available ? 'is-available' : railItem.active ? 'is-downloading' : railItem.failed ? 'is-error' : 'is-ready'}${popoverOpen ? ' is-active' : ''}`}
      title={railItem.available ? '更新 Arkme' : railItem.active ? '查看更新进度' : railItem.failed ? '重试更新' : '查看更新状态'}
      aria-label={railItem.available ? '更新 Arkme' : railItem.active ? `查看更新进度，${railItem.progress ?? 0}%` : railItem.failed ? '重试更新' : '查看更新状态'}
      aria-expanded={popoverOpen || topOpen}
      onClick={openFromRail}
    ><ArrowClockwise size={17} weight="regular" /><span>{railLabel(railItem)}</span></button>}
    {popoverOpen && selectedItem?.available && typeof document !== 'undefined' && createPortal(<ArkmeUpdatePopover
      ref={popoverRef}
      item={selectedItem}
      {...(popoverPosition === undefined ? {} : { style: popoverPosition })}
      onClose={() => { setPopoverOpen(false); railRef.current?.focus() }}
      onStart={start}
    />, document.body)}
    {topOpen && selectedItem !== undefined && (selectedItem.active || selectedItem.ready || selectedItem.failed)
      && typeof document !== 'undefined' && createPortal(<ArkmeUpdateTopCapsule
        item={selectedItem}
        onClose={() => { setTopOpen(false) }}
        onRetry={retry}
        onOpenDownloaded={() => { void arkmeAppUpdateStore.showDownloadedFile() }}
      />, document.body)}
  </div>
}

export function appUpdateProgress(downloadedBytes: number | undefined, totalBytes: number | undefined): number | undefined {
  return percentage(downloadedBytes, totalBytes)
}
