import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type {
  ArkmeContactSearchResult,
  ArkmeMyVoiceprint,
  ArkmeRecognizedPersonDetail,
  ArkmeRecognizedPersonIdentityKind,
  ArkmeRecognizedPersonPage,
  ArkmeRecognizedVoiceprintLibrary,
  ArkmeVoiceprintGrantPage,
  ArkmeVoiceprintInvitation,
} from '../types.js'
import { ARKME_VOICEPRINT_ENROLLMENT_MIN_DURATION_MS } from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeAuthStore } from './auth-store.js'
import {
  arkmeVoiceprintEnrollmentClient,
  type ArkmeVoiceprintEnrollmentClient,
} from './voiceprint-enrollment-client.js'
import {
  BrowserPcmVoiceprintRecorder,
  type ArkmeVoiceprintRecorder,
  type ArkmeVoiceprintRecording,
} from './voiceprint-recorder.js'

export type ArkmeVoiceprintResource<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; value: T; message?: string }

export type ArkmeVoiceprintInvitationState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'error'; message: string }
  | { status: 'success'; value: ArkmeVoiceprintInvitation }

const colors = {
  text: 'var(--dsw-alias-text-primary, #20232c)',
  secondary: 'var(--dsw-alias-text-secondary, #6f7480)',
  border: 'var(--dsw-alias-border-subtle, #e6e7eb)',
  surface: 'var(--dsw-alias-bg-layer-1, #fff)',
  subtle: 'var(--dsw-alias-bg-layer-2, #f6f7f9)',
  action: 'var(--dsw-alias-accent-primary, #20232c)',
  inverted: 'var(--dsw-alias-label-primary-inverted, #fff)',
  danger: 'var(--dsw-alias-state-error-primary, #b42318)',
  dangerSurface: 'var(--dsw-alias-interactive-bg-hover-danger, #fff1f0)',
}

const styles: Record<string, CSSProperties> = {
  root: { width: '100%', height: '100%', minWidth: 0, overflowY: 'auto', background: colors.surface, color: colors.text },
  inner: { width: 'min(1040px, calc(100% - 40px))', margin: '0 auto', padding: '34px 0 48px' },
  header: { marginBottom: 24 },
  eyebrow: { margin: 0, color: colors.secondary, fontSize: 13 },
  title: { margin: '5px 0 7px', fontSize: 29, lineHeight: '38px', letterSpacing: '-.02em' },
  subtitle: { margin: 0, color: colors.secondary, fontSize: 14, lineHeight: '22px' },
  content: { display: 'flex', flexDirection: 'column', gap: 32 },
  relationships: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 32, alignItems: 'start' },
  card: { border: `1px solid ${colors.border}`, borderRadius: 18, padding: 20, background: colors.surface, minWidth: 0 },
  section: { minWidth: 0 },
  outboundSection: { minWidth: 0, paddingLeft: 28, borderLeft: `1px solid ${colors.border}` },
  cardHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  cardTitle: { margin: 0, fontSize: 17, lineHeight: '24px' },
  cardHint: { display: 'block', marginTop: 3, color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  badge: { padding: '3px 9px', borderRadius: 999, background: colors.subtle, color: colors.secondary, fontSize: 11, whiteSpace: 'nowrap' },
  state: { padding: '18px 0', color: colors.secondary, fontSize: 13, lineHeight: '20px' },
  error: { padding: 12, borderRadius: 12, background: colors.dangerSurface, color: colors.danger, fontSize: 13, lineHeight: '20px' },
  list: { display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0, listStyle: 'none' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 12, borderRadius: 13, background: colors.subtle },
  rowIdentity: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 },
  rowCopy: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  rowTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 },
  rowMeta: { color: colors.secondary, fontSize: 11, lineHeight: '17px' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 15 },
  headActions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  button: { minHeight: 34, padding: '7px 12px', border: `1px solid ${colors.border}`, borderRadius: 10, background: colors.surface, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 12 },
  primary: { background: colors.action, color: colors.inverted, borderColor: colors.action },
  dangerButton: { color: colors.danger, background: colors.surface },
  linkBox: { padding: 12, borderRadius: 12, background: colors.subtle, wordBreak: 'break-all', fontSize: 12, lineHeight: '19px' },
  overlay: { position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(20, 23, 31, .36)' },
  dialog: { width: 'min(520px, 100%)', maxHeight: 'min(720px, calc(100vh - 40px))', overflowY: 'auto', borderRadius: 20, padding: 22, background: colors.surface, boxShadow: '0 24px 80px rgba(20, 23, 31, .22)' },
  recorder: { minHeight: 96, display: 'grid', placeItems: 'center', borderRadius: 15, background: colors.subtle, color: colors.secondary, textAlign: 'center' },
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback
}

function dateLabel(millis: number): string {
  return millis <= 0 ? '时间未知' : new Date(millis).toLocaleDateString('zh-CN')
}

function copyText(value: string): void {
  const operation = navigator.clipboard?.writeText(value)
  if (operation !== undefined) void operation.catch(() => undefined)
}

function requestActive(signal: AbortSignal | undefined): boolean {
  return signal?.aborted !== true
}

