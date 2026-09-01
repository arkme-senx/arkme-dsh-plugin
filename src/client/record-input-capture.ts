import type { ArkmeRecordCaptureContext, ArkmeSourceItem } from '../types.js'

const BACKGROUND_SOUND_ENABLED_PREFIX = 'arkme.record-capture.background-sound.enabled.'
const MICROPHONE_EXPLICIT_GRANT_KEY = 'arkme.record-capture.microphone.explicit-grant'
const MAX_VISIBLE_AMPLITUDES = 40
const DEFAULT_START_DELAY_MILLIS = 0
const DEFAULT_OPERATION_TIMEOUT_MILLIS = 5_000
const DEFAULT_CONTEXT_TIMEOUT_MILLIS = 900
export const DEFAULT_BACKGROUND_SOUND_MAX_CAPTURE_DURATION_MILLIS = 5 * 60_000
export const DEFAULT_BACKGROUND_SOUND_MAX_ENCODED_BYTES = 16 * 1024 * 1024
export const DEFAULT_BACKGROUND_SOUND_MAX_RETAINED_DRAFTS = 4
const DEFAULT_MEDIA_RECORDER_TIMESLICE_MILLIS = 1_000

export type ArkmeMicrophonePermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable'
export type ArkmeBackgroundSoundFailure =
  | 'permission-denied'
  | 'unavailable'
  | 'start-failed'
  | 'stop-failed'
  | 'retention-evicted'
  | 'limit-reached'

export type ArkmeBackgroundSoundCaptureState =
  | 'disabled'
  | 'captured'
  | 'not-captured'
  | 'denied'
  | 'unavailable'
  | 'failed'

export interface ArkmeBackgroundSoundRecorderSegment {
  blob: Blob
  fileName: string
  mimeType: string
  durationMillis: number
}

export interface ArkmeBackgroundSoundRecorderStartOptions {
  maxCaptureDurationMillis?: number
  maxEncodedBytes?: number
}

export interface ArkmeBackgroundSoundCaptureSegment extends ArkmeBackgroundSoundRecorderSegment {
  amplitudes: readonly number[]
}

export interface ArkmeBackgroundSoundRecorder {
  start(options?: ArkmeBackgroundSoundRecorderStartOptions): Promise<void>
  stop(): Promise<ArkmeBackgroundSoundRecorderSegment | undefined>
  cancel(): Promise<void>
  dispose(): Promise<void>
  subscribeAmplitude(listener: (amplitude: number) => void): () => void
  subscribeFailure?(listener: (failure: ArkmeBackgroundSoundFailure) => void): () => void
}

export interface ArkmeRecordInputWaveformSnapshot {
  visible: boolean
  recording: boolean
  amplitudes: readonly number[]
  failure?: ArkmeBackgroundSoundFailure
}

export interface ArkmeRecordInputCaptureResult {
  schemaVersion: 1
  captureId: string
  startedAtMillis?: number
  completedAtMillis: number
  recordDurationMillis: number
  captureContext: ArkmeRecordCaptureContext
  backgroundSound: {
    enabled: boolean
    state: ArkmeBackgroundSoundCaptureState
    failure?: ArkmeBackgroundSoundFailure
    segments: readonly ArkmeBackgroundSoundCaptureSegment[]
    amplitudes: readonly number[]
  }
}

export interface ArkmeRecordInputState {
  draftKey: string | undefined
  isActive: boolean
  hasUserContent: boolean
}

export interface ArkmeBackgroundSoundPreferenceScope {
  readonly localStorage?: Pick<Storage, 'getItem' | 'setItem'>
}

type CaptureTimer = ReturnType<typeof globalThis.setTimeout>

export interface ArkmeRecordInputCaptureOwnerOptions {
  accountId: number | string
  recorder?: ArkmeBackgroundSoundRecorder
  now?: () => number
  createCaptureId?: () => string
  captureContext?: () => Promise<ArkmeRecordCaptureContext>
  backgroundSoundEnabled?: () => boolean
  microphoneReady?: () => boolean
  requestMicrophonePermission?: () => Promise<'granted'>
  subscribeBackgroundSoundPreference?: (listener: () => void) => () => void
  onBackgroundSoundFailure?: (failure: ArkmeBackgroundSoundFailure) => void
  startDelayMillis?: number
  operationTimeoutMillis?: number
  maxCaptureDurationMillis?: number
  maxEncodedBytes?: number
  maxRetainedDrafts?: number
  setTimer?: (callback: () => void, delayMillis: number) => CaptureTimer
  clearTimer?: (timer: CaptureTimer) => void
}

interface DraftCaptureState {
  readonly draftKey: string
  isActive: boolean
  hasUserContent: boolean
  wasRecordable: boolean
  startedAtMillis: number | undefined
  failure: ArkmeBackgroundSoundFailure | undefined
  failureLatched: boolean
  generation: number
  starting: boolean
  startPromise: Promise<void> | undefined
  startTimer: CaptureTimer | undefined
  captureLimitTimer: CaptureTimer | undefined
  limitReached: boolean
  readonly segments: ArkmeBackgroundSoundCaptureSegment[]
  readonly currentAmplitudes: number[]
  microphonePermissionAttempted: boolean
}

export interface ArkmeNavigatorCaptureSource {
  readonly userAgent?: string
  readonly onLine?: boolean
  readonly userAgentData?: { readonly brands?: ReadonlyArray<{ readonly brand?: unknown }> }
  readonly connection?: { readonly type?: unknown; readonly effectiveType?: unknown }
  readonly getBattery?: () => Promise<{
    readonly level?: number
    readonly charging?: boolean
  }>
  readonly mediaDevices?: Pick<MediaDevices, 'getUserMedia'>
  readonly permissions?: Pick<Permissions, 'query'>
}

export interface ArkmeMicrophoneGrantScope {
  readonly sessionStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

const EMPTY_WAVEFORM_SNAPSHOT: ArkmeRecordInputWaveformSnapshot = Object.freeze({
  visible: false,
  recording: false,
  amplitudes: Object.freeze([]) as readonly number[],
})

const preferenceListeners = new Map<string, Set<() => void>>()
const preferenceOverrides = new Map<string, boolean>()
let fallbackCaptureSequence = 0
let lastMicrophonePermission: ArkmeMicrophonePermissionState = 'prompt'

export interface ArkmeBackgroundSoundServerPreferenceToken {
  readonly accountKey: string
  readonly revision: number
  readonly kind: 'read' | 'mutation'
  readonly operationId: number
  readonly blockedAtStart: boolean
}

interface ArkmeBackgroundSoundServerPreferenceAccountState {
  revision: number
  readonly activeMutations: Set<number>
  readonly listeners: Set<() => void>
}

/**
 * Shared browser owner for server preference reads and mutations.
 *
 * Reads started before or during any mutation can never project their stale
 * value into localStorage. Settings and every other UI entry point must use
 * this same singleton rather than keeping component-local request revisions.
 */
export class ArkmeBackgroundSoundServerPreferenceRuntime {
  private readonly accounts = new Map<string, ArkmeBackgroundSoundServerPreferenceAccountState>()
  private nextOperationId = 0

  beginRead(accountId: number | string): ArkmeBackgroundSoundServerPreferenceToken {
    const accountKey = String(accountId)
    const state = this.account(accountKey)
    this.nextOperationId += 1
    return Object.freeze({
      accountKey,
      revision: state.revision,
      kind: 'read' as const,
      operationId: this.nextOperationId,
      blockedAtStart: state.activeMutations.size > 0,
    })
  }

  beginMutation(accountId: number | string): ArkmeBackgroundSoundServerPreferenceToken {
    const accountKey = String(accountId)
    const state = this.account(accountKey)
    state.revision += 1
    this.nextOperationId += 1
    state.activeMutations.add(this.nextOperationId)
    return Object.freeze({
      accountKey,
      revision: state.revision,
      kind: 'mutation' as const,
      operationId: this.nextOperationId,
      blockedAtStart: false,
    })
  }

