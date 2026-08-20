import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {
  ArkmeExtensionCatalogItem, ArkmeExtensionCatalogPage, ArkmeExtensionInstallPreview, ArkmeExtensionInstallTaskSnapshot,
  ArkmeExtensionEnabledResult, ArkmeExtensionPublishResult, ArkmeExtensionUpdateResolution, ArkmeInstalledExtensionView,
} from '../extensions/types.js'
import type { ArkmeMyExtensionItem, ArkmeMyExtensionPage } from '../extensions/owned-types.js'
import { ArkmeExtensionIcon } from './ArkmeExtensionIcon.js'
import { ArkmeExtensionAvatar } from './ArkmeExtensionAvatar.js'
import { ArkmeExtensionPreviewGallery } from './ArkmeExtensionPreviewGallery.js'
import { ArkmeExtensionPublishDialog, type ArkmeExtensionPublishFormValue } from './ArkmeExtensionPublishDialog.js'
import { ArkmeExtensionEditDialog, type ArkmeExtensionEditFormValue } from './ArkmeExtensionEditDialog.js'
import {
  applyEditedMyExtension, nextExtensionEditMutation, saveExtensionEdit, type ExtensionEditMutation,
} from './extension-edit-flow.js'
import { ArkmeExtensionReviews, extensionRatingLabel } from './ArkmeExtensionReviews.js'
import { extensionTabSelection, mergeExtensionDiscoverItems } from './extension-market-model.js'
import { callArkme } from './api.js'
import { createArkmeSdk } from '../sdk/index.js'
import { myExtensionBadges, myExtensionPrimaryAction, myExtensionWarningText, nextExtensionPublishMutation,
  type ExtensionPublishMutation,
} from './my-extension-model.js'

type Tab = 'discover' | 'installed' | 'mine' | 'updates'
const extensionSdk = createArkmeSdk()
export const ARKME_EXTENSION_BRAND_GREEN = '#09B83E'
export const ARKME_EXTENSION_PRIMARY_ACTION_BG = 'var(--dsw-alias-label-primary, #292929)'

export function extensionTabLoadMode(loadedTabs: ReadonlySet<string>, target: string): 'initial' | 'refresh' {
  return loadedTabs.has(target) ? 'refresh' : 'initial'
}