function ResourceError({ message, onRetry }: { message: string; onRetry(): void }) {
  return <div style={styles.error} role="alert">{message}<div style={styles.actions}><button type="button" style={styles.button} onClick={() => { onRetry() }}>重试</button></div></div>
}

function VoiceprintWavPreview({ recording }: { recording: ArkmeVoiceprintRecording }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const value = URL.createObjectURL(new Blob([new Uint8Array(recording.wav).buffer], { type: 'audio/wav' }))
    setUrl(value)
    return () => { URL.revokeObjectURL(value) }
  }, [recording])
  return url === '' ? null : <audio controls preload="metadata" src={url} aria-label="试听本次声纹录音" style={{ width: '100%', marginTop: 12 }} />
}

export interface ArkmeVoiceprintContentProps {
  status: ArkmeVoiceprintResource<ArkmeMyVoiceprint>
  grants: ArkmeVoiceprintResource<ArkmeVoiceprintGrantPage>
  people: ArkmeVoiceprintResource<ArkmeRecognizedPersonPage>
  invitation: ArkmeVoiceprintInvitationState
  onRefreshStatus(): void
  onRefreshGrants(): void
  onRefreshPeople(): void
  onMoreGrants?(): void
  onMorePeople?(): void
  revokingGrantRef?: string
  restoreBusy?: boolean
  onInvite(): void
  onRevoke(grantRef: string, displayName: string): void
  onRestore(): void
  onOpenPerson(personRef: string, identityKind: ArkmeRecognizedPersonIdentityKind): void
  onStartEnrollment(): void
}

export function ArkmeVoiceprintContent(props: ArkmeVoiceprintContentProps) {
  return <div style={styles.content}>
    <section style={styles.card} aria-label="我的声音" data-voiceprint-layer="foundation">
      <div style={styles.cardHead}><span><h2 style={styles.cardTitle}>我的声音</h2><small style={styles.cardHint}>管理声纹录入、识别与播放能力</small></span><button type="button" style={styles.button} onClick={() => { props.onRefreshStatus() }}>刷新状态</button></div>
      {props.status.status === 'loading' ? <div style={styles.state} role="status">正在加载我的声音…</div>
        : props.status.status === 'error' ? <ResourceError message={props.status.message} onRetry={props.onRefreshStatus} />
          : <>
            <div style={styles.row}><span style={styles.rowCopy}><strong style={styles.rowTitle}>{props.status.value.hasVoiceprint ? props.status.value.nickname || '我的声音' : '尚未录入声纹'}</strong><small style={styles.rowMeta}>{props.status.value.enrollmentPending ? '声纹正在处理中' : props.status.value.hasVoiceprint ? `最近更新：${dateLabel(props.status.value.updatedAtMillis)}` : '录制 3 至 60 秒清晰语音即可录入'}</small></span><span style={styles.badge}>{props.status.value.canPlay ? '可识别 · 可播放' : props.status.value.canIdentify ? '可识别' : '未录入'}</span></div>
            <div style={styles.actions}>
              {!props.status.value.enrollmentPending && <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={props.onStartEnrollment}>{props.status.value.hasVoiceprint ? '重新录入声纹' : '录入我的声纹'}</button>}
              {props.status.value.canRestorePlayback && <button type="button" style={styles.button} disabled={props.restoreBusy} onClick={props.onRestore}>{props.restoreBusy ? '正在恢复…' : '恢复声纹播放'}</button>}
            </div>
            {props.status.message !== undefined && <div style={{ ...styles.error, marginTop: 12 }}>{props.status.message}</div>}
          </>}
    </section>

    <div className="arkme-voiceprint-relationships" style={styles.relationships} data-voiceprint-layout="primary-secondary">
      <section style={styles.section} aria-label="我识别到的人">
        <div style={styles.cardHead}><span><h2 style={styles.cardTitle}>我识别到的人</h2><small style={styles.cardHint}>已识别的声音及我获得的播放权限</small></span><span style={styles.headActions}>{props.people.status === 'success' && <span style={styles.badge}>{props.people.value.items.length} 人</span>}<button type="button" style={styles.button} onClick={() => { props.onRefreshPeople() }}>刷新识别</button><button type="button" style={{ ...styles.button, ...styles.primary }} disabled={props.invitation.status === 'busy'} onClick={props.onInvite}>{props.invitation.status === 'busy' ? '正在生成…' : props.invitation.status === 'success' ? '重新生成邀请链接' : '邀请他人授权'}</button></span></div>
        {props.invitation.status === 'success' && <div style={{ marginBottom: 16 }}><div style={styles.linkBox}>{props.invitation.value.inviteUrl}</div><div style={styles.actions}><button type="button" style={styles.button} onClick={() => { copyText(props.invitation.status === 'success' ? props.invitation.value.inviteUrl : '') }}>复制邀请链接</button></div></div>}
        {props.invitation.status === 'error' && <div style={{ ...styles.error, marginBottom: 16 }} role="alert">{props.invitation.message}</div>}
        {props.invitation.status === 'idle' && <div style={{ ...styles.cardHint, marginBottom: 16 }}>邀请由对方明确授权，不会自动改变任何人的权限。</div>}
        {props.people.status === 'loading' ? <div style={styles.state} role="status">正在加载我识别到的人…</div>
          : props.people.status === 'error' ? <ResourceError message={props.people.message} onRetry={props.onRefreshPeople} />
            : props.people.value.items.length === 0 ? <div style={styles.state}>还没有识别到其他人</div>
              : <><ul style={styles.list}>{props.people.value.items.map(item => <li key={item.personRef} style={styles.row}><span style={styles.rowIdentity}><ArkmeUserAvatar {...(item.avatarRef === undefined ? {} : { avatarRef: item.avatarRef })} size={36} label={`${item.displayName}的头像`} /><span style={styles.rowCopy}><strong style={styles.rowTitle}>{item.displayName}</strong><small style={styles.rowMeta}>{item.identityKind === 'speaker' ? '录音中识别到的声音' : '已授权的用户'} · {item.playGranted ? '可播放' : '未授权播放'}</small></span></span><button type="button" style={styles.button} onClick={() => { props.onOpenPerson(item.personRef, item.identityKind) }}>查看识别详情</button></li>)}</ul>{props.people.message !== undefined && <div style={{ ...styles.error, marginTop: 12 }}>{props.people.message}</div>}{props.people.value.hasMore && props.onMorePeople !== undefined && <div style={styles.actions}><button type="button" style={styles.button} onClick={props.onMorePeople}>加载更多识别人</button></div>}</>}
      </section>

      <section className="arkme-voiceprint-outbound" style={styles.outboundSection} aria-label="谁能播放我的声音">
        <div style={styles.cardHead}><span><h2 style={styles.cardTitle}>谁能播放我的声音</h2><small style={styles.cardHint}>我主动授予的播放权限</small></span><span style={styles.headActions}>{props.grants.status === 'success' && <span style={styles.badge}>{props.grants.value.items.length} 人</span>}<button type="button" style={styles.button} onClick={() => { props.onRefreshGrants() }}>刷新授权</button></span></div>
        {props.grants.status === 'loading' ? <div style={styles.state} role="status">正在加载谁能播放我的声音…</div>
          : props.grants.status === 'error' ? <ResourceError message={props.grants.message} onRetry={props.onRefreshGrants} />
            : props.grants.value.items.length === 0 ? <div style={styles.state}>还没有人可以播放你的声音</div>
              : <><ul style={styles.list}>{props.grants.value.items.map(item => <li key={item.grantRef} style={styles.row}><span style={styles.rowIdentity}><ArkmeUserAvatar {...(item.avatarRef === undefined ? {} : { avatarRef: item.avatarRef })} size={36} label={`${item.displayName}的头像`} /><span style={styles.rowCopy}><strong style={styles.rowTitle}>{item.displayName}</strong><small style={styles.rowMeta}>{item.playEnabled ? '可以播放你的声纹' : '播放授权已关闭'}</small></span></span>{item.playEnabled && <button type="button" style={{ ...styles.button, ...styles.dangerButton }} disabled={props.revokingGrantRef === item.grantRef} onClick={() => { props.onRevoke(item.grantRef, item.displayName) }}>{props.revokingGrantRef === item.grantRef ? '正在撤销…' : '撤销播放授权'}</button>}</li>)}</ul>{props.grants.message !== undefined && <div style={{ ...styles.error, marginTop: 12 }}>{props.grants.message}</div>}{props.grants.value.hasMore && props.onMoreGrants !== undefined && <div style={styles.actions}><button type="button" style={styles.button} onClick={props.onMoreGrants}>加载更多授权</button></div>}</>}
      </section>
    </div>
  </div>
}