  current(token: ArkmeBackgroundSoundServerPreferenceToken): boolean {
    const state = this.accounts.get(token.accountKey)
    if (state === undefined || state.revision !== token.revision) return false
    if (token.kind === 'mutation') return state.activeMutations.has(token.operationId)
    return !token.blockedAtStart && state.activeMutations.size === 0
  }

  finish(token: ArkmeBackgroundSoundServerPreferenceToken): void {
    if (token.kind !== 'mutation') return
    const state = this.accounts.get(token.accountKey)
    if (state === undefined || !state.activeMutations.delete(token.operationId) || state.activeMutations.size > 0) return
    for (const listener of state.listeners) {
      try { listener() } catch { /* one surface must not block another refresh */ }
    }
  }

  subscribe(accountId: number | string, listener: () => void): () => void {
    const state = this.account(String(accountId))
    state.listeners.add(listener)
    return () => { state.listeners.delete(listener) }
  }

  private account(accountKey: string): ArkmeBackgroundSoundServerPreferenceAccountState {
    const current = this.accounts.get(accountKey)
    if (current !== undefined) return current
    const created = { revision: 0, activeMutations: new Set<number>(), listeners: new Set<() => void>() }
    this.accounts.set(accountKey, created)
    return created
  }
}

export const arkmeBackgroundSoundServerPreferenceRuntime = new ArkmeBackgroundSoundServerPreferenceRuntime()

function accountStorageKey(accountId: number | string | undefined): string | undefined {
  if (accountId === undefined || String(accountId).trim() === '') return undefined
  return `${BACKGROUND_SOUND_ENABLED_PREFIX}${String(accountId)}`
}

function browserPreferenceScope(): ArkmeBackgroundSoundPreferenceScope {
  if (typeof window === 'undefined') return {}
  try { return { localStorage: window.localStorage } } catch { return {} }
}

export function arkmeBackgroundSoundCaptureEnabled(
  accountId: number | string | undefined,
  scope: ArkmeBackgroundSoundPreferenceScope = browserPreferenceScope(),
): boolean {
  const key = accountStorageKey(accountId)
  if (key === undefined) return false
  const override = preferenceOverrides.get(key)
  if (override !== undefined) return override
  if (scope.localStorage === undefined) return false
  try { return scope.localStorage.getItem(key) === 'enabled' } catch { return false }
}

export function setArkmeBackgroundSoundCaptureEnabled(
  accountId: number | string | undefined,
  enabled: boolean,
  scope: ArkmeBackgroundSoundPreferenceScope = browserPreferenceScope(),
): void {
  const key = accountStorageKey(accountId)
  if (key === undefined) return
  let stored = false
  try {
    if (scope.localStorage !== undefined) {
      scope.localStorage.setItem(key, enabled ? 'enabled' : 'disabled')
      stored = true
    }
  } catch { /* optional local preference */ }
  // Keep an override only when storage cannot carry the current projection.
  // Successful writes must fall back to live storage so changes made while no
  // subscriber exists cannot be masked by stale process memory.
  if (stored) preferenceOverrides.delete(key)
  else preferenceOverrides.set(key, enabled)
  for (const listener of preferenceListeners.get(key) ?? []) listener()
}

export function subscribeArkmeBackgroundSoundCapturePreference(
  accountId: number | string | undefined,
  listener: () => void,
): () => void {
  const key = accountStorageKey(accountId)
  if (key === undefined) return () => undefined
  const listeners = preferenceListeners.get(key) ?? new Set<() => void>()
  listeners.add(listener)
  preferenceListeners.set(key, listeners)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key) return
    preferenceOverrides.delete(key)
    listener()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
    listeners.delete(listener)
    if (listeners.size === 0) preferenceListeners.delete(key)
  }
}

function browserNavigator(): ArkmeNavigatorCaptureSource | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator as ArkmeNavigatorCaptureSource
}

function browserMicrophoneGrantScope(): ArkmeMicrophoneGrantScope {
  if (typeof window === 'undefined') return {}
  try { return { sessionStorage: window.sessionStorage } } catch { return {} }
}

function storedExplicitMicrophoneGrant(scope: ArkmeMicrophoneGrantScope): boolean {
  try { return scope.sessionStorage?.getItem(MICROPHONE_EXPLICIT_GRANT_KEY) === 'granted' } catch { return false }
}

function setStoredExplicitMicrophoneGrant(scope: ArkmeMicrophoneGrantScope, granted: boolean): void {
  try {
    if (granted) scope.sessionStorage?.setItem(MICROPHONE_EXPLICIT_GRANT_KEY, 'granted')
    else scope.sessionStorage?.removeItem(MICROPHONE_EXPLICIT_GRANT_KEY)
  } catch { /* session-only safety marker is optional */ }
}

function microphoneError(error: unknown): Error {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return new Error('你未允许浏览器使用麦克风')
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return new Error('未找到可用的麦克风')
  return new Error('麦克风授权失败，请稍后重试')
}

function microphonePermissionAfterError(error: unknown): ArkmeMicrophonePermissionState {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'unavailable'
  return 'prompt'
}

export function arkmeMicrophoneCaptureReady(
  scope: ArkmeMicrophoneGrantScope = browserMicrophoneGrantScope(),
): boolean {
  return lastMicrophonePermission === 'granted'
    || lastMicrophonePermission === 'prompt' && storedExplicitMicrophoneGrant(scope)
}

export async function arkmeMicrophonePermissionState(
  source: ArkmeNavigatorCaptureSource | undefined = browserNavigator(),
  grantScope: ArkmeMicrophoneGrantScope = browserMicrophoneGrantScope(),
): Promise<ArkmeMicrophonePermissionState> {
  if (source?.mediaDevices?.getUserMedia === undefined) {
    lastMicrophonePermission = 'unavailable'
    setStoredExplicitMicrophoneGrant(grantScope, false)
    return lastMicrophonePermission
  }
  if (source.permissions?.query === undefined) {
    return arkmeMicrophoneCaptureReady(grantScope) ? 'granted' : 'prompt'
  }
  try {
    const result = await source.permissions.query({ name: 'microphone' as PermissionName })
    lastMicrophonePermission = result.state
    setStoredExplicitMicrophoneGrant(grantScope, result.state === 'granted')
    return lastMicrophonePermission
  } catch {
    return arkmeMicrophoneCaptureReady(grantScope) ? 'granted' : 'prompt'
  }
}

/** Input-gesture permission owner. Settings only persist whether capture is enabled. */
export async function requestArkmeBackgroundSoundPermission(
  source: ArkmeNavigatorCaptureSource | undefined = browserNavigator(),
  grantScope: ArkmeMicrophoneGrantScope = browserMicrophoneGrantScope(),
): Promise<'granted'> {
  if (arkmeMicrophoneCaptureReady(grantScope)) {
    setStoredExplicitMicrophoneGrant(grantScope, true)
    return 'granted'
  }
  if (lastMicrophonePermission === 'denied') throw new Error('你未允许浏览器使用麦克风')
  if (lastMicrophonePermission === 'unavailable') throw new Error('当前浏览器不支持麦克风录音')
  if (source?.mediaDevices?.getUserMedia === undefined) {
    lastMicrophonePermission = 'unavailable'
    setStoredExplicitMicrophoneGrant(grantScope, false)
    throw new Error('当前浏览器不支持麦克风录音')
  }
  let stream: MediaStream
  try {
    stream = await source.mediaDevices.getUserMedia({ audio: true, video: false })
  } catch (error) {
    lastMicrophonePermission = microphonePermissionAfterError(error)
    if (lastMicrophonePermission !== 'prompt') setStoredExplicitMicrophoneGrant(grantScope, false)
    throw microphoneError(error)
  }
  for (const track of stream.getTracks()) {
    try { track.stop() } catch { /* best-effort permission probe cleanup */ }
  }
  lastMicrophonePermission = 'granted'
  setStoredExplicitMicrophoneGrant(grantScope, true)
  return 'granted'
}