const colors = {
  text: 'var(--dsw-alias-label-primary, #242629)',
  secondary: 'var(--dsw-alias-label-secondary, #717780)',
  caption: 'var(--dsw-alias-label-caption, #9ba1a9)',
  border: 'var(--dsw-alias-border-l1, #e7e9ec)',
  accent: ARKME_EXTENSION_BRAND_GREEN,
  accentSoft: 'rgba(9, 184, 62, .10)',
  surface: 'var(--dsw-specific-sidebar-fill, #fff)',
  subtle: 'var(--dsw-alias-fill-secondary, #f4f5f6)',
  hover: 'var(--dsw-alias-interactive-bg-hover, #eef1f3)',
  warning: 'var(--dsw-alias-state-warning-primary, #b06b16)',
  danger: 'var(--dsw-alias-state-error-primary, #c2413b)',
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed', zIndex: 90, inset: 0, display: 'grid', placeItems: 'center', padding: 32,
    boxSizing: 'border-box', background: 'rgba(17, 24, 39, .20)',
    backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
  },
  dialog: {
    position: 'relative',
    width: 'min(860px, calc(100vw - 64px))', height: 'min(680px, calc(100vh - 64px))',
    minWidth: 0, minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
    border: `1px solid ${colors.border}`, borderRadius: 18, background: colors.surface,
    boxShadow: '0 28px 80px rgba(20, 24, 31, .22), 0 4px 18px rgba(20, 24, 31, .08)',
  },
  shell: {
    width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
    background: colors.surface, color: colors.text, fontFamily: 'var(--dsw-font-family, inherit)',
  },
  header: {
    height: 58, flex: 'none', display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 20px', boxSizing: 'border-box',
  },
  iconButton: {
    width: 30, height: 30, flex: 'none', display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 8, background: 'transparent', color: colors.text, cursor: 'pointer',
  },
  title: { flex: 1, minWidth: 0, margin: 0, fontSize: 17, lineHeight: '24px', fontWeight: 600 },
  tabs: {
    height: 40, flex: 'none', display: 'flex', alignItems: 'stretch', padding: '0 22px',
    boxSizing: 'border-box',
  },
  tab: {
    minWidth: 0, flex: 1, position: 'relative', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', gap: 4, padding: '0 2px', border: 0, outline: 0,
    background: 'transparent', color: colors.secondary, font: 'inherit', fontSize: 12,
    whiteSpace: 'nowrap', cursor: 'pointer',
  },
  activeTab: { color: colors.accent, fontWeight: 600 },
  tabLabel: {
    height: '100%', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 4px',
    boxSizing: 'border-box',
  },
  activeTabLabel: { borderBottom: `2px solid ${colors.accent}` },
  count: {
    minWidth: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 4px', boxSizing: 'border-box', borderRadius: 999, background: colors.accentSoft,
    color: colors.accent, fontSize: 9, fontWeight: 650,
  },
  list: { minHeight: 0, flex: 1, overflowY: 'auto', padding: '8px 22px 22px', boxSizing: 'border-box' },
  card: {
    width: '100%', minWidth: 0, display: 'flex', gap: 10, boxSizing: 'border-box',
    margin: 0, padding: '11px 8px', border: 0, borderBottom: `1px solid ${colors.border}`, borderRadius: 0,
    background: 'transparent', color: colors.text, textAlign: 'left',
  },
  cardButton: { cursor: 'pointer', font: 'inherit' },
  cardPrimary: {
    minWidth: 0, flex: 1, display: 'flex', gap: 10, alignItems: 'flex-start', padding: 0,
    border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', font: 'inherit', cursor: 'pointer',
  },
  installSmall: {
    height: 28, flex: 'none', alignSelf: 'center', padding: '0 12px', border: 0, borderRadius: 8,
    background: ARKME_EXTENSION_PRIMARY_ACTION_BG, color: '#fff', font: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  iconSmall: {
    height: 28, display: 'inline-flex', alignItems: 'center', flex: 'none', padding: '0 10px',
    border: `1px solid ${colors.border}`, borderRadius: 8, background: 'transparent', color: colors.secondary,
    font: 'inherit', fontSize: 11, cursor: 'pointer', boxSizing: 'border-box',
  },
  actionGroup: { flex: 'none', alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 8 },
  toggle: {
    width: 40, height: 22, flex: 'none', border: 0, borderRadius: 999, padding: 2,
    display: 'flex', alignItems: 'center', justifyContent: 'flex-start', cursor: 'pointer', transition: 'background .15s ease',
  },
  toggleThumb: {
    width: 18, height: 18, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.14)',
    transition: 'transform .15s ease',
  },
  appIcon: {
    width: 32, height: 32, flex: 'none', display: 'grid', placeItems: 'center', overflow: 'hidden',
    borderRadius: 9, background: colors.subtle, color: colors.secondary,
  },
  cardBody: { minWidth: 0, flex: 1 },
  titleRow: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  stateBadges: { flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 },
  stateBadge: {
    display: 'inline-flex', alignItems: 'center', padding: '0 8px', borderRadius: 999,
    background: colors.subtle, color: colors.caption, fontSize: 10, fontWeight: 600, lineHeight: '19px',
    whiteSpace: 'nowrap',
  },
  name: { overflow: 'hidden', color: colors.text, fontSize: 13, fontWeight: 600, lineHeight: '19px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { display: 'block', marginTop: 2, color: colors.secondary, fontSize: 11, lineHeight: '16px', wordBreak: 'break-word' },
  description: {
    display: '-webkit-box', overflow: 'hidden', marginTop: 4, color: colors.secondary,
    fontSize: 12, lineHeight: '17px', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
  },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  chip: { padding: '1px 6px', borderRadius: 999, background: colors.surface, color: colors.secondary, fontSize: 10, lineHeight: '17px' },
  activeChip: { background: colors.accentSoft, color: colors.accent },
  warningChip: { background: 'rgba(176,107,22,.10)', color: colors.warning },
  error: { margin: '0 0 10px', padding: '10px 12px', borderRadius: 10, background: 'rgba(194,65,59,.08)', color: colors.danger, fontSize: 12 },
  restartNotice: { margin: '0 0 10px', padding: '10px 12px', borderRadius: 10, background: colors.accentSoft, color: colors.secondary, fontSize: 12 },
  empty: { display: 'grid', justifyItems: 'center', padding: '46px 18px 24px', textAlign: 'center' },
  emptyIcon: { width: 38, height: 38, display: 'grid', placeItems: 'center', color: colors.caption },
  emptyTitle: { marginTop: 13, color: colors.text, fontSize: 13, fontWeight: 600, lineHeight: '20px' },
  emptyDesc: { maxWidth: 230, marginTop: 4, color: colors.secondary, fontSize: 11, lineHeight: '17px' },
  skeleton: { height: 76, marginBottom: 8, borderRadius: 12, background: colors.subtle, opacity: .72 },
  detail: { paddingBottom: 20 },
  detailBack: {
    height: 30, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 10, padding: '0 6px 0 2px',
    border: 0, borderRadius: 7, background: 'transparent', color: colors.secondary, font: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  detailHero: { display: 'flex', gap: 12, alignItems: 'center', padding: '12px 2px 14px' },
  detailIcon: { width: 46, height: 46, display: 'grid', placeItems: 'center', borderRadius: 13, background: colors.accentSoft, color: colors.accent },
  detailSection: { padding: '12px 0', borderTop: `1px solid ${colors.border}` },
  detailLabel: { color: colors.caption, fontSize: 10, lineHeight: '16px' },
  detailValue: { marginTop: 3, color: colors.secondary, fontSize: 12, lineHeight: '18px', wordBreak: 'break-word' },
  detailHint: { marginTop: 12, padding: '10px 11px', borderRadius: 10, background: colors.accentSoft, color: colors.secondary, fontSize: 11, lineHeight: '17px' },
  detailDanger: {
    height: 32, marginTop: 14, padding: '0 14px', border: `1px solid ${colors.border}`, borderRadius: 9,
    background: 'transparent', color: colors.danger, font: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  detailConfirm: { marginTop: 14, padding: '10px 11px', borderRadius: 10, background: 'rgba(194,65,59,.08)', color: colors.danger, fontSize: 11, lineHeight: '17px' },
  detailConfirmActions: { display: 'flex', gap: 8, marginTop: 9 },
  primaryButton: {
    height: 34, flex: 'none', padding: '0 17px', border: 0, borderRadius: 9, background: ARKME_EXTENSION_PRIMARY_ACTION_BG,
    color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  loadingButton: {
    width: 28, height: 28, flex: 'none', alignSelf: 'center', display: 'grid', placeItems: 'center',
    padding: 0, border: 0, borderRadius: 8, background: colors.accentSoft, color: colors.accent, cursor: 'pointer',
  },
  restartOverlay: {
    position: 'absolute', zIndex: 5, inset: 0, display: 'grid', placeItems: 'center',
    padding: 24, boxSizing: 'border-box', background: 'rgba(17, 24, 39, .18)',
  },
  restartDialog: {
    width: 'min(380px, 100%)', padding: 20, boxSizing: 'border-box', borderRadius: 14,
    border: `1px solid ${colors.border}`, background: colors.surface, boxShadow: '0 18px 50px rgba(20,24,31,.20)',
  },
  restartTitle: { margin: 0, color: colors.text, fontSize: 16, lineHeight: '24px', fontWeight: 600 },
  restartDescription: { margin: '8px 0 0', color: colors.secondary, fontSize: 12, lineHeight: '19px' },
  restartActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
  restartLater: {
    height: 34, padding: '0 15px', border: `1px solid ${colors.border}`, borderRadius: 9,
    background: 'transparent', color: colors.secondary, font: 'inherit', fontSize: 12, cursor: 'pointer',
  },
}

const TAB_LABELS: Record<Tab, string> = { discover: '发现', installed: '已安装', mine: '我的扩展', updates: '更新' }
const EMPTY_COPY: Record<Tab, { title: string; description: string }> = {
  discover: { title: '还没有可发现的扩展', description: '和 DSH 对话生成并发布扩展后，它会出现在这里。' },
  installed: { title: '还没有安装扩展', description: '从发现页选择扩展，或在 DSH 对话中指定 extension_id。' },
  mine: { title: '还没有我的扩展', description: '和 DSH 生成 Cordis 扩展，或把自建 Bundle 加入当前 Profile。' },
  updates: { title: '所有扩展均为最新版本', description: '有新版本或安全撤销时，会在这里提醒你。' },
}

function BackIcon({ size = 18 }: { size?: number }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function CloseIcon() {
  return <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
}

function Chips({ children }: { children: ReactNode }) { return <div style={styles.chips}>{children}</div> }

function Chip({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'active' | 'warning' }) {
  return <span style={{ ...styles.chip, ...(tone === 'active' ? styles.activeChip : tone === 'warning' ? styles.warningChip : {}) }}>{children}</span>
}

function LoadingIcon() {
  return <svg aria-hidden width="15" height="15" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" opacity=".22" />
    <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur=".8s" repeatCount="indefinite" />
    </path>
  </svg>
}

function InstallLoadingButton({ task, onPause, onResume }: {
  task?: ArkmeExtensionInstallTaskSnapshot | undefined
  onPause?: (() => void) | undefined
  onResume?: (() => void) | undefined
}) {
  const paused = task?.phase === 'paused'
  const pausable = task !== undefined && ['resolving', 'downloading'].includes(task.phase)
  const action = paused ? onResume : pausable ? onPause : undefined
  const label = paused ? '继续安装' : pausable ? '暂停安装' : '正在处理'
  return <button
    type="button" style={{ ...styles.loadingButton, ...(action === undefined ? { cursor: 'default' } : {}) }}
    disabled={action === undefined} aria-label={label} title={label} onClick={action}
  >{paused
      ? <svg aria-hidden width="13" height="13" viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" /></svg>
      : <LoadingIcon />}</button>
}

export function ArkmeExtensionToggle({ item, busy, onChange }: {
  item: ArkmeInstalledExtensionView
  busy: boolean
  onChange(enabled: boolean): void
}) {
  return <button
    type="button"
    role="switch"
    aria-label={`${item.enabled ? '关闭' : '启用'}扩展 ${item.manifest.name}`}
    aria-checked={item.enabled}
    disabled={busy}
    style={{
      ...styles.toggle,
      background: item.enabled ? colors.accent : '#eeeeee',
      opacity: busy ? .55 : 1,
    }}
    onClick={() => { onChange(!item.enabled) }}
  >
    <span style={{ ...styles.toggleThumb, transform: item.enabled ? 'translateX(18px)' : 'translateX(0)' }} />
  </button>
}

export function ExtensionCard({ item, installed, actionLabel, status, statusColor, installTask, actionBusy, onClick, onAction, onToggle, onPause, onResume }: {
  item: ArkmeExtensionCatalogItem
  installed?: ArkmeInstalledExtensionView | undefined
  actionLabel?: string | undefined
  status?: string | undefined
  statusColor?: string | undefined
  installTask?: ArkmeExtensionInstallTaskSnapshot | undefined
  actionBusy?: boolean
  onClick(): void
  onAction?: (() => void) | undefined
  onToggle?: ((enabled: boolean) => void) | undefined
  onPause?: (() => void) | undefined
  onResume?: (() => void) | undefined
}) {
  const metadata = extensionCardMetadata(item)
  return <div
    style={styles.card}
    onMouseEnter={event => { event.currentTarget.style.background = colors.hover }}
    onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
  >
    <button type="button" style={styles.cardPrimary} onClick={onClick}>
      <ArkmeExtensionAvatar extensionId={item.extension_id} iconRef={item.icon_ref} />
      <span style={styles.cardBody}>
        <span style={styles.name}>{item.name}</span>
        <span style={styles.description}>{item.description || '这个扩展还没有填写说明。'}</span>
        {metadata !== '' && <span style={styles.meta}>{metadata}</span>}
        {item.rating_summary !== undefined && <span style={styles.meta}>★ {extensionRatingLabel(item.rating_summary)}</span>}
        {status !== undefined && <span style={{ ...styles.meta, color: statusColor ?? colors.secondary }}>{status}</span>}
      </span>
    </button>
    {(installTask !== undefined && !installTask.done) || (actionBusy === true && actionLabel !== undefined) ? <InstallLoadingButton
      task={installTask} onPause={onPause} onResume={onResume}
    /> : <span style={styles.actionGroup}>
      {actionLabel !== undefined && <button
        type="button"
        style={{ ...styles.installSmall, ...(onAction === undefined ? { opacity: .45, cursor: 'not-allowed' } : {}) }}
        disabled={onAction === undefined || actionBusy === true}
        onClick={onAction}
      >{actionLabel}</button>}
      {installed !== undefined && onToggle !== undefined && <ArkmeExtensionToggle
        item={installed} busy={actionBusy === true} onChange={onToggle}
      />}
    </span>}
  </div>
}

export function MyExtensionCard({ item, installed, toggleBusy = false, onPublish, onEdit, onToggle }: {
  item: ArkmeMyExtensionItem
  installed?: ArkmeInstalledExtensionView | undefined
  toggleBusy?: boolean | undefined
  onPublish?(): void
  onEdit?(): void
  onToggle?(enabled: boolean): void
}) {
  const action = myExtensionPrimaryAction(item)
  const version = displayVersion(item.published?.version ?? item.persisted?.version)
  return <div
    style={styles.card}
    onMouseEnter={event => { event.currentTarget.style.background = colors.hover }}
    onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
  >
    <ArkmeExtensionAvatar extensionId={item.published?.extensionId ?? item.ownedRef} iconRef={item.published?.iconRef} />
    <span style={styles.cardBody}>
      <span style={styles.titleRow}>
        <span style={styles.name}>{item.name}</span>
        <span style={styles.stateBadges}>{myExtensionBadges(item.states).map(label => <span key={label} style={styles.stateBadge}>{label}</span>)}</span>
      </span>
      <span style={styles.description}>{item.description || '这个扩展还没有填写说明。'}</span>
      {version !== '' && <span style={styles.meta}>{version}</span>}
    </span>
    <span style={styles.actionGroup}>
      {action !== undefined && <button
        type="button"
        style={{ ...styles.installSmall, ...((action.kind === 'publish' ? onPublish : onEdit) === undefined ? { opacity: .45, cursor: 'not-allowed' } : {}) }}
        disabled={(action.kind === 'publish' ? onPublish : onEdit) === undefined}
        onClick={action.kind === 'publish' ? onPublish : onEdit}
      >{action.label}</button>}
      {installed !== undefined && onToggle !== undefined && <ArkmeExtensionToggle
        item={installed} busy={toggleBusy} onChange={onToggle}
      />}
    </span>
  </div>
}

function EmptyState({ tab }: { tab: Tab }) {
  const copy = EMPTY_COPY[tab]
  return <div style={styles.empty}>
    <span style={styles.emptyIcon}><ArkmeExtensionIcon size={22} /></span>
    <span style={styles.emptyTitle}>{copy.title}</span>
    <span style={styles.emptyDesc}>{copy.description}</span>
  </div>
}

function LoadingState() {
  return <div aria-label="正在加载扩展"><div style={styles.skeleton} /><div style={styles.skeleton} /><div style={styles.skeleton} /></div>
}

export function extensionInstallPercent(task: Pick<ArkmeExtensionInstallTaskSnapshot, 'phase' | 'downloadedBytes' | 'totalBytes'>): number {
  switch (task.phase) {
    case 'resolving': return 4
    case 'downloading': {
      if (task.totalBytes === undefined || task.totalBytes <= 0) return task.downloadedBytes === 0 ? 8 : 24
      return Math.min(75, 8 + Math.round(67 * Math.min(1, (task.downloadedBytes ?? 0) / task.totalBytes)))
    }
    case 'verifying': return 80
    case 'persisting': return 87
    case 'registering': return 90
    case 'applying': return 94
    case 'paused': return 0
    case 'awaiting-approval':
    case 'installed':
    case 'active':
    case 'failed': return 100
  }
}

export function formatExtensionBytes(bytes: number): string {
  const safe = Math.max(0, bytes)
  if (safe < 1024) return `${String(safe)} B`
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} KB`
  return `${(safe / (1024 * 1024)).toFixed(1)} MB`
}

export function extensionInstallFailureMessage(
  task: Pick<ArkmeExtensionInstallTaskSnapshot, 'done' | 'phase' | 'message' | 'error'> | undefined,
): string | undefined {
  if (task?.done !== true || task.phase !== 'failed') return undefined
  const message = task.error?.message.trim() || task.message?.trim() || ''
  return message === '' ? '扩展安装失败，请重试。' : message
}

export function extensionCatalogAction(
  item: Pick<ArkmeExtensionCatalogItem, 'latest_stable_version' | 'version'>,
  installedVersion?: string,
  owned = false,
): { label: '安装' | '更新' | '已安装' | '未发布'; disabled: boolean } {
  const latest = item.version ?? item.latest_stable_version
  if (owned && latest === undefined) return { label: '未发布', disabled: true }
  if (installedVersion === undefined) return { label: '安装', disabled: false }
  if (latest === undefined) return { label: '已安装', disabled: true }
  return installedVersion === latest
    ? { label: '已安装', disabled: true }
    : { label: '更新', disabled: false }
}

function displayVersion(value: string | undefined): string {
  const normalized = value?.trim().replace(/^v/i, '') ?? ''
  return normalized === '' ? '' : `v${normalized}`
}

export function extensionVersionLabel(
  item: Pick<ArkmeExtensionCatalogItem, 'latest_stable_version' | 'version'>,
): string {
  return displayVersion(item.version ?? item.latest_stable_version)
}

export function extensionCardMetadata(
  item: Pick<ArkmeExtensionCatalogItem, 'latest_stable_version' | 'version' | 'manifest'>,
): string {
  return extensionVersionLabel(item)
}

export function extensionUpdateCardStatus(item: ArkmeExtensionUpdateResolution): string | undefined {
  if (!item.revoked) return undefined
  return item.revocation_reason?.trim() || '当前版本已撤销'
}

export function extensionDirectInstallTarget(
  item: Pick<ArkmeExtensionCatalogItem, 'extension_id' | 'latest_stable_version' | 'version'>,
): { extensionId: string; version?: string } {
  const version = item.version ?? item.latest_stable_version
  return {
    extensionId: item.extension_id,
    ...(version === undefined ? {} : { version }),
  }
}

export function extensionInstallOwnerId(
  currentSessionId: string | undefined,
  instanceId: string | undefined,
): string | undefined {
  const session = currentSessionId?.trim() ?? ''
  if (session !== '') return session
  const instance = instanceId?.trim() ?? ''
  return instance === '' ? undefined : `profile:${instance}`
}

export function extensionNativeInstallWarning(
  preview: Pick<ArkmeExtensionInstallPreview, 'execution_model' | 'package_name'>,
): string | undefined {
  if (preview.execution_model !== 'dsh-native') return undefined
  return `扩展 ${preview.package_name ?? '（未知 package）'} 是原生 DSH Bundle，将以 DSH 插件进程权限运行。确认继续安装吗？`
}

export function extensionAuthorLabel(
  item: Pick<ArkmeExtensionCatalogItem, 'owner_user_id' | 'owner_name' | 'owner_arkme_id'>,
): string {
  const displayName = item.owner_name?.trim() ?? ''
  const arkmeId = item.owner_arkme_id?.trim().replace(/^@+/, '') ?? ''
  if (displayName !== '' && arkmeId !== '') return `${displayName} · @${arkmeId}`
  if (displayName !== '') return displayName
  if (arkmeId !== '') return `@${arkmeId}`
  if (item.owner_user_id !== undefined) return `Arkme 用户 ${String(item.owner_user_id)}`
  return '作者信息暂不可用'
}

export function installedExtensionCatalogItem(item: ArkmeInstalledExtensionView, iconRef?: string): ArkmeExtensionCatalogItem {
  return {
    extension_id: item.extensionId,
    name: item.manifest.name,
    description: item.manifest.description,
    visibility: 'private',
    version: item.installedVersion,
    manifest: item.manifest,
    ...(iconRef === undefined ? {} : { icon_ref: iconRef }),
  }
}

function extensionVisibilityLabel(visibility: ArkmeExtensionCatalogItem['visibility']): string {
  if (visibility === 'public') return '公开发布'
  if (visibility === 'unlisted') return '通过链接可见'
  return '仅自己可见'
}

function extensionUpdateLabel(item: ArkmeExtensionUpdateResolution): string {
  if (item.revoked) return item.revocation_reason?.trim() || '当前版本已撤销'
  return item.update_available ? '有可用更新' : '已是最新'
}

function extensionEnabledLabel(item: ArkmeInstalledExtensionView): string {
  if (!item.enabled) return '已关闭'
  return item.active ? '已启用' : '已启用，尚未加载'
}

export function ArkmeExtensionCenter({ currentSessionId, currentUserId, onClose }: {
  currentSessionId?: string | undefined
  currentUserId?: number | undefined
  onClose(): void
}) {
  const [tab, setTab] = useState<Tab>('discover')
  const [discoverItems, setDiscoverItems] = useState<ArkmeExtensionCatalogItem[]>([])
  const [publishedItems, setPublishedItems] = useState<ArkmeExtensionCatalogItem[]>([])
  const [discoverOwnerWarning, setDiscoverOwnerWarning] = useState('')
  const [myExtensions, setMyExtensions] = useState<ArkmeMyExtensionItem[]>([])
  const [myExtensionWarnings, setMyExtensionWarnings] = useState<ArkmeMyExtensionPage['warnings']>([])
  const [installed, setInstalled] = useState<ArkmeInstalledExtensionView[]>([])
  const [updates, setUpdates] = useState<ArkmeExtensionUpdateResolution[]>([])
  const [detail, setDetail] = useState<ArkmeExtensionCatalogItem>()
  const [loadingTab, setLoadingTab] = useState<Tab | undefined>('discover')
  const [detailBusy, setDetailBusy] = useState(false)
  const [installTask, setInstallTask] = useState<ArkmeExtensionInstallTaskSnapshot>()
  const [actionBusyExtensionId, setActionBusyExtensionId] = useState<string>()
  const [installError, setInstallError] = useState('')
  const [restartNotice, setRestartNotice] = useState('')
  const [restartPrompt, setRestartPrompt] = useState<{ extensionId: string; kind: 'apply' | 'remove' }>()
  const [uninstallConfirmExtensionId, setUninstallConfirmExtensionId] = useState<string>()
  const [restarting, setRestarting] = useState(false)
  const [publishItem, setPublishItem] = useState<ArkmeMyExtensionItem>()
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [editItem, setEditItem] = useState<ArkmeMyExtensionItem>()
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')
  const [loadedTabs, setLoadedTabs] = useState<ReadonlySet<Tab>>(new Set())
  const [error, setError] = useState('')
  const requestSequence = useRef(0)
  const requestController = useRef<AbortController>()
  const publishMutation = useRef<ExtensionPublishMutation>()
  const editMutation = useRef<ExtensionEditMutation>()

  const hostInstance = async (): Promise<string | undefined> => {
    try { return (await callArkme<{ instanceId: string }>('provider.instance')).instanceId }
    catch { return undefined }
  }

  const reloadAfterRestart = async (previous: string | undefined): Promise<void> => {
    if (previous === undefined || typeof window === 'undefined') return
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 300))
      const next = await hostInstance()
      if (next !== undefined && next !== previous) {
        window.location.reload()
        return
      }
    }
    setRestarting(false)
    setInstallError('DSH 重启超时，请手动重启后刷新页面。')
  }
  const load = async (
    target: Tab,
    mode: 'initial' | 'refresh' = extensionTabLoadMode(loadedTabs, target),
  ) => {
    const sequence = ++requestSequence.current
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    if (mode === 'initial') setLoadingTab(target)
    setError(''); setDetail(undefined); setInstallError('')
    try {
      if (target === 'discover') {
        const [page, local, owned] = await Promise.all([
          callArkme<ArkmeExtensionCatalogPage>('extensions.catalog.list', { limit: 50 }, controller.signal),
          callArkme<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, controller.signal),
          callArkme<ArkmeExtensionCatalogPage>('extensions.my-list', undefined, controller.signal)
            .then(value => ({ value, failed: false as const }))
            .catch(() => ({ value: { items: [], total: 0 }, failed: true as const })),
        ])
        if (sequence === requestSequence.current) {
          setDiscoverItems(page.items); setInstalled(local); setPublishedItems(owned.value.items)
          setDiscoverOwnerWarning(owned.failed ? '你的私有扩展暂未加载，请稍后刷新。' : '')
        }
      } else if (target === 'mine') {
        const [page, local] = await Promise.all([
          callArkme<ArkmeMyExtensionPage>('extensions.mine.list', {
            ...(currentSessionId === undefined || currentSessionId.trim() === '' ? {} : { currentSessionId: currentSessionId.trim() }),
          }, controller.signal),
          callArkme<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, controller.signal),
        ])
        if (sequence === requestSequence.current) {
          setMyExtensions(page.items); setMyExtensionWarnings(page.warnings); setInstalled(local)
        }
      } else if (target === 'installed') {
        const [local, catalog, owned] = await Promise.all([
          callArkme<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, controller.signal),
          callArkme<ArkmeExtensionCatalogPage>('extensions.catalog.list', { limit: 50 }, controller.signal)
            .catch(() => ({ items: [], total: 0 })),
          callArkme<ArkmeExtensionCatalogPage>('extensions.my-list', undefined, controller.signal)
            .catch(() => ({ items: [], total: 0 })),
        ])
        if (sequence === requestSequence.current) {
          setInstalled(local); setDiscoverItems(catalog.items); setPublishedItems(owned.items)
        }
      } else {
        const [local, available, catalog, owned] = await Promise.all([
          callArkme<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, controller.signal),
          callArkme<ArkmeExtensionUpdateResolution[]>('extensions.updates', undefined, controller.signal),
          callArkme<ArkmeExtensionCatalogPage>('extensions.catalog.list', { limit: 50 }, controller.signal)
            .catch(() => ({ items: [], total: 0 })),
          callArkme<ArkmeExtensionCatalogPage>('extensions.my-list', undefined, controller.signal)
            .catch(() => ({ items: [], total: 0 })),
        ])
        if (sequence === requestSequence.current) {
          setInstalled(local); setUpdates(available); setDiscoverItems(catalog.items); setPublishedItems(owned.items)
        }
      }
      if (sequence === requestSequence.current) setLoadedTabs(current => new Set(current).add(target))
    } catch (caught) {
      if (mode === 'initial' && (caught as Error).name !== 'AbortError' && sequence === requestSequence.current) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoadingTab(current => current === target ? undefined : current)
      }
    }
  }

  useEffect(() => {
    void load('discover', 'initial')
    return () => { requestController.current?.abort() }
  }, [])

  const switchTab = (target: Tab) => {
    const selection = extensionTabSelection(tab, target, loadedTabs)
    if (selection.changed) {
      setTab(target); setError(''); setDetail(undefined); setInstallError(''); setInstallTask(undefined); setUninstallConfirmExtensionId(undefined)
    }
    void load(target, selection.mode)
  }

  const inspect = async (extensionId: string) => {
    setDetailBusy(true); setError(''); setInstallError(''); setInstallTask(undefined)
    try {
      let listed = [...publishedItems, ...discoverItems].find(item => item.extension_id === extensionId)
      const ownedListed = publishedItems.find(item => item.extension_id === extensionId)
      const local = installed.find(item => item.extensionId === extensionId)
      if (tab === 'discover' && ownedListed?.visibility === 'private') {
        const preview = await callArkme<ArkmeExtensionInstallPreview>('extensions.install.preview', { extensionId })
        setDetail({ ...ownedListed, version: preview.version, manifest: preview.manifest })
        return
      }
      if (tab === 'mine' && listed !== undefined
        && listed.latest_stable_version === undefined && listed.version === undefined) {
        setDetail(listed)
        return
      }
      if (tab === 'mine') {
        const preview = await callArkme<ArkmeExtensionInstallPreview>('extensions.install.preview', { extensionId })
        setDetail({
          extension_id: extensionId,
          name: listed?.name ?? preview.manifest.name,
          description: listed?.description ?? preview.manifest.description,
          ...(listed?.owner_user_id === undefined ? {} : { owner_user_id: listed.owner_user_id }),
          ...(listed?.owner_name === undefined ? {} : { owner_name: listed.owner_name }),
          ...(listed?.owner_arkme_id === undefined ? {} : { owner_arkme_id: listed.owner_arkme_id }),
          ...(listed?.icon_ref === undefined ? {} : { icon_ref: listed.icon_ref }),
          visibility: listed?.visibility ?? 'private',
          version: preview.version,
          manifest: preview.manifest,
        })
      } else {
        try {
          const remote = await callArkme<ArkmeExtensionCatalogItem>('extensions.catalog.detail', { extensionId })
          setDetail(local === undefined ? remote : {
            ...installedExtensionCatalogItem(local),
            ...remote,
            manifest: remote.manifest ?? local.manifest,
          })
        } catch (caught) {
          if (local === undefined) throw caught
          if (listed === undefined) {
            const owned = await callArkme<ArkmeExtensionCatalogPage>('extensions.my-list').catch(() => undefined)
            if (owned !== undefined) {
              setPublishedItems(owned.items)
              listed = owned.items.find(item => item.extension_id === extensionId)
            }
          }
          setDetail({ ...installedExtensionCatalogItem(local), ...(listed ?? {}), manifest: local.manifest })
        }
      }
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setDetailBusy(false) }
  }

  const startInstall = async (target: { extensionId: string; version?: string }) => {
    setActionBusyExtensionId(target.extensionId); setInstallError(''); setRestartNotice('')
    try {
      const preview = await callArkme<ArkmeExtensionInstallPreview>('extensions.install.preview', {
        extensionId: target.extensionId,
        ...(target.version === undefined ? {} : { version: target.version }),
      })
      const nativeWarning = extensionNativeInstallWarning(preview)
      if (nativeWarning !== undefined && !window.confirm(nativeWarning)) return
      const ownerId = extensionInstallOwnerId(currentSessionId, await hostInstance())
      if (ownerId === undefined) throw new Error('无法确认当前 DSH 实例，请刷新后重试。')
      const task = await callArkme<ArkmeExtensionInstallTaskSnapshot>('extensions.install.start', {
        extensionId: target.extensionId,
        ...(target.version === undefined ? {} : { version: target.version }),
        sessionId: ownerId,
      })
      setInstallTask(task)
    } catch (caught) {
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionBusyExtensionId(undefined)
    }
  }

  const controlInstall = async (operation: 'extensions.install.pause' | 'extensions.install.resume') => {
    if (installTask === undefined) return
    try {
      setInstallError('')
      setInstallTask(await callArkme<ArkmeExtensionInstallTaskSnapshot>(operation, {
        taskId: installTask.taskId,
        sessionId: installTask.sessionId,
      }))
    } catch (caught) {
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const uninstall = async (extensionId: string) => {
    setActionBusyExtensionId(extensionId); setInstallError(''); setRestartNotice('')
    try {
      const ownerId = extensionInstallOwnerId(currentSessionId, await hostInstance())
      if (ownerId === undefined) throw new Error('无法确认当前 DSH 实例，请刷新后重试。')
      const result = await callArkme<{ restart_required?: boolean }>('extensions.uninstall', {
        extensionId,
        sessionId: ownerId,
      })
      setInstalled(current => current.filter(item => item.extensionId !== extensionId))
      setUninstallConfirmExtensionId(undefined)
      setUpdates(current => current.filter(item => item.extension_id !== extensionId))
      setInstallTask(current => current?.extensionId === extensionId ? undefined : current)
      setLoadedTabs(current => {
        const updated = new Set(current).add('installed')
        updated.delete('updates')
        return updated
      })
      if (result.restart_required === true) {
        setRestartNotice('扩展已从 DSH 插件列表移除，请手动重启 DSH 完成卸载。')
        setRestartPrompt({ extensionId, kind: 'remove' })
      }
    } catch (caught) {
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionBusyExtensionId(undefined)
    }
  }

  const toggleEnabled = async (extensionId: string, enabled: boolean) => {
    setActionBusyExtensionId(extensionId); setInstallError(''); setRestartNotice('')
    try {
      const result = await callArkme<ArkmeExtensionEnabledResult>('extensions.enabled.set', { extensionId, enabled })
      setInstalled(current => current.map(item => {
        if (item.extensionId !== extensionId) return item
        return { ...item, enabled: result.enabled, active: result.active }
      }))
      setRestartNotice(result.message)
    } catch (caught) {
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionBusyExtensionId(undefined)
    }
  }

  useEffect(() => {
    if (installTask === undefined || installTask.done) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await callArkme<ArkmeExtensionInstallTaskSnapshot>('extensions.install.status', {
          taskId: installTask.taskId,
          sessionId: installTask.sessionId,
        }, controller.signal)
        setInstallTask(next)
        if (next.done) {
          const failureMessage = extensionInstallFailureMessage(next)
          if (failureMessage !== undefined) setInstallError(failureMessage)
          if (next.result?.restartRequired === true) {
            setRestartNotice('扩展已写入 DSH 插件列表，请手动重启 DSH 后生效。')
            setRestartPrompt({ extensionId: next.extensionId, kind: 'apply' })
          }
          if (next.phase !== 'failed' || next.result?.installed === true) {
            const local = await callArkme<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, controller.signal)
            setInstalled(local)
            setLoadedTabs(current => {
              const updated = new Set(current).add('installed')
              updated.delete('updates')
              return updated
            })
          }
          return
        }
        timer = setTimeout(() => { void poll() }, 300)
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') {
          setInstallError(caught instanceof Error ? caught.message : String(caught))
        }
      }
    }
    timer = setTimeout(() => { void poll() }, 200)
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [installTask?.taskId])

  const restartNow = async () => {
    if (restartPrompt === undefined || restarting) return
    setRestarting(true); setInstallError('')
    const previous = await hostInstance()
    try {
      await callArkme('extensions.restart', { extensionId: restartPrompt.extensionId })
      setRestartNotice('DSH 正在重启，完成后页面会自动刷新。')
      await reloadAfterRestart(previous)
    } catch (caught) {
      setRestarting(false)
      setInstallError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const publishMyExtension = async (item: ArkmeMyExtensionItem, value: ArkmeExtensionPublishFormValue) => {
    setPublishBusy(true); setPublishError('')
    try {
      const mutation = nextExtensionPublishMutation(publishMutation.current, item.ownedRef, value.version, () => crypto.randomUUID())
      publishMutation.current = mutation
      const { iconFile, ...publishValue } = value
      const result = await callArkme<ArkmeExtensionPublishResult>('extensions.mine.publish', {
        ownedRef: item.ownedRef,
        ...publishValue,
        clientMutationId: mutation.id,
      })
      publishMutation.current = undefined
      setPublishItem(undefined)
      await load('mine', 'refresh')
      if (iconFile !== undefined) {
        try {
          await extensionSdk.setExtensionIcon(result.extension_id, iconFile)
          await load('mine', 'refresh')
          setRestartNotice('扩展已发布，头像已同步。')
        } catch (iconError) {
          setInstallError(`扩展已发布，但头像上传失败：${iconError instanceof Error ? iconError.message : String(iconError)}`)
        }
      }
    } catch (caught) {
      setPublishError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPublishBusy(false)
    }
  }

  const saveMyExtensionEdit = async (item: ArkmeMyExtensionItem, value: ArkmeExtensionEditFormValue) => {
    const published = item.published
    if (published === undefined) return
    const extensionId = published.extensionId
    const mutation = nextExtensionEditMutation(editMutation.current, extensionId, value, () => crypto.randomUUID())
    editMutation.current = mutation
    setEditBusy(true); setEditError(''); setRestartNotice('')
    try {
      const baseline = publishedItems.find(candidate => candidate.extension_id === extensionId) ?? {
        extension_id: extensionId,
        name: item.name,
        description: item.description,
        visibility: published.visibility,
        ...(published.version === undefined ? {} : { version: published.version }),
        ...(published.iconRef === undefined ? {} : { icon_ref: published.iconRef }),
      }
      const result = await saveExtensionEdit({ extension: baseline, value, clientMutationId: mutation.id }, {
        updateMetadata: async (targetExtensionId, input) => await extensionSdk.updateExtensionMetadata(targetExtensionId, input),
        setIcon: async (targetExtensionId, file) => await extensionSdk.setExtensionIcon(targetExtensionId, file),
      })
      const nextItem = applyEditedMyExtension(item, result.extension)
      setMyExtensions(current => current.map(candidate => candidate.ownedRef === item.ownedRef
        ? applyEditedMyExtension(candidate, result.extension)
        : candidate))
      setDiscoverItems(current => current.map(candidate => candidate.extension_id === extensionId
        ? { ...candidate, ...result.extension }
        : candidate))
      setPublishedItems(current => current.some(candidate => candidate.extension_id === extensionId)
        ? current.map(candidate => candidate.extension_id === extensionId ? { ...candidate, ...result.extension } : candidate)
        : [result.extension, ...current])
      setDetail(current => current?.extension_id === extensionId ? { ...current, ...result.extension } : current)
      setEditItem(nextItem)
      await load('mine', 'refresh')
      if (result.kind === 'metadata-saved-icon-failed') {
        setEditError(`资料已保存，但头像更新失败：${result.error}`)
        return
      }
      editMutation.current = undefined
      setEditItem(undefined)
      setRestartNotice('扩展信息已更新。')
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setEditBusy(false)
    }
  }

  const updateCount = updates.filter(item => item.update_available || item.revoked).length
  const visibleItems = mergeExtensionDiscoverItems(discoverItems, publishedItems)
  const iconRefFor = (extensionId: string): string | undefined => discoverItems.find(item => item.extension_id === extensionId)?.icon_ref
    ?? publishedItems.find(item => item.extension_id === extensionId)?.icon_ref
    ?? myExtensions.find(item => item.published?.extensionId === extensionId)?.published?.iconRef
  const busy = loadingTab === tab || detailBusy
  const detailInstalled = detail === undefined ? undefined : installed.find(item => item.extensionId === detail.extension_id)
  const detailUpdate = detail === undefined ? undefined : updates.find(item => item.extension_id === detail.extension_id)
  const detailInstallAction = detail === undefined
    ? { label: '安装' as const, disabled: true }
    : tab === 'updates' && detailUpdate?.update_available === true && !detailUpdate.revoked
      ? { label: '更新' as const, disabled: false }
      : extensionCatalogAction(detail, detailInstalled?.installedVersion, tab === 'mine')
  const detailAction = detailInstallAction.label
  const detailTask = installTask?.extensionId === detail?.extension_id ? installTask : undefined
  const detailStatus = detail === undefined
    ? undefined
    : detailInstalled !== undefined
      ? { label: extensionEnabledLabel(detailInstalled), color: detailInstalled.enabled ? detailInstalled.active ? colors.accent : colors.warning : colors.secondary }
      : tab === 'updates' && detailUpdate !== undefined
        ? { label: extensionUpdateLabel(detailUpdate), color: detailUpdate.revoked ? colors.danger : detailUpdate.update_available ? colors.accent : colors.secondary }
        : tab === 'mine'
          ? { label: extensionVisibilityLabel(detail.visibility), color: colors.secondary }
          : undefined

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (editItem !== undefined && !editBusy) { editMutation.current = undefined; setEditItem(undefined) }
      else if (publishItem !== undefined && !publishBusy) { publishMutation.current = undefined; setPublishItem(undefined) }
      else if (restartPrompt !== undefined && !restarting) setRestartPrompt(undefined)
      else if (restartPrompt === undefined) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [editBusy, editItem, onClose, publishBusy, publishItem, restartPrompt, restarting])

  const dialog = <div style={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
  <section style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="arkme-extension-center-title">
  <div style={styles.shell} aria-label="Arkme 扩展市场">
    <header style={styles.header}>
      <h2 id="arkme-extension-center-title" style={styles.title}>扩展市场</h2>
      <button
        type="button" style={styles.iconButton} aria-label="关闭扩展市场" title="关闭"
        onClick={onClose}
        onMouseEnter={event => { event.currentTarget.style.background = colors.hover }}
        onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
      ><CloseIcon /></button>
    </header>
    <nav style={styles.tabs} role="tablist" aria-label="扩展市场分类">
      {(Object.keys(TAB_LABELS) as Tab[]).map(value => <button
        key={value} type="button" role="tab" aria-selected={tab === value}
        style={{ ...styles.tab, ...(tab === value ? styles.activeTab : {}) }}
        onClick={() => { switchTab(value) }}
      >
        <span style={{ ...styles.tabLabel, ...(tab === value ? styles.activeTabLabel : {}) }}>
          {TAB_LABELS[value]}
          {value === 'updates' && updateCount > 0 && <span style={styles.count}>{updateCount}</span>}
        </span>
      </button>)}
    </nav>
    <main style={styles.list}>
      {error !== '' && <div style={styles.error}>{error}</div>}
      {installError !== '' && <div style={styles.error}>{installError}</div>}
      {restartNotice !== '' && <div style={styles.restartNotice} role="status">{restartNotice}</div>}
      {tab === 'discover' && discoverOwnerWarning !== ''
        && <div style={styles.restartNotice} role="status">{discoverOwnerWarning}</div>}
      {tab === 'mine' && myExtensionWarningText(myExtensionWarnings) !== ''
        && <div style={styles.restartNotice} role="status">{myExtensionWarningText(myExtensionWarnings)}</div>}
      {busy && <LoadingState />}
      {!busy && error === '' && detail !== undefined && <div style={styles.detail}>
        <button type="button" style={styles.detailBack} onClick={() => {
          setDetail(undefined); setInstallTask(undefined); setInstallError(''); setUninstallConfirmExtensionId(undefined)
        }}><BackIcon size={14} />返回列表</button>
        <div style={styles.detailHero}>
          <ArkmeExtensionAvatar extensionId={detail.extension_id} iconRef={detail.icon_ref} size={46} fallbackColor={colors.accent} />
          <div style={styles.cardBody}>
            <div style={styles.name}>{detail.name}</div>
            {detailStatus !== undefined && <div style={{ ...styles.meta, color: detailStatus.color }}>{detailStatus.label}</div>}
          </div>
          {(detailInstalled !== undefined || !detailInstallAction.disabled) && ((detailTask !== undefined && !detailTask.done)
            || (actionBusyExtensionId === detail.extension_id && !detailInstallAction.disabled)
            ? <InstallLoadingButton
                task={detailTask}
                onPause={() => { void controlInstall('extensions.install.pause') }}
                onResume={() => { void controlInstall('extensions.install.resume') }}
              />
            : <span style={styles.actionGroup}>
              {!detailInstallAction.disabled && <button
                type="button"
                style={styles.primaryButton}
                disabled={actionBusyExtensionId === detail.extension_id}
                onClick={() => {
                  if (tab === 'updates' && detailUpdate?.latest_version !== undefined) {
                    void startInstall({ extensionId: detail.extension_id, version: detailUpdate.latest_version })
                  } else void startInstall(extensionDirectInstallTarget(detail))
                }}
              >{detailAction}</button>}
              {detailInstalled !== undefined && <ArkmeExtensionToggle
                item={detailInstalled}
                busy={actionBusyExtensionId === detail.extension_id}
                onChange={enabled => { void toggleEnabled(detail.extension_id, enabled) }}
              />}
            </span>)}
        </div>
        <ArkmeExtensionPreviewGallery
          key={detail.extension_id}
          extensionId={detail.extension_id}
          extensionName={detail.name}
          previews={detail.preview_images ?? []}
        />
        <section style={styles.detailSection}><div style={styles.detailLabel}>作者</div><div style={styles.detailValue}>{extensionAuthorLabel(detail)}</div></section>
        {detailInstalled !== undefined && <section style={styles.detailSection}><div style={styles.detailLabel}>已安装版本</div><div style={styles.detailValue}>{displayVersion(detailInstalled.installedVersion)}</div></section>}
        {(detailUpdate?.latest_version ?? detail.version ?? detail.latest_stable_version) !== undefined && <section style={styles.detailSection}><div style={styles.detailLabel}>市场最新版本</div><div style={styles.detailValue}>{displayVersion(detailUpdate?.latest_version ?? detail.version ?? detail.latest_stable_version)}</div></section>}
        <section style={styles.detailSection}><div style={styles.detailLabel}>扩展说明</div><div style={styles.detailValue}>{detail.description || '这个扩展还没有填写说明。'}</div></section>
        {detail.manifest !== undefined && <section style={styles.detailSection}>
          <div style={styles.detailLabel}>运行能力</div>
          <Chips>
            {detail.manifest.halves.host && <Chip>Host</Chip>}
            {detail.manifest.halves.client && <Chip>Client</Chip>}
            <Chip>{detail.manifest.runtime.dsh}</Chip>
            {detail.manifest.permissions.map(permission => <Chip key={permission}>{permission}</Chip>)}
          </Chips>
        </section>}
        {detail.visibility === 'public' && <ArkmeExtensionReviews
          extensionId={detail.extension_id}
          canCreateTopLevelReview={detail.owner_user_id === undefined || detail.owner_user_id !== currentUserId}
          {...(detail.rating_summary === undefined ? {} : { initialRatingSummary: detail.rating_summary })}
        />}
        {detailInstallAction.disabled && detailInstalled === undefined && <div style={styles.detailHint}>该扩展的制品上传或发布尚未完成，目前没有可安装版本。请在 DSH 对话中重新发布成功后再安装。</div>}
        {detailInstalled !== undefined && (uninstallConfirmExtensionId === detail.extension_id
          ? <div style={styles.detailConfirm} role="alert">
            卸载会删除当前扩展制品和 Profile 依赖；如果只是暂时不使用，请关闭上方开关。
            <div style={styles.detailConfirmActions}>
              <button type="button" style={styles.restartLater} onClick={() => { setUninstallConfirmExtensionId(undefined) }}>取消</button>
              <button type="button" style={{ ...styles.detailDanger, marginTop: 0 }} disabled={actionBusyExtensionId === detail.extension_id} onClick={() => { void uninstall(detail.extension_id) }}>确认卸载</button>
            </div>
          </div>
          : <button
            type="button" style={styles.detailDanger} disabled={actionBusyExtensionId === detail.extension_id}
            onClick={() => { setUninstallConfirmExtensionId(detail.extension_id) }}
          >卸载扩展</button>)}
      </div>}
      {!busy && error === '' && detail === undefined && tab === 'discover' && <>
        {visibleItems.map(item => {
          const local = installed.find(installedItem => installedItem.extensionId === item.extension_id)
          const action = extensionCatalogAction(item, local?.installedVersion)
          return <ExtensionCard
            key={item.extension_id}
            item={item}
            {...(local === undefined || action.label === '更新' ? { actionLabel: action.label } : {})}
            {...(local === undefined ? {} : { installed: local })}
            installTask={installTask?.extensionId === item.extension_id ? installTask : undefined}
            actionBusy={actionBusyExtensionId === item.extension_id}
            onClick={() => { void inspect(item.extension_id) }}
            {...(action.disabled || (installTask !== undefined && !installTask.done)
              ? {}
              : { onAction: () => { void startInstall(extensionDirectInstallTarget(item)) } })}
            {...(local === undefined ? {} : { onToggle: (enabled: boolean) => { void toggleEnabled(item.extension_id, enabled) } })}
            onPause={() => { void controlInstall('extensions.install.pause') }}
            onResume={() => { void controlInstall('extensions.install.resume') }}
          />
        })}
        {visibleItems.length === 0 && <EmptyState tab={tab} />}
      </>}
      {!busy && error === '' && detail === undefined && tab === 'mine' && <>
        {myExtensions.map(item => {
          const extensionId = item.published?.extensionId
          const local = extensionId === undefined ? undefined : installed.find(candidate => candidate.extensionId === extensionId)
          return <MyExtensionCard
            key={item.ownedRef}
            item={item}
            {...(local === undefined ? {} : {
              installed: local,
              toggleBusy: actionBusyExtensionId === extensionId,
              onToggle: (enabled: boolean) => { void toggleEnabled(extensionId!, enabled) },
            })}
            onPublish={() => { publishMutation.current = undefined; setPublishError(''); setPublishItem(item) }}
            onEdit={() => { editMutation.current = undefined; setEditError(''); setEditItem(item) }}
          />
        })}
        {myExtensions.length === 0 && <EmptyState tab="mine" />}
      </>}
      {!busy && error === '' && tab === 'installed' && <>
        {installed.map(item => <ExtensionCard
          key={item.extensionId}
          item={installedExtensionCatalogItem(item, iconRefFor(item.extensionId))}
          installed={item}
          actionBusy={actionBusyExtensionId === item.extensionId}
          onClick={() => { void inspect(item.extensionId) }}
          onToggle={enabled => { void toggleEnabled(item.extensionId, enabled) }}
        />)}
        {installed.length === 0 && <EmptyState tab="installed" />}
      </>}
      {!busy && error === '' && tab === 'updates' && <>
        {updates.map(item => {
          const local = installed.find(installedItem => installedItem.extensionId === item.extension_id)
          const catalogItem = local === undefined
            ? { extension_id: item.extension_id, name: item.extension_id, description: '', visibility: 'private' as const }
            : installedExtensionCatalogItem(local, iconRefFor(item.extension_id))
          const canAct = installTask === undefined || installTask.done
          const updateStatus = extensionUpdateCardStatus(item)
          return <ExtensionCard
            key={item.extension_id}
            item={catalogItem}
            {...(local === undefined ? {} : { installed: local })}
            {...(item.update_available && !item.revoked ? { actionLabel: '更新' } : {})}
            {...(updateStatus === undefined ? {} : { status: updateStatus, statusColor: colors.danger })}
            actionBusy={actionBusyExtensionId === item.extension_id}
            installTask={installTask?.extensionId === item.extension_id ? installTask : undefined}
            onClick={() => { void inspect(item.extension_id) }}
            {...(!canAct || !item.update_available || item.revoked ? {} : { onAction: () => {
              void startInstall({
                extensionId: item.extension_id,
                ...(item.latest_version === undefined ? {} : { version: item.latest_version }),
              })
            } })}
            {...(local === undefined ? {} : { onToggle: (enabled: boolean) => { void toggleEnabled(item.extension_id, enabled) } })}
            onPause={() => { void controlInstall('extensions.install.pause') }}
            onResume={() => { void controlInstall('extensions.install.resume') }}
          />
        })}
        {updates.length === 0 && <EmptyState tab="updates" />}
      </>}
    </main>
    {restartPrompt !== undefined && <div style={styles.restartOverlay}>
      <section style={styles.restartDialog} role="alertdialog" aria-modal="true" aria-labelledby="arkme-extension-restart-title">
        <h3 id="arkme-extension-restart-title" style={styles.restartTitle}>需要重启 DSH</h3>
        <p style={styles.restartDescription}>
          {restartPrompt.kind === 'remove'
            ? '扩展已卸载，重启后会从当前页面完全移除。'
            : '扩展已安装到插件列表，重启后立即生效。'}
        </p>
        <div style={styles.restartActions}>
          <button type="button" style={styles.restartLater} disabled={restarting} onClick={() => { setRestartPrompt(undefined) }}>稍后</button>
          <button type="button" style={styles.primaryButton} disabled={restarting} onClick={() => { void restartNow() }}>
            {restarting ? '正在重启…' : '立即重启'}
          </button>
        </div>
      </section>
    </div>}
    {publishItem !== undefined && <ArkmeExtensionPublishDialog
      item={publishItem}
      busy={publishBusy}
      error={publishError}
      onCancel={() => { if (!publishBusy) { publishMutation.current = undefined; setPublishItem(undefined) } }}
      onSubmit={value => { void publishMyExtension(publishItem, value) }}
    />}
    {editItem !== undefined && <ArkmeExtensionEditDialog
      item={editItem}
      busy={editBusy}
      error={editError}
      onCancel={() => { if (!editBusy) { editMutation.current = undefined; setEditItem(undefined) } }}
      onSubmit={value => { void saveMyExtensionEdit(editItem, value) }}
    />}
  </div>
  </section>
  </div>

  if (typeof document === 'undefined') return dialog
  return createPortal(dialog, document.body)
}

export { ArkmeExtensionPreviewGallery, arkmeExtensionPreviewUrl, extensionPreviewSelection } from './ArkmeExtensionPreviewGallery.js'