export function RecognizedPersonDialog({
  person, library, targetIdentifier, targetContact, invitation,
  onRetryPerson, onRetryLibrary, onTargetIdentifierChange, onSearchTarget, onInvite, onClose,
}: {
  person: ArkmeVoiceprintResource<ArkmeRecognizedPersonDetail>
  library?: ArkmeVoiceprintResource<ArkmeRecognizedVoiceprintLibrary>
  targetIdentifier: string
  targetContact?: ArkmeVoiceprintResource<ArkmeContactSearchResult>
  invitation: ArkmeVoiceprintInvitationState
  onRetryPerson(): void
  onRetryLibrary(): void
  onTargetIdentifierChange(value: string): void
  onSearchTarget(): void
  onInvite(): void
  onClose(): void
}) {
  return <div style={styles.overlay} role="presentation"><section style={styles.dialog} role="dialog" aria-modal="true" aria-label="识别详情">
    <div style={styles.cardHead}><h2 style={styles.cardTitle}>识别详情</h2><button type="button" style={styles.button} onClick={onClose}>关闭</button></div>
    {person.status === 'loading' ? <div style={styles.state}>正在加载识别详情…</div>
      : person.status === 'error' ? <ResourceError message={person.message} onRetry={onRetryPerson} />
        : <>
          <div style={styles.row}><span style={styles.rowIdentity}><ArkmeUserAvatar {...(person.value.avatarRef === undefined ? {} : { avatarRef: person.value.avatarRef })} size={40} label={`${person.value.displayName}的头像`} /><span style={styles.rowCopy}><strong>{person.value.displayName}</strong><small style={styles.rowMeta}>{person.value.identityKind === 'speaker' ? '录音中识别到的声音' : '已授权的用户'} · {person.value.playGranted ? '已授权播放' : '未授权播放'}</small></span></span></div>
          {person.value.identityKind === 'speaker' && library?.status === 'loading' && <div style={styles.state}>正在加载声纹记录…</div>}
          {person.value.identityKind === 'speaker' && library?.status === 'error' && <ResourceError message={library.message} onRetry={onRetryLibrary} />}
          {person.value.identityKind === 'speaker' && library?.status === 'success' && (library.value.items.length === 0
            ? <div style={styles.state}>暂无声纹记录</div>
            : <ul style={{ ...styles.list, marginTop: 12 }}>{library.value.items.map((item, index) => <li key={`${item.kind}:${String(item.createdAtMillis ?? 0)}:${String(item.hitCount)}:${String(index)}`} style={styles.row}><span style={styles.rowCopy}><strong>声纹记录 {index + 1}</strong><small style={styles.rowMeta}>{item.kind === 'authorized' ? '授权声纹' : item.kind === 'legacy' ? '历史声纹' : '本地识别声纹'} · 命中 {item.hitCount} 次</small></span></li>)}</ul>)}
          {person.value.canInvite && <section style={{ ...styles.card, marginTop: 16 }} aria-label="邀请识别人授权">
            <h3 style={styles.cardTitle}>邀请对方授权</h3><small style={styles.cardHint}>{person.value.inviteTargetSelectionRequired ? '先用手机号或 Arkme ID 精确找到本人，再生成这条声音专属的认领邀请。' : '为当前已绑定用户生成这条声音专属的播放邀请。'}</small>
            {person.value.inviteTargetSelectionRequired && <>
              <div style={styles.actions}><input aria-label="邀请对象手机号或 Arkme ID" value={targetIdentifier} onChange={event => { onTargetIdentifierChange(event.target.value) }} placeholder="手机号或 Arkme ID" style={{ ...styles.button, flex: 1, minWidth: 160, cursor: 'text' }} /><button type="button" style={styles.button} onClick={onSearchTarget}>查找用户</button></div>
              {targetContact?.status === 'loading' && <div style={styles.state}>正在查找邀请对象…</div>}
              {targetContact?.status === 'error' && <div style={styles.error}>{targetContact.message}</div>}
              {targetContact?.status === 'success' && <div style={{ ...styles.row, marginTop: 12 }}><span style={styles.rowIdentity}><ArkmeUserAvatar {...(targetContact.value.avatarRef === undefined ? {} : { avatarRef: targetContact.value.avatarRef })} size={36} label={`${targetContact.value.displayName}的头像`} /><span style={styles.rowCopy}><strong>{targetContact.value.displayName}</strong><small style={styles.rowMeta}>{targetContact.value.registered ? '已注册 Arkme 用户' : '该对象尚未注册'}</small></span></span></div>}
            </>}
            {invitation.status === 'error' && <div style={{ ...styles.error, marginTop: 12 }}>{invitation.message}</div>}
            {invitation.status === 'success' && <div style={{ ...styles.linkBox, marginTop: 12 }}>{invitation.value.inviteUrl}</div>}
            <div style={styles.actions}><button type="button" style={{ ...styles.button, ...styles.primary }} disabled={(person.value.inviteTargetSelectionRequired && (targetContact?.status !== 'success' || !targetContact.value.registered || targetContact.value.isSelf)) || invitation.status === 'busy'} onClick={onInvite}>{invitation.status === 'busy' ? '正在生成…' : '生成专属邀请'}</button>{invitation.status === 'success' && <button type="button" style={styles.button} onClick={() => { copyText(invitation.value.inviteUrl) }}>复制专属邀请</button>}</div>
          </section>}
        </>}
  </section></div>
}