export async function setArkmeBackgroundSoundFromSettings(
  accountId: number | string | undefined,
  enabled: boolean,
  persist?: (enabled: boolean) => Promise<void>,
  scope: ArkmeBackgroundSoundPreferenceScope = browserPreferenceScope(),
  current: () => boolean = () => true,
): Promise<void> {
  const previous = arkmeBackgroundSoundCaptureEnabled(accountId, scope)
  if (!current()) throw new Error('背景音设置已被更新的操作取代')
  setArkmeBackgroundSoundCaptureEnabled(accountId, enabled, scope)
  try {
    await persist?.(enabled)
  } catch (error) {
    if (current()) setArkmeBackgroundSoundCaptureEnabled(accountId, previous, scope)
    throw error
  }
}

export interface ArkmeBackgroundSoundOwnerSnapshot {
  userId: number | string
  enabled: boolean
  found: boolean
  /** A server eligibility denial always overrides any stale local projection. */
  eligible?: boolean
}

export function applyArkmeBackgroundSoundOwnerSnapshot(
  accountId: number | string | undefined,
  snapshot: ArkmeBackgroundSoundOwnerSnapshot,
  scope: ArkmeBackgroundSoundPreferenceScope = browserPreferenceScope(),
  expectedUserId: number | string | undefined = accountId,
): boolean {
  if (accountId === undefined || expectedUserId === undefined
    || String(snapshot.userId) !== String(expectedUserId)) return false
  setArkmeBackgroundSoundCaptureEnabled(
    accountId,
    snapshot.found && snapshot.eligible !== false && snapshot.enabled,
    scope,
  )
  return true
}

export function arkmeRecordInputBrowserName(source: ArkmeNavigatorCaptureSource | undefined = browserNavigator()): string {
  const brands = source?.userAgentData?.brands ?? []
  const brandText = brands.map(item => typeof item.brand === 'string' ? item.brand : '').join(' ')
  const userAgent = source?.userAgent ?? ''
  const fingerprint = `${brandText} ${userAgent}`
  if (/Microsoft Edge|Edg\//iu.test(fingerprint)) return 'Microsoft Edge'
  if (/Opera|OPR\//iu.test(fingerprint)) return 'Opera'
  if (/Firefox|FxiOS\//iu.test(fingerprint)) return 'Firefox'
  if (/Safari/iu.test(userAgent) && !/Chrome|Chromium|CriOS|Edg\//iu.test(userAgent)) return 'Safari'
  if (/Google Chrome|Chrome|Chromium|CriOS/iu.test(fingerprint)) return 'Google Chrome'
  return '浏览器'
}

export function arkmeRecordInputNetworkName(source: ArkmeNavigatorCaptureSource | undefined = browserNavigator()): string {
  const rawType = typeof source?.connection?.type === 'string'
    ? source.connection.type.trim().toLowerCase()
    : ''
  const effectiveType = typeof source?.connection?.effectiveType === 'string'
    ? source.connection.effectiveType.trim().toLowerCase()
    : ''
  if (rawType === 'wifi') return 'Wi‑Fi'
  if (rawType === 'ethernet') return '有线网络'
  if (rawType === 'cellular' || /^(?:(?:slow-)?2g|3g|4g|5g)$/u.test(effectiveType)) return '移动网络'
  if (rawType === 'vpn') return 'VPN'
  if (rawType === 'bluetooth') return '蓝牙网络'
  if (rawType === 'none' || source?.onLine === false) return '离线'
  return source?.onLine === true ? '网络已连接' : ''
}

export function arkmeSourceSupportsRecordInputCapture(kind: ArkmeSourceItem['kind'] | undefined): boolean {
  return kind === 'private_chat' || kind === 'group_chat' || kind === 'send_to_self'
    || kind === 'default_category' || kind === 'topic'
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMillis: number,
  fallback: T,
): Promise<T> {
  let timer: CaptureTimer | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>(resolve => {
        timer = globalThis.setTimeout(() => { resolve(fallback) }, timeoutMillis)
      }),
    ])
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer)
  }
}

export async function captureArkmeRecordInputContext(
  source: ArkmeNavigatorCaptureSource | undefined = browserNavigator(),
  timeoutMillis = DEFAULT_CONTEXT_TIMEOUT_MILLIS,
): Promise<ArkmeRecordCaptureContext> {
  const networkName = arkmeRecordInputNetworkName(source)
  const base: ArkmeRecordCaptureContext = {
    clientName: `${arkmeRecordInputBrowserName(source)}（DeepSeek Harness）`,
    ...(networkName === '' ? {} : { networkName }),
  }
  if (source?.getBattery === undefined) return base
  const battery = await withTimeout(source.getBattery().catch(() => undefined), timeoutMillis, undefined)
  const level = typeof battery?.level === 'number' && Number.isFinite(battery.level)
    ? Math.round(Math.max(0, Math.min(1, battery.level)) * 100)
    : undefined
  return {
    ...base,
    ...(level === undefined ? {} : { electric: level }),
    ...(level === undefined ? {} : { charge: battery?.charging === true ? 1 : 2 }),
  }
}

export interface BrowserBackgroundSoundRecorderOptions {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createMediaRecorder?: (stream: MediaStream, options?: MediaRecorderOptions) => MediaRecorder
  createAudioContext?: () => AudioContext
  now?: () => number
  mediaRecorderTimesliceMillis?: number
  maxCaptureDurationMillis?: number
  maxEncodedBytes?: number
  stopTimeoutMillis?: number
  setAmplitudeTimer?: (callback: () => void, delayMillis: number) => ReturnType<typeof globalThis.setInterval>
  clearAmplitudeTimer?: (timer: ReturnType<typeof globalThis.setInterval>) => void
  setLimitTimer?: (callback: () => void, delayMillis: number) => ReturnType<typeof globalThis.setTimeout>
  clearLimitTimer?: (timer: ReturnType<typeof globalThis.setTimeout>) => void
}

interface BrowserBackgroundSoundRecordingSession {
  readonly generation: number
  readonly stream: MediaStream
  readonly mediaRecorder: MediaRecorder
  readonly startedAtMillis: number
  endedAtMillis?: number
  readonly chunks: Blob[]
  readonly handleData: (event: BlobEvent) => void
  readonly maxEncodedBytes: number
  encodedBytes: number
  audioContext?: AudioContext
  audioSource?: MediaStreamAudioSourceNode
  analyser?: AnalyserNode
  amplitudeTimer?: ReturnType<typeof globalThis.setInterval>
  captureLimitTimer?: ReturnType<typeof globalThis.setTimeout>
  dataListenerAttached: boolean
  resourceReleasePromise?: Promise<void>
  limitNotified: boolean
  abortPendingStop?: () => void
  released: boolean
}

/** MediaRecorder owns encoded audio; WebAudio is an optional, fail-soft waveform side channel. */
export class BrowserArkmeBackgroundSoundRecorder implements ArkmeBackgroundSoundRecorder {
  private readonly options: BrowserBackgroundSoundRecorderOptions
  private readonly amplitudeListeners = new Set<(amplitude: number) => void>()
  private readonly failureListeners = new Set<(failure: ArkmeBackgroundSoundFailure) => void>()
  private session: BrowserBackgroundSoundRecordingSession | undefined
  private generation = 0

  constructor(options: BrowserBackgroundSoundRecorderOptions = {}) {
    this.options = options
  }

  subscribeAmplitude(listener: (amplitude: number) => void): () => void {
    this.amplitudeListeners.add(listener)
    return () => { this.amplitudeListeners.delete(listener) }
  }

  subscribeFailure(listener: (failure: ArkmeBackgroundSoundFailure) => void): () => void {
    this.failureListeners.add(listener)
    return () => { this.failureListeners.delete(listener) }
  }

