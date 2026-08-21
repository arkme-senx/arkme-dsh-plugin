import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowsClockwise } from '@phosphor-icons/react/dist/icons/ArrowsClockwise'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { SpeakerHigh } from '@phosphor-icons/react/dist/icons/SpeakerHigh'
import type {
  ArkmeImagePayload,
  ArkmeWorldFeedItem,
  ArkmeWorldFeedPage,
  ArkmeWorldInteractionCreateResult,
  ArkmeWorldInteractionItem,
  ArkmeWorldInteractionPage,
  ArkmeWorldVoiceprintAvailability,
  ArkmeWorldVoiceprintInviteResult,
  ArkmeWorldVoiceprintPlaybackChunk,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'

type WorldScope = 'all' | 'mine'

export type ArkmeWorldViewState = {
  status: 'loading' | 'error' | 'empty' | 'success'
  items: ArkmeWorldFeedItem[]
  message?: string
  refreshing?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  nextOffset?: number
}

const colors = {
  text: 'var(--dsw-alias-label-primary, #17191c)',
  secondary: 'var(--dsw-alias-label-secondary, #68707c)',
  border: 'var(--dsw-alias-border-l2, #e2e5e9)',
  subtle: 'var(--dsw-alias-bg-subtle, #f5f6f8)',
  accent: '#6677c8',
  danger: '#b9423b',
}

const styles: Record<string, CSSProperties> = {
  root: { flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff', color: colors.text },
  header: { minHeight: 72, padding: '18px 26px 0', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, borderBottom: `1px solid ${colors.border}` },
  heading: { margin: 0, fontSize: 22, lineHeight: '30px', fontWeight: 650, letterSpacing: '-.03em' },
  subtitle: { margin: '3px 0 0', color: colors.secondary, fontSize: 12 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  button: { minHeight: 34, padding: '0 13px', border: `1px solid ${colors.border}`, borderRadius: 10, background: '#fff', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 12 },
  iconButton: { width: 34, height: 34, padding: 0, display: 'grid', placeItems: 'center', border: `1px solid ${colors.border}`, borderRadius: 10, background: '#fff', color: colors.secondary, cursor: 'pointer' },
  primaryButton: { borderColor: '#20232d', background: '#20232d', color: '#fff' },
  tabs: { height: 44, padding: '0 26px', display: 'flex', alignItems: 'stretch', gap: 22, borderBottom: `1px solid ${colors.border}` },
  tab: { position: 'relative', padding: 0, border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 13 },
  tabActive: { borderBottom: '2px solid #20232d', color: colors.text, fontWeight: 600 },
  body: { flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', background: '#f7f8fa' },
  notice: { width: 'min(720px, calc(100% - 48px))', margin: '28px auto 0', padding: '13px 15px', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 12, background: '#fff', color: colors.secondary, fontSize: 13 },
  error: { borderColor: 'rgba(185,66,59,.25)', background: 'rgba(185,66,59,.06)', color: colors.danger },
  errorRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  feed: { width: 'min(720px, calc(100% - 48px))', margin: '18px auto 36px', display: 'grid', gap: 12 },
  card: { padding: 18, border: `1px solid ${colors.border}`, borderRadius: 16, background: '#fff' },
  cardHeader: { display: 'grid', gridTemplateColumns: '42px minmax(0,1fr) auto', alignItems: 'center', gap: 11 },
  avatar: { width: 42, height: 42, display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: '50%', background: '#e8eaf1', color: '#59616e', fontSize: 15, fontWeight: 650 },
  avatarImage: { width: '100%', height: '100%', objectFit: 'cover' },
  authorMeta: { minWidth: 0, display: 'grid', alignItems: 'center' },
  authorRow: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 },
  author: { fontSize: 13, fontWeight: 650 },
  voiceprintButton: { width: 20, height: 20, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', cursor: 'pointer', lineHeight: 0 },
  voiceprintPlayable: { color: '#4c6fff' },
  voiceprintActive: { background: 'rgba(76,111,255,.1)', color: '#3653d8' },
  voiceprintInvite: { color: '#9aa1ad' },
  time: { color: '#969ba5', fontSize: 10 },
  headline: { margin: '14px 0 0', fontSize: 16, lineHeight: 1.5 },
  text: { margin: '9px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#4d535d', fontSize: 13, lineHeight: 1.75 },
  imageGrid: { marginTop: 13, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 },
  image: { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, background: '#eef0f3' },
  imageButton: { minWidth: 0, padding: 0, border: 0, borderRadius: 10, overflow: 'hidden', background: '#eef0f3', cursor: 'zoom-in' },
  cardFooter: { minHeight: 28, marginTop: 14, paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, borderTop: `1px solid ${colors.border}` },
  linkButton: { padding: '5px 7px', border: 0, borderRadius: 7, background: 'transparent', color: colors.accent, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  commentButton: { padding: 0, border: 0, background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  loadMore: { display: 'flex', justifyContent: 'center', marginTop: 3 },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(19,21,27,.38)' },
  modal: { width: 'min(540px, 100%)', maxHeight: 'min(720px, 88vh)', overflowY: 'auto', padding: 22, boxSizing: 'border-box', borderRadius: 18, background: '#fff', boxShadow: '0 18px 60px rgba(20,22,30,.22)' },
  modalTitle: { margin: 0, fontSize: 19 },
  modalText: { margin: '7px 0 16px', color: colors.secondary, fontSize: 12, lineHeight: 1.6 },
  textarea: { width: '100%', minHeight: 130, resize: 'vertical', padding: 12, boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.text, font: 'inherit', fontSize: 13, lineHeight: 1.6, outline: 0 },
  fieldLabel: { display: 'grid', gap: 7, marginTop: 12, color: colors.secondary, fontSize: 12 },
  fileInput: { maxWidth: '100%', color: colors.secondary, fontSize: 12 },
  modalActions: { marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  modalError: { color: colors.danger, fontSize: 12 },
  invitePreview: { margin: '10px 0 0', padding: 12, borderRadius: 12, background: colors.subtle, color: colors.secondary, fontSize: 12, lineHeight: 1.6 },
  interactionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  interactionList: { display: 'grid', gap: 9, margin: '14px 0' },
  interaction: { padding: 11, borderRadius: 11, background: colors.subtle },
  interactionMeta: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: colors.secondary, fontSize: 10 },
  previewModal: { width: 'min(960px, 94vw)', height: 'min(720px, 88vh)', padding: 14, boxSizing: 'border-box', display: 'grid', gridTemplateRows: '38px minmax(0,1fr)', borderRadius: 18, background: '#17191f' },
  previewHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff', fontSize: 12 },
  previewStage: { minWidth: 0, minHeight: 0, display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) 44px', alignItems: 'center', gap: 10 },
  previewImage: { width: '100%', height: '100%', objectFit: 'contain', borderRadius: 10 },
  previewButton: { width: 38, height: 38, border: 0, borderRadius: 10, background: 'rgba(255,255,255,.12)', color: '#fff', cursor: 'pointer' },
  replyTarget: { marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: colors.accent, fontSize: 12 },
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ArkmeClientError) {
    if (error.body.code === 'world-voiceprint-invite-rate-limited' || /\bHTTP\s*429\b/.test(error.body.message)) {
      return '提醒发送太频繁了，稍后再试。'
    }
    return error.body.message
  }
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback
}

function dateTimeLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function worldInviteSubject(item: Pick<ArkmeWorldFeedItem, 'headline' | 'textContent'>): string {
  const subject = (item.headline.trim() || item.textContent.trim()).replace(/\s+/g, ' ')
  return subject.length > 28 ? `${subject.slice(0, 28)}…` : subject
}

export function voiceprintInvitePromptTitle(item: Pick<ArkmeWorldFeedItem, 'authorName' | 'headline' | 'textContent'>): string {
  const subject = worldInviteSubject(item)
  return subject === '' ? `是否邀请${item.authorName}开启声纹？` : `是否邀请${item.authorName}朗读「${subject}」？`
}

function uuid(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function withTimeout<T>(promise: Promise<T>, millis: number, message: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { onTimeout?.(); reject(new Error(message)) }, millis)
  })
  try { return await Promise.race([promise, timeout]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

function WorldImage({ imageRef, alt, avatar = false, preview = false }: { imageRef: string; alt: string; avatar?: boolean; preview?: boolean }) {
  const [source, setSource] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setSource('')
    setFailed(false)
    void callArkme<ArkmeImagePayload>('world.image.read', { imageRef }, controller.signal)
      .then(image => { setSource(`data:${image.mediaType};base64,${image.dataBase64}`) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => { controller.abort() }
  }, [imageRef])
  const imageStyle = avatar ? styles.avatarImage : preview ? styles.previewImage : styles.image
  if (failed) return <span style={imageStyle} aria-label={`${alt}加载失败`} />
  return <img src={source || undefined} alt={alt} loading={avatar || preview ? 'eager' : 'lazy'} style={imageStyle} />
}

function WorldCard({ item, playable, voiceprintActive, onOpenInteractions, onToggleVoiceprint, onInviteVoiceprint }: {
  item: ArkmeWorldFeedItem
  playable: boolean
  voiceprintActive: boolean
  onOpenInteractions(item: ArkmeWorldFeedItem): void
  onToggleVoiceprint(recordRef: string): void
  onInviteVoiceprint(item: ArkmeWorldFeedItem): void
}) {
  const [previewIndex, setPreviewIndex] = useState<number>()
  return <article style={styles.card} data-world-record-ref={item.recordRef}>
    <header style={styles.cardHeader}>
      <span style={styles.avatar}>{item.avatarRef === undefined
        ? item.avatarFallback?.label ?? item.authorName.slice(0, 1)
        : <WorldImage imageRef={item.avatarRef} alt={`${item.authorName}的头像`} avatar />}</span>
      <span style={styles.authorMeta}>
        <span style={styles.authorRow}>
          <strong style={styles.author}>{item.authorName}</strong>
          {playable
            ? <button type="button" style={{ ...styles.voiceprintButton, ...styles.voiceprintPlayable, ...(voiceprintActive ? styles.voiceprintActive : {}) }} title={voiceprintActive ? '停止播放声纹' : '播放声纹'} aria-label={voiceprintActive ? `停止播放${item.authorName}的声纹` : `播放${item.authorName}的声纹`} onClick={() => { onToggleVoiceprint(item.recordRef) }}>
              <SpeakerHigh size={15} weight={voiceprintActive ? 'fill' : 'bold'} />
            </button>
            : <button type="button" style={{ ...styles.voiceprintButton, ...styles.voiceprintInvite }} title="邀请开启声纹" aria-label={`邀请${item.authorName}开启声纹`} onClick={() => { onInviteVoiceprint(item) }}>
              <Plus size={13} weight="bold" />
            </button>}
        </span>
      </span>
      <time style={styles.time}>{dateTimeLabel(item.publishedAtMillis || item.createdAtMillis)}</time>
    </header>
    {item.headline !== '' && <h2 style={styles.headline}>{item.headline}</h2>}
    {item.textContent.trim() !== '' && <p style={styles.text}>{item.textContent}</p>}
    {item.imageRefs.length > 0 && <div style={styles.imageGrid}>{item.imageRefs.slice(0, 3).map((imageRef, index) =>
      <button key={imageRef} type="button" style={styles.imageButton} aria-label={`预览${item.authorName}发布的图片 ${String(index + 1)}`} onClick={() => { setPreviewIndex(index) }}>
        <WorldImage imageRef={imageRef} alt={`${item.authorName}发布的图片 ${String(index + 1)}`} />
      </button>)}</div>}
    <footer style={styles.cardFooter}>
      <button type="button" style={styles.commentButton} onClick={() => { onOpenInteractions(item) }}>
        {item.extendCount > 0 ? `评论：${String(item.extendCount)}` : '评论'}
      </button>
    </footer>
    {previewIndex !== undefined && item.imageRefs[previewIndex] !== undefined && <div role="dialog" aria-modal="true" aria-label="世界图片预览" style={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) setPreviewIndex(undefined) }}>
      <section style={styles.previewModal}>
        <header style={styles.previewHeader}><span>{item.authorName} · {previewIndex + 1} / {item.imageRefs.length}</span><button type="button" style={styles.previewButton} onClick={() => { setPreviewIndex(undefined) }}>关闭</button></header>
        <div style={styles.previewStage}>
          <button type="button" style={styles.previewButton} disabled={previewIndex === 0} onClick={() => { setPreviewIndex(index => Math.max(0, (index ?? 0) - 1)) }}>‹</button>
          <WorldImage imageRef={item.imageRefs[previewIndex]!} alt={`${item.authorName}发布的图片 ${String(previewIndex + 1)}`} preview />
          <button type="button" style={styles.previewButton} disabled={previewIndex === item.imageRefs.length - 1} onClick={() => { setPreviewIndex(index => Math.min(item.imageRefs.length - 1, (index ?? 0) + 1)) }}>›</button>
        </div>
      </section>
    </div>}
  </article>
}

function VoiceprintInviteDialog({ item, sending, message, onClose, onConfirm }: {
  item: ArkmeWorldFeedItem
  sending: boolean
  message?: string
  onClose(): void
  onConfirm(item: ArkmeWorldFeedItem): void
}) {
  const subject = worldInviteSubject(item)
  return <div role="dialog" aria-modal="true" aria-label="邀请开启声纹" style={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section style={styles.modal}>
      <h2 style={styles.modalTitle}>{voiceprintInvitePromptTitle(item)}</h2>
      <p style={styles.modalText}>点击提醒后，会给对方发送一条私信，邀请他开启声纹。</p>
      {subject !== '' && <div style={styles.invitePreview}>{subject}</div>}
      <div style={styles.modalActions}>
        <span role="status" style={message === undefined ? styles.subtitle : styles.modalError}>{message ?? ''}</span>
        <span style={styles.headerActions}>
          <button type="button" style={styles.button} disabled={sending} onClick={onClose}>取消</button>
          <button type="button" style={{ ...styles.button, ...styles.primaryButton }} disabled={sending} onClick={() => { onConfirm(item) }}>{sending ? '发送中…' : '提醒'}</button>
        </span>
      </div>
    </section>
  </div>
}

export function ArkmeWorldContent({ state, scope, voiceprintPlayableRefs, voiceprintRecordRef, actionMessage, onRefresh, onSelectScope, onOpenComposer, onOpenInteractions, onToggleVoiceprint, onInviteVoiceprint, onLoadMore }: {
  state: ArkmeWorldViewState
  scope: WorldScope
  voiceprintPlayableRefs: ReadonlySet<string>
  voiceprintRecordRef: string | undefined
  actionMessage?: string
  onRefresh(): void
  onSelectScope(scope: WorldScope): void
  onOpenComposer(): void
  onOpenInteractions(item: ArkmeWorldFeedItem): void
  onToggleVoiceprint(recordRef: string): void
  onInviteVoiceprint?(item: ArkmeWorldFeedItem): void
  onLoadMore?(): void
}) {
  return <>
    <header style={styles.header}>
      <div><h1 style={styles.heading}>世界</h1><p style={styles.subtitle}>看看大家此刻正在记录什么</p></div>
      <div style={styles.headerActions}>
        <button type="button" style={styles.iconButton} disabled={state.refreshing} title={state.refreshing ? '刷新中' : '刷新'} aria-label={state.refreshing ? '刷新中' : '刷新'} onClick={onRefresh}>
          <ArrowsClockwise size={16} weight="bold" />
        </button>
        <button type="button" style={{ ...styles.button, ...styles.primaryButton }} onClick={onOpenComposer}>发世界</button>
      </div>
    </header>
    <nav style={styles.tabs} aria-label="世界范围">
      <button type="button" style={{ ...styles.tab, ...(scope === 'all' ? styles.tabActive : {}) }} aria-current={scope === 'all' ? 'page' : undefined} onClick={() => { onSelectScope('all') }}>世界</button>
      <button type="button" style={{ ...styles.tab, ...(scope === 'mine' ? styles.tabActive : {}) }} aria-current={scope === 'mine' ? 'page' : undefined} onClick={() => { onSelectScope('mine') }}>我的世界</button>
    </nav>
    <div style={styles.body}>
      {actionMessage !== undefined && <div role="status" style={{ ...styles.notice, ...(actionMessage.startsWith('已') ? {} : styles.error) }}>{actionMessage}</div>}
      {state.status === 'loading' && <div role="status" style={styles.notice}>正在加载世界…</div>}
      {state.status === 'error' && <div role="alert" style={{ ...styles.notice, ...styles.error, ...styles.errorRow }}><span>{state.message}</span><button type="button" style={styles.button} onClick={onRefresh}>重试</button></div>}
      {state.status === 'empty' && <div style={styles.notice}>这里还没有世界动态。你可以先发一条，或者稍后再刷新。</div>}
      {state.status === 'success' && <div style={styles.feed}>
        {state.message !== undefined && <div role="status" style={{ ...styles.notice, ...styles.error, width: '100%', margin: 0 }}>{state.message}</div>}
        {state.items.map(item => <WorldCard
          key={item.recordRef}
          item={item}
          playable={voiceprintPlayableRefs.has(item.recordRef)}
          voiceprintActive={voiceprintRecordRef === item.recordRef}
          onOpenInteractions={onOpenInteractions}
          onToggleVoiceprint={onToggleVoiceprint}
          onInviteVoiceprint={onInviteVoiceprint ?? (() => {})}
        />)}
        {state.hasMore && <div style={styles.loadMore}><button type="button" style={styles.button} disabled={state.loadingMore} onClick={onLoadMore}>{state.loadingMore ? '加载中…' : '加载更多'}</button></div>}
      </div>}
    </div>
  </>
}

async function fileBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

function PublishDialog({ onClose, onPublished }: { onClose(): void; onPublished(): void }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const sendingRef = useRef(false)
  const submit = async () => {
    if (sendingRef.current) return
    const textContent = text.trim()
    if (textContent === '') { setMessage(files.length > 0 ? '图片动态也需要写一点文字' : '请输入要发到世界的内容'); return }
    if (files.some(file => !file.type.startsWith('image/'))) { setMessage('只能上传图片'); return }
    if (files.some(file => file.size > 20 * 1024 * 1024)) { setMessage('单张图片不能超过 20MB'); return }
    const controller = new AbortController()
    sendingRef.current = true
    setSending(true)
    setMessage(files.length > 0 ? '正在上传图片…' : '正在发布…')
    try {
      const assets = await withTimeout(Promise.all(files.map(async file => await callArkme<{ fileAssetUid: string }>('world.upload-image-data', {
        fileName: file.name || 'world-image', mimeType: file.type, size: file.size, dataBase64: await fileBase64(file),
      }, controller.signal))), 60_000, '图片上传等待太久，请检查网络后重试', () => { controller.abort() })
      setMessage('正在发布…')
      await withTimeout(callArkme(files.length > 0 ? 'world.publish-rich' : 'world.publish-text', {
        clientMutationId: uuid(), textContent,
        fileAssets: assets.map((asset, index) => ({ fileAssetUid: asset.fileAssetUid, mediaType: 'image', fileKind: 1, sortOrder: index })),
      }, controller.signal), 90_000, '发布等待太久，请刷新世界后确认是否已发布', () => { controller.abort() })
      onPublished()
      onClose()
    } catch (error) { setMessage(messageOf(error, '发布失败，请稍后重试')) }
    finally { controller.abort(); sendingRef.current = false; setSending(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label="发世界" style={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section style={styles.modal}>
      <h2 style={styles.modalTitle}>发世界</h2>
      <p style={styles.modalText}>发布后会作为公开动态展示。功能如果暂未接通，失败原因会保留在这里，草稿不会被清空。</p>
      <textarea style={styles.textarea} value={text} disabled={sending} maxLength={2000} autoFocus placeholder="分享此刻的想法…" onChange={event => { setText(event.currentTarget.value); setMessage('') }} />
      <label style={styles.fieldLabel}>图片（最多 9 张）<input style={styles.fileInput} type="file" accept="image/*" multiple disabled={sending} onChange={event => { setFiles(Array.from(event.currentTarget.files ?? []).slice(0, 9)); setMessage('') }} /></label>
      <div style={styles.modalActions}>
        <span role="status" style={message.includes('正在') ? styles.subtitle : styles.modalError}>{message}</span>
        <span style={styles.headerActions}><button type="button" style={styles.button} disabled={sending} onClick={onClose}>取消</button><button type="button" style={{ ...styles.button, ...styles.primaryButton }} disabled={sending} onClick={() => { void submit() }}>{sending ? '发布中…' : '发布'}</button></span>
      </div>
    </section>
  </div>
}

function InteractionDialog({ item, onClose }: { item: ArkmeWorldFeedItem; onClose(): void }) {
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; items: ArkmeWorldInteractionItem[]; message?: string; hasMore: boolean; nextOffset?: number; loadingMore?: boolean }>({ status: 'loading', items: [], hasMore: false })
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [replyTarget, setReplyTarget] = useState<ArkmeWorldInteractionItem>()
  const load = useCallback(() => {
    setState({ status: 'loading', items: [], hasMore: false })
    void callArkme<ArkmeWorldInteractionPage>('world.interactions.list', { recordRef: item.recordRef, limit: 50, offset: 0 })
      .then(page => { setState({ status: 'ready', items: page.items, hasMore: page.hasMore, ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }) }) })
      .catch(error => { setState({ status: 'error', items: [], hasMore: false, message: messageOf(error, '互动暂时无法加载') }) })
  }, [item.recordRef])
  useEffect(load, [load])
  const loadMore = async () => {
    if (state.loadingMore || state.nextOffset === undefined) return
    setState(current => {
      const { message: _message, ...rest } = current
      return { ...rest, loadingMore: true }
    })
    try {
      const page = await callArkme<ArkmeWorldInteractionPage>('world.interactions.list', { recordRef: item.recordRef, limit: 50, offset: state.nextOffset })
      setState(current => ({ ...current, status: 'ready', items: [...current.items, ...page.items], hasMore: page.hasMore, loadingMore: false, ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }) }))
    } catch (error) { setState(current => ({ ...current, loadingMore: false, message: messageOf(error, '更多互动加载失败，请重试') })) }
  }
  const send = async () => {
    const textContent = draft.trim()
    if (textContent === '' || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      const result = await callArkme<ArkmeWorldInteractionCreateResult>('world.interactions.create-text', { targetRef: replyTarget?.interactionRef ?? item.recordRef, textContent, clientMutationId: uuid() })
      setState(current => {
        const { message: _message, ...rest } = current
        return { ...rest, status: 'ready', items: [...current.items, result.interaction] }
      })
      setDraft('')
      setReplyTarget(undefined)
    } catch (error) { setState(current => ({ ...current, message: messageOf(error, '互动发送失败，请重试') })) }
    finally { sendingRef.current = false; setSending(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label="世界互动详情" style={styles.modalBackdrop}>
    <section style={styles.modal}>
      <header style={styles.interactionHeader}><div><h2 style={styles.modalTitle}>互动详情</h2><p style={styles.subtitle}>{item.authorName}</p></div><button type="button" style={styles.button} onClick={onClose}>返回世界</button></header>
      {item.headline !== '' && <h3>{item.headline}</h3>}{item.textContent !== '' && <p style={styles.text}>{item.textContent}</p>}
      {state.status === 'loading' && <p style={styles.notice}>互动加载中…</p>}
      {state.message !== undefined && <div role="alert" style={{ ...styles.notice, ...styles.error, width: '100%', margin: '14px 0 0' }}>{state.message}{state.status === 'error' && <button type="button" style={{ ...styles.button, marginLeft: 12 }} onClick={load}>重试</button>}</div>}
      <div style={styles.interactionList}>{state.items.map(interaction => <article key={interaction.interactionRef} style={styles.interaction}><header style={styles.interactionMeta}><strong>{interaction.authorName}</strong><time>{dateTimeLabel(interaction.publishedAtMillis || interaction.createdAtMillis)}</time></header><p style={styles.text}>{interaction.textContent}</p><button type="button" style={styles.linkButton} onClick={() => { setReplyTarget(current => current?.interactionRef === interaction.interactionRef ? undefined : interaction) }}>{replyTarget?.interactionRef === interaction.interactionRef ? '取消回复' : '回复'}</button></article>)}</div>
      {state.hasMore && <div style={styles.loadMore}><button type="button" style={styles.button} disabled={state.loadingMore} onClick={() => { void loadMore() }}>{state.loadingMore ? '加载中…' : '加载更多互动'}</button></div>}
      {state.status === 'ready' && state.items.length === 0 && <p style={styles.subtitle}>还没有互动，来写第一条评论吧。</p>}
      {replyTarget !== undefined && <div style={styles.replyTarget}><span>回复 {replyTarget.authorName}</span><button type="button" style={styles.linkButton} onClick={() => { setReplyTarget(undefined) }}>取消回复</button></div>}
      <textarea style={{ ...styles.textarea, minHeight: 90 }} value={draft} disabled={sending} maxLength={20_000} placeholder={replyTarget === undefined ? '写一条评论…' : `回复 ${replyTarget.authorName}…`} onChange={event => { setDraft(event.currentTarget.value) }} />
      <div style={{ ...styles.modalActions, justifyContent: 'flex-end' }}><button type="button" style={{ ...styles.button, ...styles.primaryButton }} disabled={sending || draft.trim() === ''} onClick={() => { void send() }}>{sending ? '发送中…' : '发送'}</button></div>
    </section>
  </div>
}

const loadingState = (): ArkmeWorldViewState => ({ status: 'loading', items: [] })

/** First-party World page owned by the same product surface as recordings. */
export function ArkmeWorldSurface() {
  const [scope, setScope] = useState<WorldScope>('all')
  const [views, setViews] = useState<Record<WorldScope, ArkmeWorldViewState>>({ all: loadingState(), mine: loadingState() })
  const [loaded, setLoaded] = useState<Record<WorldScope, boolean>>({ all: false, mine: false })
  const [composerOpen, setComposerOpen] = useState(false)
  const [interactionItem, setInteractionItem] = useState<ArkmeWorldFeedItem>()
  const [inviteItem, setInviteItem] = useState<ArkmeWorldFeedItem>()
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteMessage, setInviteMessage] = useState<string>()
  const [playableRefs, setPlayableRefs] = useState<Set<string>>(() => new Set())
  const [voiceprintRecordRef, setVoiceprintRecordRef] = useState<string>()
  const [actionMessage, setActionMessage] = useState<string>()
  const loadController = useRef<AbortController>()
  const audioRef = useRef<HTMLAudioElement>()
  const voiceprintTokenRef = useRef(0)
  const state = views[scope]

  const load = useCallback((target: WorldScope, offset = 0, preserveItems = false) => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setViews(current => ({
      ...current,
      [target]: offset === 0
        ? preserveItems && current[target].items.length > 0
          ? { ...current[target], refreshing: true, message: undefined }
          : loadingState()
        : { ...current[target], loadingMore: true, message: undefined },
    }))
    const operation = target === 'mine' ? 'world.mine' : 'world.feed'
    void callArkme<ArkmeWorldFeedPage>(operation, { limit: 20, offset }, controller.signal).then(page => {
      if (controller.signal.aborted) return
      setLoaded(current => ({ ...current, [target]: true }))
      setViews(current => {
        const items = offset === 0 ? page.items : [...current[target].items, ...page.items]
        return { ...current, [target]: { status: items.length === 0 ? 'empty' : 'success', items, hasMore: page.hasMore, ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }) } }
      })
    }).catch(error => {
      if (controller.signal.aborted) return
      setLoaded(current => ({ ...current, [target]: true }))
      setViews(current => {
        const previous = current[target]
        const message = messageOf(error, target === 'mine' ? '我的世界暂时无法加载' : '世界暂时无法加载')
        return {
          ...current,
          [target]: previous.items.length > 0
            ? { ...previous, status: 'success', refreshing: false, loadingMore: false, message }
            : { status: 'error', items: [], message },
        }
      })
    })
  }, [])

  useEffect(() => { if (!loaded[scope]) load(scope) }, [load, loaded, scope])
  useEffect(() => () => { loadController.current?.abort(); voiceprintTokenRef.current += 1; audioRef.current?.pause() }, [])
  useEffect(() => {
    if (state.status !== 'success' || state.items.length === 0) { setPlayableRefs(new Set()); return }
    const controller = new AbortController()
    void callArkme<ArkmeWorldVoiceprintAvailability>('world.voiceprint.availability', { recordRefs: state.items.map(item => item.recordRef).slice(0, 20) }, controller.signal)
      .then(result => { setPlayableRefs(new Set(result.items.filter(item => item.playable).map(item => item.recordRef))) })
      .catch(() => { if (!controller.signal.aborted) setPlayableRefs(new Set()) })
    return () => { controller.abort() }
  }, [state.items, state.status])

  const refresh = () => { setActionMessage(undefined); load(scope, 0, true) }
  const selectScope = (next: WorldScope) => { setActionMessage(undefined); setScope(next) }
  const toggleVoiceprint = async (recordRef: string) => {
    if (voiceprintRecordRef === recordRef) { voiceprintTokenRef.current += 1; audioRef.current?.pause(); audioRef.current = undefined; setVoiceprintRecordRef(undefined); return }
    const token = voiceprintTokenRef.current + 1
    voiceprintTokenRef.current = token
    audioRef.current?.pause()
    setActionMessage(undefined)
    setVoiceprintRecordRef(recordRef)
    const playChunk = async (chunkIndex: number): Promise<void> => {
      const chunk = await callArkme<ArkmeWorldVoiceprintPlaybackChunk>('world.voiceprint.playback.generate', { recordRef, chunkIndex })
      if (voiceprintTokenRef.current !== token) return
      if (typeof Audio === 'undefined') throw new Error('当前环境无法播放声音')
      const audio = new Audio(`/arkme-self/api/media?ref=${encodeURIComponent(chunk.mediaRef)}`)
      audioRef.current = audio
      audio.onended = () => {
        if (voiceprintTokenRef.current !== token) return
        if (chunk.chunkIndex + 1 < chunk.chunkCount) void playChunk(chunk.chunkIndex + 1).catch(fail)
        else { setVoiceprintRecordRef(undefined); audioRef.current = undefined }
      }
      audio.onerror = () => { fail(new Error('声纹音频播放失败，请重试')) }
      await audio.play()
    }
    const fail = (error: unknown) => {
      if (voiceprintTokenRef.current !== token) return
      voiceprintTokenRef.current += 1
      setActionMessage(messageOf(error, '声纹生成失败，请重试'))
      setVoiceprintRecordRef(undefined)
      audioRef.current = undefined
    }
    await playChunk(0).catch(fail)
  }
  const openVoiceprintInvite = (item: ArkmeWorldFeedItem) => {
    setActionMessage(undefined)
    setInviteMessage(undefined)
    setInviteItem(item)
  }
  const inviteVoiceprint = async (item: ArkmeWorldFeedItem) => {
    if (inviteSending) return
    setInviteSending(true)
    setInviteMessage(undefined)
    try {
      const result = await callArkme<ArkmeWorldVoiceprintInviteResult>('world.voiceprint.invite', { recordRef: item.recordRef })
      setInviteItem(undefined)
      setActionMessage(`已提醒 ${result.peerDisplayName || item.authorName} 开启声纹`)
    } catch (error) { setInviteMessage(messageOf(error, '声纹邀请发送失败，请稍后重试')) }
    finally { setInviteSending(false) }
  }

  return <main style={styles.root} data-arkme-owned="world-surface" aria-label="世界">
    <ArkmeWorldContent state={state} scope={scope} voiceprintPlayableRefs={playableRefs} voiceprintRecordRef={voiceprintRecordRef}
      {...(actionMessage === undefined ? {} : { actionMessage })}
      onRefresh={refresh} onSelectScope={selectScope} onOpenComposer={() => { setComposerOpen(true) }}
      onOpenInteractions={setInteractionItem} onToggleVoiceprint={recordRef => { void toggleVoiceprint(recordRef) }}
      onInviteVoiceprint={openVoiceprintInvite} onLoadMore={() => { if (state.nextOffset !== undefined) load(scope, state.nextOffset) }} />
    {composerOpen && <PublishDialog onClose={() => { setComposerOpen(false) }} onPublished={() => { setLoaded(current => ({ ...current, all: false, mine: false })); setScope('mine') }} />}
    {interactionItem !== undefined && <InteractionDialog item={interactionItem} onClose={() => { setInteractionItem(undefined) }} />}
    {inviteItem !== undefined && <VoiceprintInviteDialog item={inviteItem} sending={inviteSending} {...(inviteMessage === undefined ? {} : { message: inviteMessage })} onClose={() => { if (!inviteSending) setInviteItem(undefined) }} onConfirm={item => { void inviteVoiceprint(item) }} />}
  </main>
}