export function ArkmeVoiceprintSurface({
  recorderFactory = () => new BrowserPcmVoiceprintRecorder(),
  enrollmentClient = arkmeVoiceprintEnrollmentClient,
}: {
  recorderFactory?: () => ArkmeVoiceprintRecorder
  enrollmentClient?: ArkmeVoiceprintEnrollmentClient
} = {}) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const [status, setStatus] = useState<ArkmeVoiceprintResource<ArkmeMyVoiceprint>>({ status: 'loading' })
  const [grants, setGrants] = useState<ArkmeVoiceprintResource<ArkmeVoiceprintGrantPage>>({ status: 'loading' })
  const [people, setPeople] = useState<ArkmeVoiceprintResource<ArkmeRecognizedPersonPage>>({ status: 'loading' })
  const [invitation, setInvitation] = useState<ArkmeVoiceprintInvitationState>({ status: 'idle' })
  const [person, setPerson] = useState<ArkmeVoiceprintResource<ArkmeRecognizedPersonDetail> | undefined>()
  const [library, setLibrary] = useState<ArkmeVoiceprintResource<ArkmeRecognizedVoiceprintLibrary> | undefined>()
  const [selectedPersonRef, setSelectedPersonRef] = useState('')
  const [selectedPersonKind, setSelectedPersonKind] = useState<ArkmeRecognizedPersonIdentityKind>()
  const [targetIdentifier, setTargetIdentifier] = useState('')
  const [targetContact, setTargetContact] = useState<ArkmeVoiceprintResource<ArkmeContactSearchResult> | undefined>()
  const [personInvitation, setPersonInvitation] = useState<ArkmeVoiceprintInvitationState>({ status: 'idle' })
  const [grantsMoreBusy, setGrantsMoreBusy] = useState(false)
  const [peopleMoreBusy, setPeopleMoreBusy] = useState(false)
  const [revokingGrantRef, setRevokingGrantRef] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [enrollmentOpen, setEnrollmentOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingStarting, setRecordingStarting] = useState(false)
  const [recorded, setRecorded] = useState<ArkmeVoiceprintRecording>()
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingBusy, setRecordingBusy] = useState(false)
  const [recordingError, setRecordingError] = useState('')
  const recorderRef = useRef<ArkmeVoiceprintRecorder>()
  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const startedAtRef = useRef(0)
  const enrollmentPollAttemptsRef = useRef(0)
  const statusRequestRevisionRef = useRef(0)
  const grantsRequestRevisionRef = useRef(0)
  const peopleRequestRevisionRef = useRef(0)
  const personRequestRevisionRef = useRef(0)
  const libraryRequestRevisionRef = useRef(0)
  const contactSearchRevisionRef = useRef(0)
  const accountAbortRef = useRef<AbortController>()
  if (accountAbortRef.current === undefined) accountAbortRef.current = new AbortController()

  const loadStatus = (background = false) => {
    const requestRevision = ++statusRequestRevisionRef.current
    if (!background) {
      enrollmentPollAttemptsRef.current = 0
      setStatus({ status: 'loading' })
    }
    const signal = accountAbortRef.current?.signal
    return callArkme<ArkmeMyVoiceprint>('voiceprint.status', undefined, signal).then(value => {
      if (signal?.aborted !== true && statusRequestRevisionRef.current === requestRevision) {
        setStatus({ status: 'success', value })
      }
    }).catch(error => {
      if (signal?.aborted === true || statusRequestRevisionRef.current !== requestRevision) return
      const failure = message(error, '我的声纹加载失败')
      if (background) setStatus(current => current.status === 'success' ? { ...current, message: failure } : current)
      else setStatus({ status: 'error', message: failure })
    })
  }
  const loadGrants = (cursor = '', append = false) => {
    const requestRevision = ++grantsRequestRevisionRef.current
    if (append) {
      setGrantsMoreBusy(true)
      setGrants(current => current.status === 'success' ? { status: 'success', value: current.value } : current)
    }
    else setGrants({ status: 'loading' })
    const signal = accountAbortRef.current?.signal
    return callArkme<ArkmeVoiceprintGrantPage>('voiceprint.grants', { cursor, limit: 100 }, signal).then(value => {
      if (signal?.aborted === true || grantsRequestRevisionRef.current !== requestRevision) return
      setGrants(current => append && current.status === 'success'
        ? { status: 'success', value: {
            ...value,
            items: [
              ...current.value.items,
              ...value.items.filter(item => !current.value.items.some(existing => existing.grantRef === item.grantRef)),
            ],
          } }
        : { status: 'success', value })
    }).catch(error => {
      if (signal?.aborted === true || grantsRequestRevisionRef.current !== requestRevision) return
      const failure = message(error, append ? '更多授权加载失败' : '播放授权加载失败')
      if (append) setGrants(current => current.status === 'success' ? { ...current, message: failure } : current)
      else setGrants({ status: 'error', message: failure })
    })
      .finally(() => {
        if (grantsRequestRevisionRef.current === requestRevision) setGrantsMoreBusy(false)
      })
  }
  const loadPeople = (cursor = '', append = false): Promise<void> => {
    const requestRevision = ++peopleRequestRevisionRef.current
    if (append) {
      setPeopleMoreBusy(true)
      setPeople(current => current.status === 'success' ? { status: 'success', value: current.value } : current)
    }
    else setPeople({ status: 'loading' })
    const signal = accountAbortRef.current?.signal
    return callArkme<ArkmeRecognizedPersonPage>('voiceprint.people', { cursor, limit: 50 }, signal).then(value => {
      if (signal?.aborted === true || peopleRequestRevisionRef.current !== requestRevision) return
      setPeople(current => append && current.status === 'success'
        ? { status: 'success', value: {
            ...value,
            items: [
              ...current.value.items,
              ...value.items.filter(item => !current.value.items.some(existing => existing.personRef === item.personRef)),
            ],
          } }
        : { status: 'success', value })
    }).catch(error => {
      if (signal?.aborted === true || peopleRequestRevisionRef.current !== requestRevision) return
      if (append && error instanceof ArkmeClientError && error.body.code === 'arkme-code-1105') {
        return loadPeople()
      }
      const failure = message(error, append ? '更多识别人加载失败' : '识别人加载失败')
      if (append) setPeople(current => current.status === 'success' ? { ...current, message: failure } : current)
      else setPeople({ status: 'error', message: failure })
    })
      .finally(() => {
        if (peopleRequestRevisionRef.current === requestRevision) setPeopleMoreBusy(false)
      })
  }

  const accountKey = auth.auth?.status === 'authenticated' ? `user:${String(auth.auth.userId)}` : auth.auth?.status ?? 'unknown'
  useEffect(() => {
    accountAbortRef.current?.abort()
    accountAbortRef.current = new AbortController()
    statusRequestRevisionRef.current += 1
    grantsRequestRevisionRef.current += 1
    peopleRequestRevisionRef.current += 1
    personRequestRevisionRef.current += 1
    libraryRequestRevisionRef.current += 1
    contactSearchRevisionRef.current += 1
    setInvitation({ status: 'idle' })
    setPerson(undefined)
    setLibrary(undefined)
    setSelectedPersonRef('')
    setSelectedPersonKind(undefined)
    setTargetContact(undefined)
    setRevokingGrantRef('')
    setRestoreBusy(false)
    if (timerRef.current !== undefined) clearInterval(timerRef.current)
    timerRef.current = undefined
    const recorder = recorderRef.current
    recorderRef.current = undefined
    if (recorder !== undefined) void recorder.cancel()
    setEnrollmentOpen(false)
    setRecording(false)
    setRecordingStarting(false)
    setRecordingBusy(false)
    setRecordingError('')
    setRecordingSeconds(0)
    setRecorded(undefined)
    loadStatus()
    loadGrants()
    loadPeople()
    return () => { accountAbortRef.current?.abort() }
  }, [accountKey])
  useEffect(() => {
    if (status.status !== 'success' || !status.value.enrollmentPending) {
      if (status.status === 'success') enrollmentPollAttemptsRef.current = 0
      return
    }
    if (enrollmentPollAttemptsRef.current >= 10) return
    const timer = setTimeout(() => {
      enrollmentPollAttemptsRef.current += 1
      loadStatus(true)
    }, 3_000)
    return () => { clearTimeout(timer) }
  }, [status])
  useEffect(() => () => {
    if (timerRef.current !== undefined) clearInterval(timerRef.current)
    void recorderRef.current?.cancel()
  }, [])

  const stopRecording = async () => {
    const recorder = recorderRef.current
    if (recorder === undefined) return
    recorderRef.current = undefined
    setRecording(false)
    if (timerRef.current !== undefined) clearInterval(timerRef.current)
    timerRef.current = undefined
    try {
      const value = await recorder.stop()
      setRecordingSeconds(Math.round(value.durationMs / 100) / 10)
      if (value.durationMs < ARKME_VOICEPRINT_ENROLLMENT_MIN_DURATION_MS) {
        setRecorded(undefined)
        setRecordingError('录音不足 3 秒，请重新录制')
      } else setRecorded(value)
    } catch (error) {
      setRecordingError(message(error, '停止录音失败'))
    }
  }

  const startRecording = async () => {
    if (recorderRef.current !== undefined) return
    setRecordingError('')
    setRecorded(undefined)
    setRecordingStarting(true)
    const recorder = recorderFactory()
    recorderRef.current = recorder
    let active = false
    try {
      await recorder.start()
      if (recorderRef.current !== recorder) {
        await recorder.cancel()
        return
      }
      active = true
      startedAtRef.current = Date.now()
      setRecording(true)
      setRecordingSeconds(0)
      timerRef.current = setInterval(() => {
        const seconds = Math.min(60, Math.round((Date.now() - startedAtRef.current) / 100) / 10)
        setRecordingSeconds(seconds)
        if (seconds >= 59.5) void stopRecording()
      }, 100)
    } catch (error) {
      await recorder.cancel().catch(() => undefined)
      if (recorderRef.current === recorder) setRecordingError(message(error, '无法使用麦克风'))
    } finally {
      if (recorderRef.current === recorder) {
        if (!active) recorderRef.current = undefined
        setRecordingStarting(false)
      }
    }
  }

  const submitRecording = async () => {
    if (recorded === undefined || recordingBusy) return
    setRecordingBusy(true)
    setRecordingError('')
    const signal = accountAbortRef.current?.signal
    try {
      const path = auth.config?.voiceprintEnrollmentPath ?? '/arkme-self/api/voiceprint/enroll'
      await enrollmentClient.enroll(path, recorded, signal)
      if (!requestActive(signal)) return
      setEnrollmentOpen(false)
      setRecorded(undefined)
      void loadStatus()
    } catch (error) {
      if (!requestActive(signal)) return
      const failure = message(error, '声纹录入失败')
      try {
        const current = await callArkme<ArkmeMyVoiceprint>('voiceprint.status', undefined, signal)
        if (!requestActive(signal)) return
        setStatus({
          status: 'success',
          value: current,
          message: '录入结果未确认，已刷新最新声纹状态',
        })
        if (current.enrollmentPending) {
          setEnrollmentOpen(false)
          setRecorded(undefined)
        } else setRecordingError(failure)
      } catch {
        if (requestActive(signal)) setRecordingError(failure)
      }
    } finally {
      if (requestActive(signal)) setRecordingBusy(false)
    }
  }

  const loadPersonDetail = (personRef: string) => {
    const requestRevision = ++personRequestRevisionRef.current
    setPerson({ status: 'loading' })
    const signal = accountAbortRef.current?.signal
    return callArkme<ArkmeRecognizedPersonDetail>('voiceprint.person', { personRef }, signal)
      .then(value => { if (signal?.aborted !== true && personRequestRevisionRef.current === requestRevision) setPerson({ status: 'success', value }) })
      .catch(error => {
        if (signal?.aborted === true || personRequestRevisionRef.current !== requestRevision) return
        if (error instanceof ArkmeClientError && error.body.code === 'voiceprint-person-unavailable') void loadPeople()
        setPerson({ status: 'error', message: message(error, '识别详情加载失败') })
      })
  }

  const loadPersonLibrary = (personRef: string) => {
    const requestRevision = ++libraryRequestRevisionRef.current
    setLibrary({ status: 'loading' })
    const signal = accountAbortRef.current?.signal
    return callArkme<ArkmeRecognizedVoiceprintLibrary>('voiceprint.person.voiceprints', { personRef }, signal)
      .then(value => { if (signal?.aborted !== true && libraryRequestRevisionRef.current === requestRevision) setLibrary({ status: 'success', value }) })
      .catch(error => { if (signal?.aborted !== true && libraryRequestRevisionRef.current === requestRevision) setLibrary({ status: 'error', message: message(error, '声纹记录加载失败') }) })
  }

  const openPerson = (personRef: string, identityKind: ArkmeRecognizedPersonIdentityKind) => {
    contactSearchRevisionRef.current += 1
    setSelectedPersonRef(personRef)
    setSelectedPersonKind(identityKind)
    setTargetIdentifier('')
    setTargetContact(undefined)
    setPersonInvitation({ status: 'idle' })
    void loadPersonDetail(personRef)
    if (identityKind === 'speaker') void loadPersonLibrary(personRef)
    else {
      libraryRequestRevisionRef.current += 1
      setLibrary(undefined)
    }
  }

  return <main style={styles.root} data-arkme-owned="voiceprint-surface" aria-label="声纹管理">
    <div style={styles.inner}>
      <header style={styles.header}><p style={styles.eyebrow}>账户与声音</p><h1 style={styles.title}>声纹管理</h1><p style={styles.subtitle}>管理你的声纹、对外授权和录音中已识别的人。授权变更均需由你明确操作。</p></header>
      <ArkmeVoiceprintContent
        status={status} grants={grants} people={people} invitation={invitation}
        revokingGrantRef={revokingGrantRef} restoreBusy={restoreBusy}
        onRefreshStatus={loadStatus} onRefreshGrants={loadGrants} onRefreshPeople={loadPeople}
        {...(grants.status === 'success' && grants.value.hasMore && !grantsMoreBusy
          ? { onMoreGrants: () => { loadGrants(grants.value.nextCursor, true) } }
          : {})}
        {...(people.status === 'success' && people.value.hasMore && !peopleMoreBusy
          ? { onMorePeople: () => { loadPeople(people.value.nextCursor, true) } }
          : {})}
        onStartEnrollment={() => { setEnrollmentOpen(true); setRecordingError(''); setRecorded(undefined) }}
        onOpenPerson={openPerson}
        onInvite={() => {
          setInvitation({ status: 'busy' })
          const signal = accountAbortRef.current?.signal
          void callArkme<ArkmeVoiceprintInvitation>('voiceprint.invite', undefined, signal)
            .then(value => { if (signal?.aborted !== true) setInvitation({ status: 'success', value }) })
            .catch(error => { if (signal?.aborted !== true) setInvitation({ status: 'error', message: message(error, '邀请链接生成失败') }) })
        }}
        onRevoke={(grantRef, displayName) => {
          if (revokingGrantRef !== '') return
          if (typeof window !== 'undefined' && !window.confirm(`确定撤销“${displayName}”的声纹播放授权吗？撤销后对方将不能再播放你的声纹。`)) return
          setRevokingGrantRef(grantRef)
          const signal = accountAbortRef.current?.signal
          void callArkme('voiceprint.revoke', { grantRef }, signal).then(async () => {
            if (signal?.aborted !== true) await loadGrants()
          }).catch(async () => {
            if (signal?.aborted === true) return
            await loadGrants()
            if (requestActive(signal)) {
              setGrants(current => current.status === 'success'
                ? { ...current, message: '撤销结果未确认，已刷新授权列表' }
                : current)
            }
          })
            .finally(() => { if (signal?.aborted !== true) setRevokingGrantRef('') })
        }}
        onRestore={() => {
          if (restoreBusy) return
          if (typeof window !== 'undefined' && !window.confirm('确定恢复你的声纹播放能力吗？')) return
          setRestoreBusy(true)
          const signal = accountAbortRef.current?.signal
          void callArkme('voiceprint.restore', undefined, signal).then(async () => {
            if (signal?.aborted !== true) await loadStatus()
          }).catch(async error => {
            if (signal?.aborted === true) return
            const failure = message(error, '恢复声纹播放失败')
            try {
              const current = await callArkme<ArkmeMyVoiceprint>('voiceprint.status', undefined, signal)
              if (requestActive(signal)) {
                setStatus({ status: 'success', value: current, message: '恢复结果未确认，已刷新最新声纹状态' })
              }
            } catch {
              if (requestActive(signal)) {
                setStatus(current => current.status === 'success'
                  ? { ...current, message: failure }
                  : { status: 'error', message: failure })
              }
            }
          })
            .finally(() => { if (signal?.aborted !== true) setRestoreBusy(false) })
        }}
      />
    </div>

    {person !== undefined && <RecognizedPersonDialog
      person={person}
      {...(library === undefined ? {} : { library })}
      targetIdentifier={targetIdentifier}
      {...(targetContact === undefined ? {} : { targetContact })}
      invitation={personInvitation}
      onRetryPerson={() => { if (selectedPersonRef !== '') void loadPersonDetail(selectedPersonRef) }}
      onRetryLibrary={() => {
        if (selectedPersonRef !== '' && selectedPersonKind === 'speaker') void loadPersonLibrary(selectedPersonRef)
      }}
      onTargetIdentifierChange={value => { contactSearchRevisionRef.current += 1; setTargetIdentifier(value); setTargetContact(undefined); setPersonInvitation({ status: 'idle' }) }}
      onSearchTarget={() => {
        const identifier = targetIdentifier.trim()
        if (identifier === '') { setTargetContact({ status: 'error', message: '请输入手机号或 Arkme ID' }); return }
        const requestRevision = ++contactSearchRevisionRef.current
        setTargetContact({ status: 'loading' })
        setPersonInvitation({ status: 'idle' })
        const signal = accountAbortRef.current?.signal
        void callArkme<ArkmeContactSearchResult>('contacts.search', { identifier }, signal)
          .then(value => { if (signal?.aborted !== true && contactSearchRevisionRef.current === requestRevision) setTargetContact({ status: 'success', value }) })
          .catch(error => { if (signal?.aborted !== true && contactSearchRevisionRef.current === requestRevision) setTargetContact({ status: 'error', message: message(error, '邀请对象查找失败') }) })
      }}
      onInvite={() => {
        if (person.status !== 'success') return
        if (person.value.inviteTargetSelectionRequired
          && (targetContact?.status !== 'success' || !targetContact.value.registered || targetContact.value.isSelf)) return
        setPersonInvitation({ status: 'busy' })
        const requestRevision = personRequestRevisionRef.current
        const targetRevision = contactSearchRevisionRef.current
        const signal = accountAbortRef.current?.signal
        void callArkme<ArkmeVoiceprintInvitation>('voiceprint.person.invite', {
          personRef: selectedPersonRef,
          ...(person.value.inviteTargetSelectionRequired && targetContact?.status === 'success'
            ? { targetContactRef: targetContact.value.contactRef }
            : {}),
        }, signal).then(value => {
          if (signal?.aborted !== true && personRequestRevisionRef.current === requestRevision
            && contactSearchRevisionRef.current === targetRevision) setPersonInvitation({ status: 'success', value })
        }).catch(error => {
          if (signal?.aborted !== true && personRequestRevisionRef.current === requestRevision
            && contactSearchRevisionRef.current === targetRevision) {
            setPersonInvitation({ status: 'error', message: message(error, '专属邀请生成失败') })
          }
        })
      }}
      onClose={() => { personRequestRevisionRef.current += 1; libraryRequestRevisionRef.current += 1; contactSearchRevisionRef.current += 1; setPerson(undefined); setLibrary(undefined); setSelectedPersonRef(''); setSelectedPersonKind(undefined); setTargetContact(undefined) }}
    />}

    {enrollmentOpen && <div style={styles.overlay} role="presentation"><section style={styles.dialog} role="dialog" aria-modal="true" aria-label="录入我的声纹"><div style={styles.cardHead}><span><h2 style={styles.cardTitle}>录入我的声纹</h2><small style={styles.cardHint}>请在安静环境中，用自然语速连续说话 3 至 60 秒。</small></span><button type="button" style={styles.button} disabled={recordingBusy} onClick={() => { if (timerRef.current !== undefined) clearInterval(timerRef.current); timerRef.current = undefined; const recorder = recorderRef.current; recorderRef.current = undefined; if (recorder !== undefined) void recorder.cancel(); setEnrollmentOpen(false); setRecording(false); setRecordingStarting(false); setRecorded(undefined) }}>关闭</button></div><div style={{ ...styles.linkBox, marginBottom: 12 }}>Arkme 是你的 AI 个人全息记忆中枢，可以记录生活灵感、日程安排和重要瞬间。它会帮你整理日常想法、回顾关键记忆，并在需要时陪你重新看见自己的生活脉络。</div><div style={styles.recorder}><strong>{recordingStarting ? '正在打开麦克风…' : recording ? `正在录音 ${recordingSeconds.toFixed(1)} 秒` : recorded === undefined ? '麦克风尚未开始' : `录音已就绪 · ${recordingSeconds.toFixed(1)} 秒`}</strong><small>{recording ? '说完后点击停止录音' : recorded === undefined ? '浏览器会在开始时请求麦克风权限' : '可先试听，确认无误后提交录入'}</small></div>{recorded !== undefined && <VoiceprintWavPreview recording={recorded} />}{recordingError !== '' && <div style={{ ...styles.error, marginTop: 12 }}>{recordingError}</div>}<div style={styles.actions}>{recording ? <button type="button" style={{ ...styles.button, ...styles.dangerButton }} onClick={() => { void stopRecording() }}>停止录音</button> : <button type="button" style={styles.button} disabled={recordingBusy || recordingStarting} onClick={() => { void startRecording() }}>{recordingStarting ? '正在打开麦克风…' : recorded === undefined ? '开始录音' : '重新录音'}</button>}{recorded !== undefined && <button type="button" style={{ ...styles.button, ...styles.primary }} disabled={recordingBusy || recordingStarting} onClick={() => { void submitRecording() }}>{recordingBusy ? '正在提交…' : '提交声纹录入'}</button>}</div></section></div>}
  </main>
}