  async start(limits: ArkmeBackgroundSoundRecorderStartOptions = {}): Promise<void> {
    if (this.session !== undefined) throw new Error('背景音录制已经开始')
    const generation = ++this.generation
    const getUserMedia = this.options.getUserMedia
      ?? (typeof navigator === 'undefined' ? undefined : navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices))
    const createMediaRecorder = this.options.createMediaRecorder
      ?? (typeof MediaRecorder === 'undefined' ? undefined : (stream: MediaStream, options?: MediaRecorderOptions) => new MediaRecorder(stream, options))
    if (getUserMedia === undefined || createMediaRecorder === undefined) throw new Error('当前浏览器不支持背景音录制')

    let stream: MediaStream
    try {
      stream = await getUserMedia({ audio: { channelCount: 1 }, video: false })
    } catch (error) {
      lastMicrophonePermission = microphonePermissionAfterError(error)
      if (lastMicrophonePermission !== 'prompt') {
        setStoredExplicitMicrophoneGrant(browserMicrophoneGrantScope(), false)
      }
      throw microphoneError(error)
    }
    if (generation !== this.generation) {
      for (const track of stream.getTracks()) {
        try { track.stop() } catch { /* best-effort stale grant cleanup */ }
      }
      throw new Error('背景音录制已取消')
    }
    let session: BrowserBackgroundSoundRecordingSession | undefined
    try {
      const mimeType = preferredBackgroundSoundMimeType()
      const recorder = createMediaRecorder(stream, mimeType === undefined ? undefined : { mimeType, audioBitsPerSecond: 64_000 })
      const chunks: Blob[] = []
      const maxEncodedBytes = positiveLimit(
        limits.maxEncodedBytes ?? this.options.maxEncodedBytes,
        DEFAULT_BACKGROUND_SOUND_MAX_ENCODED_BYTES,
      )
      const handleData = (event: BlobEvent) => {
        if (session === undefined || session.released || event.data.size <= 0) return
        if (event.data.size > Math.max(0, session.maxEncodedBytes - session.encodedBytes)) {
          this.reachLimit(session)
          return
        }
        chunks.push(event.data)
        session.encodedBytes += event.data.size
        if (session.encodedBytes >= session.maxEncodedBytes) this.reachLimit(session)
      }
      session = {
        generation,
        stream,
        mediaRecorder: recorder,
        startedAtMillis: this.options.now?.() ?? Date.now(),
        chunks,
        handleData,
        maxEncodedBytes,
        encodedBytes: 0,
        dataListenerAttached: true,
        limitNotified: false,
        released: false,
      }
      this.session = session
      recorder.addEventListener('dataavailable', handleData)
      recorder.start(positiveLimit(this.options.mediaRecorderTimesliceMillis, DEFAULT_MEDIA_RECORDER_TIMESLICE_MILLIS))
      this.startAmplitudeSampling(session)
      this.startCaptureLimitTimer(session, positiveLimit(
        limits.maxCaptureDurationMillis ?? this.options.maxCaptureDurationMillis,
        DEFAULT_BACKGROUND_SOUND_MAX_CAPTURE_DURATION_MILLIS,
      ))
    } catch (error) {
      if (session === undefined) {
        for (const track of stream.getTracks()) {
          try { track.stop() } catch { /* best-effort constructor failure cleanup */ }
        }
      } else {
        await this.releaseSession(session)
      }
      throw error
    }
  }

  async stop(): Promise<ArkmeBackgroundSoundRecorderSegment | undefined> {
    const session = this.session
    if (session === undefined) return undefined
    const recorder = session.mediaRecorder
    const mimeType = recorder.mimeType || session.chunks[0]?.type || 'audio/webm'
    let stopTimer: CaptureTimer | undefined
    let cancelled = false
    const completed = new Promise<void>((resolve, reject) => {
      const onStop = () => {
        session.endedAtMillis ??= this.options.now?.() ?? Date.now()
        cleanup()
        resolve()
      }
      const onError = () => { cleanup(); reject(new Error('背景音录制结束失败')) }
      const onCancel = () => { cancelled = true; cleanup(); resolve() }
      const cleanup = () => {
        if (stopTimer !== undefined) {
          globalThis.clearTimeout(stopTimer)
          stopTimer = undefined
        }
        recorder.removeEventListener('stop', onStop)
        recorder.removeEventListener('error', onError)
        if (session.abortPendingStop === onCancel) delete session.abortPendingStop
      }
      recorder.addEventListener('stop', onStop, { once: true })
      recorder.addEventListener('error', onError, { once: true })
      session.abortPendingStop = onCancel
      stopTimer = globalThis.setTimeout(() => {
        cleanup()
        reject(new Error('背景音录制结束超时'))
      }, positiveLimit(this.options.stopTimeoutMillis, DEFAULT_OPERATION_TIMEOUT_MILLIS))
      try {
        if (recorder.state === 'inactive') onStop()
        else recorder.stop()
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
    try {
      await completed
      if (cancelled) return undefined
      const blob = new Blob(session.chunks, { type: mimeType })
      if (blob.size === 0) return undefined
      return {
        blob,
        fileName: `arkme-background-sound-${String(session.startedAtMillis)}.${backgroundSoundFileExtension(mimeType)}`,
        mimeType,
        durationMillis: Math.max(0, (session.endedAtMillis ?? this.options.now?.() ?? Date.now()) - session.startedAtMillis),
      }
    } finally {
      await this.releaseSession(session)
    }
  }

  async cancel(): Promise<void> {
    this.generation += 1
    const session = this.session
    if (session === undefined) return
    session.abortPendingStop?.()
    if (session.mediaRecorder.state !== 'inactive') {
      try { session.mediaRecorder.stop() } catch { /* best-effort cancellation */ }
    }
    await this.releaseSession(session)
  }

  async dispose(): Promise<void> {
    await this.cancel()
    this.amplitudeListeners.clear()
    this.failureListeners.clear()
  }

  private startCaptureLimitTimer(session: BrowserBackgroundSoundRecordingSession, durationMillis: number): void {
    const setTimer = this.options.setLimitTimer ?? globalThis.setTimeout.bind(globalThis)
    session.captureLimitTimer = setTimer(() => {
      delete session.captureLimitTimer
      this.reachLimit(session)
    }, durationMillis)
  }

  private reachLimit(session: BrowserBackgroundSoundRecordingSession): void {
    if (this.session !== session || session.released || session.limitNotified) return
    session.limitNotified = true
    session.endedAtMillis ??= this.options.now?.() ?? Date.now()
    this.clearCaptureLimitTimer(session)
    const releaseAfterStop = () => { void this.releaseMediaResources(session) }
    session.mediaRecorder.addEventListener('stop', releaseAfterStop, { once: true })
    for (const listener of this.failureListeners) {
      try { listener('limit-reached') } catch { /* UI feedback must not break cleanup */ }
    }
    if (session.mediaRecorder.state !== 'inactive') {
      try { session.mediaRecorder.stop() } catch { void this.releaseMediaResources(session) }
    } else {
      session.mediaRecorder.removeEventListener('stop', releaseAfterStop)
      void this.releaseMediaResources(session)
    }
  }

  private startAmplitudeSampling(session: BrowserBackgroundSoundRecordingSession): void {
    const createAudioContext = this.options.createAudioContext
      ?? (typeof window === 'undefined' || window.AudioContext === undefined ? undefined : () => new window.AudioContext())
    if (createAudioContext === undefined) return
    try {
      const context = createAudioContext()
      session.audioContext = context
      const source = context.createMediaStreamSource(session.stream)
      session.audioSource = source
      const analyser = context.createAnalyser()
      session.analyser = analyser
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.4
      source.connect(analyser)
      if (context.state === 'suspended') void context.resume().catch(() => undefined)
      const setTimer = this.options.setAmplitudeTimer ?? globalThis.setInterval.bind(globalThis)
      session.amplitudeTimer = setTimer(() => { this.sampleAmplitude(session) }, 90)
    } catch {
      void this.releaseAudioSampling(session)
    }
  }

  private sampleAmplitude(session: BrowserBackgroundSoundRecordingSession): void {
    if (this.session !== session || session.released || session.analyser === undefined) return
    const analyser = session.analyser
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const sample of samples) sum += sample * sample
    const rms = Math.sqrt(sum / Math.max(1, samples.length))
    const decibels = rms <= 0 ? -60 : 20 * Math.log10(rms)
    const normalized = Math.max(0.05, Math.min(1, (decibels + 55) / 55))
    for (const listener of this.amplitudeListeners) listener(normalized)
  }

  private async releaseAudioSampling(session: BrowserBackgroundSoundRecordingSession): Promise<void> {
    const amplitudeTimer = session.amplitudeTimer
    const audioSource = session.audioSource
    const analyser = session.analyser
    const context = session.audioContext
    delete session.amplitudeTimer
    delete session.audioSource
    delete session.analyser
    delete session.audioContext
    if (amplitudeTimer !== undefined) {
      const clearTimer = this.options.clearAmplitudeTimer ?? globalThis.clearInterval.bind(globalThis)
      clearTimer(amplitudeTimer)
    }
    try { audioSource?.disconnect() } catch { /* already disconnected */ }
    try { analyser?.disconnect() } catch { /* already disconnected */ }
    if (context !== undefined && context.state !== 'closed') {
      try { await context.close() } catch { /* best-effort context cleanup */ }
    }
  }

  private clearCaptureLimitTimer(session: BrowserBackgroundSoundRecordingSession): void {
    const timer = session.captureLimitTimer
    delete session.captureLimitTimer
    if (timer === undefined) return
    const clearTimer = this.options.clearLimitTimer ?? globalThis.clearTimeout.bind(globalThis)
    clearTimer(timer)
  }

  private async releaseMediaResources(session: BrowserBackgroundSoundRecordingSession): Promise<void> {
    if (session.resourceReleasePromise !== undefined) return await session.resourceReleasePromise
    session.resourceReleasePromise = (async () => {
      this.clearCaptureLimitTimer(session)
      if (session.dataListenerAttached) {
        session.mediaRecorder.removeEventListener('dataavailable', session.handleData)
        session.dataListenerAttached = false
      }
      for (const track of session.stream.getTracks()) {
        try { track.stop() } catch { /* best-effort stream cleanup */ }
      }
      await this.releaseAudioSampling(session)
    })()
    await session.resourceReleasePromise
  }

  private async releaseSession(session: BrowserBackgroundSoundRecordingSession): Promise<void> {
    if (session.released) return
    session.abortPendingStop?.()
    session.released = true
    if (this.session === session) this.session = undefined
    await this.releaseMediaResources(session)
    session.chunks.length = 0
  }
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback
}

function preferredBackgroundSoundMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find(candidate => MediaRecorder.isTypeSupported(candidate))
}

function backgroundSoundFileExtension(mimeType: string): string {
  if (/mp4|m4a/iu.test(mimeType)) return 'm4a'
  if (/ogg/iu.test(mimeType)) return 'ogg'
  return 'webm'
}

function defaultCaptureId(now: () => number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  fallbackCaptureSequence += 1
  return `arkme-capture-${String(now())}-${String(fallbackCaptureSequence)}`
}

function failureState(failure: ArkmeBackgroundSoundFailure | undefined): ArkmeBackgroundSoundCaptureState {
  if (failure === 'permission-denied') return 'denied'
  if (failure === 'unavailable') return 'unavailable'
  return failure === undefined ? 'not-captured' : 'failed'
}

/**
 * Single client owner for every text-record input surface.
 *
 * UI surfaces only publish keyed focus/content facts. This owner serializes one
 * browser microphone, isolates retained segments by draft, and captures submit
 * metadata once so callers cannot drift in duration/device semantics.
 */
export class ArkmeRecordInputCaptureOwner {
  private readonly recorder: ArkmeBackgroundSoundRecorder
  private readonly now: () => number
  private readonly createCaptureId: () => string
  private readonly captureContext: () => Promise<ArkmeRecordCaptureContext>
  private readonly enabledReader: () => boolean
  private readonly microphoneReadyReader: () => boolean
  private readonly requestMicrophonePermission: () => Promise<'granted'>
  private readonly onFailure: ((failure: ArkmeBackgroundSoundFailure) => void) | undefined
  private readonly startDelayMillis: number
  private readonly operationTimeoutMillis: number
  private readonly maxCaptureDurationMillis: number
  private readonly maxEncodedBytes: number
  private readonly maxRetainedDrafts: number
  private readonly setTimer: (callback: () => void, delayMillis: number) => CaptureTimer
  private readonly clearTimer: (timer: CaptureTimer) => void
  private readonly preferenceSubscriber: (listener: () => void) => () => void
  private readonly readsBrowserMicrophonePermission: boolean
  private readonly sessions = new Map<string, DraftCaptureState>()
  private readonly evictedDraftKeys = new Set<string>()
  private readonly waveformSnapshots = new Map<string, ArkmeRecordInputWaveformSnapshot>()
  private readonly waveformListeners = new Map<string, Set<() => void>>()
  private unsubscribePreference: () => void = () => undefined
  private unsubscribeRecorderFailure: () => void = () => undefined
  private activeDraftKey: string | undefined
  private recordingSession: DraftCaptureState | undefined
  private unsubscribeAmplitude: (() => void) | undefined
  private lifecycle: Promise<void> = Promise.resolve()
  private activationRevision = 0
  private activated = false
  private disposed = false

  constructor(options: ArkmeRecordInputCaptureOwnerOptions) {
    this.recorder = options.recorder ?? new BrowserArkmeBackgroundSoundRecorder()
    this.now = options.now ?? Date.now
    this.createCaptureId = options.createCaptureId ?? (() => defaultCaptureId(this.now))
    this.captureContext = options.captureContext ?? captureArkmeRecordInputContext
    this.enabledReader = options.backgroundSoundEnabled
      ?? (() => arkmeBackgroundSoundCaptureEnabled(options.accountId))
    this.microphoneReadyReader = options.microphoneReady
      ?? (options.recorder === undefined ? arkmeMicrophoneCaptureReady : () => true)
    this.requestMicrophonePermission = options.requestMicrophonePermission
      ?? requestArkmeBackgroundSoundPermission
    this.onFailure = options.onBackgroundSoundFailure
    this.startDelayMillis = Math.max(0, options.startDelayMillis ?? DEFAULT_START_DELAY_MILLIS)
    this.operationTimeoutMillis = Math.max(1, options.operationTimeoutMillis ?? DEFAULT_OPERATION_TIMEOUT_MILLIS)
    this.maxCaptureDurationMillis = positiveLimit(
      options.maxCaptureDurationMillis,
      DEFAULT_BACKGROUND_SOUND_MAX_CAPTURE_DURATION_MILLIS,
    )
    this.maxEncodedBytes = positiveLimit(options.maxEncodedBytes, DEFAULT_BACKGROUND_SOUND_MAX_ENCODED_BYTES)
    this.maxRetainedDrafts = positiveLimit(
      options.maxRetainedDrafts,
      DEFAULT_BACKGROUND_SOUND_MAX_RETAINED_DRAFTS,
    )
    this.setTimer = options.setTimer ?? globalThis.setTimeout.bind(globalThis)
    this.clearTimer = options.clearTimer ?? globalThis.clearTimeout.bind(globalThis)
    this.preferenceSubscriber = options.subscribeBackgroundSoundPreference
      ?? ((listener: () => void) => subscribeArkmeBackgroundSoundCapturePreference(options.accountId, listener))
    this.readsBrowserMicrophonePermission = options.recorder === undefined
  }

  activate(): void {
    if (this.disposed || this.activated) return
    this.activated = true
    this.activationRevision += 1
    this.unsubscribePreference = this.preferenceSubscriber(() => { this.reconcileCaptureGate() })
    this.unsubscribeRecorderFailure = this.recorder.subscribeFailure?.(failure => {
      this.handleRecorderFailure(failure)
    }) ?? (() => undefined)
    if (this.readsBrowserMicrophonePermission) {
      void arkmeMicrophonePermissionState().then(() => { this.reconcileCaptureGate() })
    }
  }

  deactivate(): void {
    if (this.disposed || !this.activated) return
    this.activated = false
    this.unsubscribePreference()
    this.unsubscribePreference = () => undefined
    this.unsubscribeRecorderFailure()
    this.unsubscribeRecorderFailure = () => undefined
    const revision = ++this.activationRevision
    queueMicrotask(() => {
      if (!this.disposed && !this.activated && this.activationRevision === revision) void this.dispose()
    })
  }

  sync(input: ArkmeRecordInputState): void {
    if (this.disposed) return
    this.activate()
    const draftKey = input.draftKey?.trim()
    if (input.isActive && draftKey !== undefined && draftKey !== '') {
      if (this.activeDraftKey !== undefined && this.activeDraftKey !== draftKey) {
        const previous = this.sessions.get(this.activeDraftKey)
        if (previous !== undefined) {
          previous.isActive = false
          previous.generation += 1
          this.reconcile(previous)
        }
      }
      this.activeDraftKey = draftKey
    } else if (draftKey !== undefined && this.activeDraftKey === draftKey) {
      this.activeDraftKey = undefined
    }
    if (draftKey === undefined || draftKey === '') return

    const state = this.session(draftKey)
    const previousRecordable = state.wasRecordable
    const clearedUserContent = state.hasUserContent && !input.hasUserContent
    state.isActive = input.isActive
    state.hasUserContent = input.hasUserContent
    if (input.hasUserContent) {
      state.startedAtMillis ??= this.now()
    } else {
      state.startedAtMillis = undefined
    }
    if (clearedUserContent) {
      // Clearing the draft starts a new logical input generation even while
      // focus remains. Do not let earlier segments leak into text typed later
      // under the same stable draftKey.
      state.generation += 1
      this.cancelStartTimer(state)
      state.segments.length = 0
      state.currentAmplitudes.length = 0
      state.failure = undefined
      state.failureLatched = false
      state.limitReached = false
      state.microphonePermissionAttempted = false
      void this.stopOrCancel(state, false)
    }
    const nextRecordable = this.shouldRecord(state)
    if (nextRecordable && !previousRecordable && !state.limitReached) {
      state.failure = undefined
      state.failureLatched = false
    }
    state.wasRecordable = nextRecordable
    this.reconcile(state)
  }

  /**
   * Called directly from a real composer input event so the browser may show
   * its microphone prompt. One logical draft generation owns at most one
   * request; focus, effects and re-renders never request permission.
   */
  beginUserInput(draftKeyValue: string | undefined): void {
    if (this.disposed || !this.readEnabled() || this.readMicrophoneReady()) return
    this.activate()
    const draftKey = draftKeyValue?.trim()
    if (draftKey === undefined || draftKey === '') return
    const state = this.session(draftKey)
    if (state.microphonePermissionAttempted) return
    state.microphonePermissionAttempted = true
    const generation = state.generation
    let request: Promise<'granted'>
    try {
      request = this.requestMicrophonePermission()
    } catch (error) {
      this.rejectInputPermission(state, generation, error)
      return
    }
    void request.then(() => {
      if (!this.currentGeneration(state, generation)) return
      state.failure = undefined
      state.failureLatched = false
      this.reconcileCaptureGate()
    }).catch(error => { this.rejectInputPermission(state, generation, error) })
  }

  getStartedAtMillis(draftKey: string | undefined): number | undefined {
    if (draftKey === undefined) return undefined
    return this.sessions.get(draftKey)?.startedAtMillis
  }

  getWaveformSnapshot(draftKey: string | undefined): ArkmeRecordInputWaveformSnapshot {
    if (draftKey === undefined) return EMPTY_WAVEFORM_SNAPSHOT
    return this.waveformSnapshots.get(draftKey) ?? EMPTY_WAVEFORM_SNAPSHOT
  }

  subscribeWaveform(draftKey: string | undefined, listener: () => void): () => void {
    if (draftKey === undefined) return () => undefined
    const listeners = this.waveformListeners.get(draftKey) ?? new Set<() => void>()
    listeners.add(listener)
    this.waveformListeners.set(draftKey, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.waveformListeners.delete(draftKey)
    }
  }

  async finishForSubmit(draftKey: string): Promise<ArkmeRecordInputCaptureResult> {
    const state = this.session(draftKey)
    const completedAtMillis = this.now()
    const contextPromise = this.captureContext().catch((): ArkmeRecordCaptureContext => ({
      clientName: '浏览器（DeepSeek Harness）',
    }))
    // A quick send can arrive before the zero-delay timer fires or while
    // getUserMedia/MediaRecorder is still starting. Finalize that same owner
    // generation first; otherwise a valid granted draft silently loses its
    // supplemental background sound and is sent as plain text.
    const shouldFinalizePendingStart = this.shouldRecord(state) && this.recordingSession !== state
    this.cancelStartTimer(state)
    if (shouldFinalizePendingStart) {
      await this.bounded(state.startPromise ?? this.startRecording(state)).catch(() => undefined)
    }
    state.isActive = false
    state.generation += 1
    if (this.activeDraftKey === draftKey) this.activeDraftKey = undefined
    this.cancelStartTimer(state)
    this.cancelCaptureLimitTimer(state)
    this.publishWaveform(state)
    // The composer reuses its stable draftKey immediately after take(). Detach
    // this exact generation before the first await so new input gets a new
    // session and late stop/context completion cannot delete or mutate it.
    this.detachSession(state)
    const preserveBackgroundSound = this.captureGateOpen()
    await this.stopOrCancel(state, preserveBackgroundSound)
    const enabled = this.readEnabled()
    const segments = (preserveBackgroundSound ? state.segments : []).map(segment => ({
      ...segment,
      amplitudes: [...segment.amplitudes],
    }))
    const amplitudes = segments.flatMap(segment => segment.amplitudes)
    const result: ArkmeRecordInputCaptureResult = {
      schemaVersion: 1,
      captureId: this.createCaptureId(),
      ...(state.startedAtMillis === undefined ? {} : { startedAtMillis: state.startedAtMillis }),
      completedAtMillis,
      recordDurationMillis: state.startedAtMillis === undefined
        ? 0
        : Math.max(0, completedAtMillis - state.startedAtMillis),
      captureContext: await contextPromise,
      backgroundSound: {
        enabled,
        state: segments.length > 0 ? 'captured' : enabled ? failureState(state.failure) : 'disabled',
        ...(state.failure === undefined ? {} : { failure: state.failure }),
        segments,
        amplitudes,
      },
    }
    return result
  }

  restoreForRetry(draftKey: string, result: ArkmeRecordInputCaptureResult): void {
    if (this.disposed) return
    const current = this.sessions.get(draftKey)
    // composerDraftStore.restore() preserves any text entered after send began.
    // Mirror that rule: a newer non-empty capture always wins over the failed
    // submission snapshot.
    if (current !== undefined && (current.hasUserContent
      || current.startedAtMillis !== undefined
      || current.segments.length > 0)) return
    const active = current?.isActive === true
    if (current !== undefined) {
      current.isActive = false
      current.generation += 1
      this.cancelStartTimer(current)
      this.cancelCaptureLimitTimer(current)
      this.detachSession(current)
      void this.stopOrCancel(current, false)
    }
    const state = this.session(draftKey)
    state.isActive = active
    state.hasUserContent = true
    state.startedAtMillis = result.startedAtMillis
    const restoreBackgroundSound = this.captureGateOpen()
    state.segments.splice(0, state.segments.length, ...(restoreBackgroundSound ? result.backgroundSound.segments : []).map(segment => ({
      ...segment,
      amplitudes: [...segment.amplitudes],
    })))
    state.failure = !restoreBackgroundSound
      ? undefined
      : result.backgroundSound.state === 'denied'
      ? 'permission-denied'
      : result.backgroundSound.state === 'unavailable'
        ? 'unavailable'
        : result.backgroundSound.state === 'failed' ? 'stop-failed' : undefined
    state.limitReached = restoreBackgroundSound && (result.backgroundSound.failure === 'limit-reached'
      || result.backgroundSound.segments.reduce((sum, segment) => sum + Math.max(0, segment.durationMillis), 0) >= this.maxCaptureDurationMillis
      || result.backgroundSound.segments.reduce((sum, segment) => sum + segment.blob.size, 0) >= this.maxEncodedBytes)
    state.failureLatched = state.limitReached
    if (state.limitReached) state.failure = 'limit-reached'
    if (active) this.activeDraftKey = draftKey
    this.publishWaveform(state)
    if (active) this.reconcile(state)
  }

  async discard(draftKey: string): Promise<void> {
    const state = this.sessions.get(draftKey)
    if (state === undefined) return
    state.isActive = false
    state.generation += 1
    if (this.activeDraftKey === draftKey) this.activeDraftKey = undefined
    this.cancelStartTimer(state)
    this.cancelCaptureLimitTimer(state)
    this.publishWaveform(state)
    this.detachSession(state)
    await this.stopOrCancel(state, false)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.activationRevision += 1
    this.activated = false
    this.unsubscribePreference()
    this.unsubscribeRecorderFailure()
    for (const state of this.sessions.values()) {
      state.generation += 1
      this.cancelStartTimer(state)
      this.cancelCaptureLimitTimer(state)
    }
    this.activeDraftKey = undefined
    await this.enqueue(async () => {
      this.unsubscribeAmplitude?.()
      this.unsubscribeAmplitude = undefined
      try { await this.bounded(this.recorder.cancel()) } catch { /* fail-soft disposal */ }
      this.recordingSession = undefined
      try { await this.bounded(this.recorder.dispose()) } catch { /* fail-soft disposal */ }
    })
    this.sessions.clear()
    this.evictedDraftKeys.clear()
    const waveformKeys = [...this.waveformSnapshots.keys()]
    this.waveformSnapshots.clear()
    for (const key of waveformKeys) this.emitWaveform(key)
    this.waveformListeners.clear()
  }

  private session(draftKey: string): DraftCaptureState {
    const current = this.sessions.get(draftKey)
    if (current !== undefined) {
      this.sessions.delete(draftKey)
      this.sessions.set(draftKey, current)
      return current
    }
    this.evictOldestInactiveSession()
    const evicted = this.evictedDraftKeys.delete(draftKey)
    const created: DraftCaptureState = {
      draftKey,
      isActive: false,
      hasUserContent: false,
      wasRecordable: false,
      startedAtMillis: undefined,
      failure: evicted ? 'retention-evicted' : undefined,
      failureLatched: false,
      generation: 0,
      starting: false,
      startPromise: undefined,
      startTimer: undefined,
      captureLimitTimer: undefined,
      limitReached: false,
      segments: [],
      currentAmplitudes: [],
      microphonePermissionAttempted: false,
    }
    this.sessions.set(draftKey, created)
    return created
  }

  private evictOldestInactiveSession(): void {
    if (this.sessions.size < this.maxRetainedDrafts) return
    for (const state of this.sessions.values()) {
      if (state.isActive || state.draftKey === this.activeDraftKey) continue
      state.generation += 1
      this.cancelStartTimer(state)
      this.cancelCaptureLimitTimer(state)
      this.detachSession(state)
      this.evictedDraftKeys.add(state.draftKey)
      while (this.evictedDraftKeys.size > this.maxRetainedDrafts) {
        const oldest = this.evictedDraftKeys.values().next().value as string | undefined
        if (oldest === undefined) break
        this.evictedDraftKeys.delete(oldest)
      }
      void this.stopOrCancel(state, false)
      return
    }
  }

  private reconcileCaptureGate(): void {
    if (!this.captureGateOpen()) {
      this.discardAllBackgroundSoundForClosedGate()
      return
    }
    if (this.activeDraftKey === undefined) return
    const state = this.sessions.get(this.activeDraftKey)
    if (state === undefined) return
    const recordable = this.shouldRecord(state)
    if (recordable && !state.wasRecordable && !state.limitReached) {
      state.failure = undefined
      state.failureLatched = false
    }
    state.wasRecordable = recordable
    this.reconcile(state)
  }

  private reconcile(state: DraftCaptureState): void {
    if (!this.captureGateOpen()) {
      this.discardAllBackgroundSoundForClosedGate()
      return
    }
    const recordable = this.shouldRecord(state)
    this.publishWaveform(state)
    if (!recordable) {
      this.cancelStartTimer(state)
      this.cancelCaptureLimitTimer(state)
      void this.stopOrCancel(state, state.hasUserContent)
      return
    }
    if (state.failureLatched || state.starting || state.startTimer !== undefined || this.recordingSession === state) return
    state.startTimer = this.setTimer(() => {
      state.startTimer = undefined
      if (this.shouldRecord(state) && !state.failureLatched) void this.startRecording(state)
    }, this.startDelayMillis)
  }

  private shouldRecord(state: DraftCaptureState): boolean {
    return !this.disposed && state.isActive && this.activeDraftKey === state.draftKey
      && state.hasUserContent && this.readEnabled() && this.readMicrophoneReady()
  }

  private captureGateOpen(): boolean {
    return !this.disposed && this.readEnabled() && this.readMicrophoneReady()
  }

  private discardAllBackgroundSoundForClosedGate(): void {
    for (const state of this.sessions.values()) {
      const hasPendingCapture = state.startTimer !== undefined
        || state.starting
        || state.captureLimitTimer !== undefined
        || state.segments.length > 0
        || state.currentAmplitudes.length > 0
        || this.recordingSession === state
      state.wasRecordable = false
      state.failure = undefined
      state.failureLatched = false
      state.limitReached = false
      state.segments.length = 0
      state.currentAmplitudes.length = 0
      this.cancelStartTimer(state)
      this.cancelCaptureLimitTimer(state)
      if (hasPendingCapture) state.generation += 1
      this.publishWaveform(state)
      if (this.recordingSession === state) void this.stopOrCancel(state, false)
    }
  }

  private readEnabled(): boolean {
    try { return this.enabledReader() } catch { return false }
  }

  private readMicrophoneReady(): boolean {
    try { return this.microphoneReadyReader() } catch { return false }
  }

  private currentGeneration(state: DraftCaptureState, generation: number): boolean {
    return !this.disposed && state.generation === generation && this.sessions.get(state.draftKey) === state
  }

  private rejectInputPermission(state: DraftCaptureState, generation: number, error: unknown): void {
    if (!this.currentGeneration(state, generation)) return
    const failure = this.classifyStartFailure(error)
    state.failure = failure
    state.failureLatched = true
    this.publishWaveform(state)
    this.notifyFailure(failure)
  }

  private startRecording(state: DraftCaptureState): Promise<void> {
    const generation = state.generation
    state.starting = true
    const operation = this.enqueue(async () => {
      try {
        if (!this.shouldRecord(state) || state.failureLatched || generation !== state.generation || this.recordingSession !== undefined) return
        const remainingDurationMillis = this.remainingCaptureDurationMillis(state)
        const remainingEncodedBytes = this.remainingEncodedBytes(state)
        if (remainingDurationMillis <= 0 || remainingEncodedBytes <= 0) {
          this.markLimitReached(state)
          return
        }
        await this.bounded(this.recorder.start({
          maxCaptureDurationMillis: remainingDurationMillis,
          maxEncodedBytes: remainingEncodedBytes,
        }))
        if (!this.shouldRecord(state) || generation !== state.generation) {
          await this.bounded(this.recorder.cancel()).catch(() => undefined)
          return
        }
        this.recordingSession = state
        state.currentAmplitudes.length = 0
        this.startCaptureLimitTimer(state, generation, remainingDurationMillis)
        this.unsubscribeAmplitude?.()
        this.unsubscribeAmplitude = this.recorder.subscribeAmplitude(value => {
          if (this.recordingSession !== state || this.disposed) return
          const normalized = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
          state.currentAmplitudes.push(normalized)
          if (state.currentAmplitudes.length > MAX_VISIBLE_AMPLITUDES) {
            state.currentAmplitudes.splice(0, state.currentAmplitudes.length - MAX_VISIBLE_AMPLITUDES)
          }
          this.publishWaveform(state)
        })
      } catch (error) {
        const failure = this.classifyStartFailure(error)
        state.failure = failure
        state.failureLatched = true
        await this.bounded(this.recorder.cancel()).catch(() => undefined)
        this.notifyFailure(failure)
      } finally {
        state.starting = false
        this.publishWaveform(state)
      }
    }).finally(() => {
      const active = this.activeDraftKey === undefined ? undefined : this.sessions.get(this.activeDraftKey)
      if (active !== undefined && this.recordingSession === undefined && this.shouldRecord(active)) this.reconcile(active)
    })
    const tracked = operation.finally(() => {
      if (state.startPromise === tracked) state.startPromise = undefined
    })
    state.startPromise = tracked
    return tracked
  }

  private stopOrCancel(state: DraftCaptureState, preserve: boolean): Promise<void> {
    this.cancelCaptureLimitTimer(state)
    if (!preserve) {
      state.segments.length = 0
      state.currentAmplitudes.length = 0
    }
    return this.enqueue(async () => {
      if (this.recordingSession !== state) {
        if (!preserve) {
          state.segments.length = 0
          state.currentAmplitudes.length = 0
        }
        this.publishWaveform(state)
        return
      }
      this.unsubscribeAmplitude?.()
      this.unsubscribeAmplitude = undefined
      const amplitudes = [...state.currentAmplitudes]
      try {
        if (preserve) {
          const segment = await this.bounded(this.recorder.stop())
          if (segment !== undefined) {
            const remainingDurationMillis = this.remainingCaptureDurationMillis(state)
            const remainingEncodedBytes = this.remainingEncodedBytes(state)
            if (segment.durationMillis > remainingDurationMillis || segment.blob.size > remainingEncodedBytes) {
              this.markLimitReached(state)
            } else {
              state.segments.push({ ...segment, amplitudes })
              if (this.remainingCaptureDurationMillis(state) <= 0 || this.remainingEncodedBytes(state) <= 0) {
                this.markLimitReached(state)
              }
            }
          }
        } else {
          await this.bounded(this.recorder.cancel())
          state.segments.length = 0
        }
      } catch {
        state.failure = 'stop-failed'
        this.notifyFailure('stop-failed')
        await this.bounded(this.recorder.cancel()).catch(() => undefined)
      } finally {
        if (this.recordingSession === state) this.recordingSession = undefined
        state.currentAmplitudes.length = 0
        this.publishWaveform(state)
      }
    }).finally(() => {
      const active = this.activeDraftKey === undefined ? undefined : this.sessions.get(this.activeDraftKey)
      if (active !== undefined && this.shouldRecord(active)) this.reconcile(active)
    })
  }

  private classifyStartFailure(error: unknown): ArkmeBackgroundSoundFailure {
    const permission = microphonePermissionAfterError(error)
    if (permission === 'denied') return 'permission-denied'
    if (permission === 'unavailable') return 'unavailable'
    const message = error instanceof Error ? error.message : String(error)
    if (/未允许|permission|notallowed/iu.test(message)) return 'permission-denied'
    if (/不支持|未找到|unavailable|notfound/iu.test(message)) return 'unavailable'
    return 'start-failed'
  }

  private handleRecorderFailure(failure: ArkmeBackgroundSoundFailure): void {
    if (this.disposed) return
    const state = this.recordingSession
    if (state === undefined) return
    if (failure === 'limit-reached') this.markLimitReached(state)
    else {
      state.failure = failure
      state.failureLatched = true
      this.notifyFailure(failure)
    }
    this.publishWaveform(state)
    void this.stopOrCancel(state, true)
  }

  private markLimitReached(state: DraftCaptureState): void {
    if (state.limitReached) return
    state.limitReached = true
    state.failure = 'limit-reached'
    state.failureLatched = true
    this.cancelStartTimer(state)
    this.cancelCaptureLimitTimer(state)
    this.notifyFailure('limit-reached')
  }

  private startCaptureLimitTimer(state: DraftCaptureState, generation: number, durationMillis: number): void {
    this.cancelCaptureLimitTimer(state)
    state.captureLimitTimer = this.setTimer(() => {
      state.captureLimitTimer = undefined
      if (this.disposed || this.recordingSession !== state || state.generation !== generation) return
      this.markLimitReached(state)
      this.publishWaveform(state)
      void this.stopOrCancel(state, true)
    }, durationMillis)
  }

  private remainingCaptureDurationMillis(state: DraftCaptureState): number {
    return this.maxCaptureDurationMillis - state.segments.reduce(
      (sum, segment) => sum + Math.max(0, segment.durationMillis),
      0,
    )
  }

  private remainingEncodedBytes(state: DraftCaptureState): number {
    return this.maxEncodedBytes - state.segments.reduce((sum, segment) => sum + segment.blob.size, 0)
  }

  private notifyFailure(failure: ArkmeBackgroundSoundFailure): void {
    try { this.onFailure?.(failure) } catch { /* feedback must not break input lifecycle */ }
  }

  private publishWaveform(state: DraftCaptureState): void {
    if (this.sessions.get(state.draftKey) !== state) return
    const next: ArkmeRecordInputWaveformSnapshot = {
      visible: this.shouldRecord(state) && !state.failureLatched,
      recording: this.recordingSession === state,
      amplitudes: [...state.currentAmplitudes],
      ...(state.failure === undefined ? {} : { failure: state.failure }),
    }
    const previous = this.waveformSnapshots.get(state.draftKey)
    if (previous?.visible === next.visible
      && previous.recording === next.recording
      && previous.failure === next.failure
      && arraysEqual(previous.amplitudes, next.amplitudes)) return
    this.waveformSnapshots.set(state.draftKey, Object.freeze(next))
    this.emitWaveform(state.draftKey)
  }

  private emitWaveform(draftKey: string): void {
    for (const listener of this.waveformListeners.get(draftKey) ?? []) listener()
  }

  private cancelStartTimer(state: DraftCaptureState): void {
    if (state.startTimer === undefined) return
    this.clearTimer(state.startTimer)
    state.startTimer = undefined
  }

  private cancelCaptureLimitTimer(state: DraftCaptureState): void {
    if (state.captureLimitTimer === undefined) return
    this.clearTimer(state.captureLimitTimer)
    state.captureLimitTimer = undefined
  }

  private detachSession(state: DraftCaptureState): void {
    if (this.sessions.get(state.draftKey) !== state) return
    this.cancelStartTimer(state)
    this.cancelCaptureLimitTimer(state)
    this.sessions.delete(state.draftKey)
    this.waveformSnapshots.delete(state.draftKey)
    this.emitWaveform(state.draftKey)
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.lifecycle.then(task, task)
    this.lifecycle = next.catch(() => undefined)
    return next
  }

  private async bounded<T>(promise: Promise<T>): Promise<T> {
    const timeout = Symbol('timeout')
    const result = await withTimeout<T | typeof timeout>(promise, this.operationTimeoutMillis, timeout)
    if (result === timeout) throw new Error('背景音录制操作超时')
    return result
  }
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
