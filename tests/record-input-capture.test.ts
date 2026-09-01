import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArkmeBackgroundSoundServerPreferenceRuntime,
  BrowserArkmeBackgroundSoundRecorder,
  ArkmeRecordInputCaptureOwner,
  applyArkmeBackgroundSoundOwnerSnapshot,
  arkmeBackgroundSoundCaptureEnabled,
  arkmeMicrophonePermissionState,
  arkmeSourceSupportsRecordInputCapture,
  captureArkmeRecordInputContext,
  requestArkmeBackgroundSoundPermission,
  setArkmeBackgroundSoundCaptureEnabled,
  setArkmeBackgroundSoundFromSettings,
  subscribeArkmeBackgroundSoundCapturePreference,
  type ArkmeBackgroundSoundRecorder,
  type ArkmeBackgroundSoundRecorderSegment,
} from '../src/client/record-input-capture.js'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

class FakeRecorder implements ArkmeBackgroundSoundRecorder {
  readonly amplitudeListeners = new Set<(value: number) => void>()
  startCalls = 0
  stopCalls = 0
  cancelCalls = 0
  disposeCalls = 0
  segmentNumber = 0
  startError: Error | undefined
  startOverride: (() => Promise<void>) | undefined
  stopError: Error | undefined
  stopSegment: ArkmeBackgroundSoundRecorderSegment | undefined
  stopOverride: (() => Promise<ArkmeBackgroundSoundRecorderSegment | undefined>) | undefined

  async start(): Promise<void> {
    this.startCalls += 1
    if (this.startError !== undefined) throw this.startError
    if (this.startOverride !== undefined) await this.startOverride()
    this.segmentNumber += 1
  }

  async stop(): Promise<ArkmeBackgroundSoundRecorderSegment | undefined> {
    this.stopCalls += 1
    if (this.stopError !== undefined) throw this.stopError
    if (this.stopOverride !== undefined) return await this.stopOverride()
    return this.stopSegment ?? {
      blob: new Blob([`segment-${String(this.segmentNumber)}`], { type: 'audio/webm' }),
      fileName: `segment-${String(this.segmentNumber)}.webm`,
      mimeType: 'audio/webm',
      durationMillis: 800,
    }
  }

  async cancel(): Promise<void> { this.cancelCalls += 1 }
  async dispose(): Promise<void> { this.disposeCalls += 1 }

  subscribeAmplitude(listener: (value: number) => void): () => void {
    this.amplitudeListeners.add(listener)
    return () => { this.amplitudeListeners.delete(listener) }
  }

  emit(value: number): void {
    for (const listener of this.amplitudeListeners) listener(value)
  }
}

async function flushLifecycle(): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, 5) })
  await Promise.resolve()
  await Promise.resolve()
}

function createOwner(input: {
  recorder: FakeRecorder
  enabled?: () => boolean
  microphoneReady?: () => boolean
  requestMicrophonePermission?: () => Promise<'granted'>
  now?: () => number
  failures?: string[]
  captureContext?: () => Promise<{ clientName?: string; networkName?: string }>
  maxCaptureDurationMillis?: number
  maxEncodedBytes?: number
  maxRetainedDrafts?: number
  startDelayMillis?: number
  setTimer?: (callback: () => void, delayMillis: number) => ReturnType<typeof globalThis.setTimeout>
  clearTimer?: (timer: ReturnType<typeof globalThis.setTimeout>) => void
}): ArkmeRecordInputCaptureOwner {
  return new ArkmeRecordInputCaptureOwner({
    accountId: 1001,
    recorder: input.recorder,
    startDelayMillis: input.startDelayMillis ?? 0,
    operationTimeoutMillis: 100,
    backgroundSoundEnabled: input.enabled ?? (() => true),
    microphoneReady: input.microphoneReady,
    requestMicrophonePermission: input.requestMicrophonePermission,
    subscribeBackgroundSoundPreference: () => () => undefined,
    now: input.now,
    captureContext: input.captureContext ?? (async () => ({ clientName: 'Test Browser' })),
    createCaptureId: () => 'capture-test',
    onBackgroundSoundFailure: failure => { input.failures?.push(failure) },
    maxCaptureDurationMillis: input.maxCaptureDurationMillis,
    maxEncodedBytes: input.maxEncodedBytes,
    maxRetainedDrafts: input.maxRetainedDrafts,
    setTimer: input.setTimer,
    clearTimer: input.clearTimer,
  })
}

afterEach(() => {
  setArkmeBackgroundSoundCaptureEnabled(1001, false, {})
  setArkmeBackgroundSoundCaptureEnabled(2002, false, {})
  vi.restoreAllMocks()
})

describe('record input capture preference and permission', () => {
  it('defaults off and isolates the local preference and subscriptions by account', () => {
    const localStorage = new MemoryStorage()
    const scope = { localStorage }
    const accountA = vi.fn()
    const accountB = vi.fn()
    const unsubscribeA = subscribeArkmeBackgroundSoundCapturePreference(1001, accountA)
    const unsubscribeB = subscribeArkmeBackgroundSoundCapturePreference(2002, accountB)

    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(false)
    expect(arkmeBackgroundSoundCaptureEnabled(2002, scope)).toBe(false)
    setArkmeBackgroundSoundCaptureEnabled(1001, true, scope)

    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(true)
    expect(arkmeBackgroundSoundCaptureEnabled(2002, scope)).toBe(false)
    expect(accountA).toHaveBeenCalledOnce()
    expect(accountB).not.toHaveBeenCalled()
    unsubscribeA()
    unsubscribeB()
  })

  it('isolates the same numeric user id across environments', () => {
    const localStorage = new MemoryStorage()
    const scope = { localStorage }

    setArkmeBackgroundSoundCaptureEnabled('test:1001', true, scope)
    expect(arkmeBackgroundSoundCaptureEnabled('test:1001', scope)).toBe(true)
    expect(arkmeBackgroundSoundCaptureEnabled('prod:1001', scope)).toBe(false)
    expect(applyArkmeBackgroundSoundOwnerSnapshot(
      'prod:1001',
      { userId: 1001, enabled: true, found: true },
      scope,
      1001,
    )).toBe(true)
    expect(arkmeBackgroundSoundCaptureEnabled('prod:1001', scope)).toBe(true)
  })

  it('persists the feature switch without requesting microphone permission from settings', async () => {
    const localStorage = new MemoryStorage()
    const scope = { localStorage }
    const persist = vi.fn(async () => undefined)

    await setArkmeBackgroundSoundFromSettings(1001, true, persist, scope)
    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(true)
    expect(persist).toHaveBeenLastCalledWith(true)

    await setArkmeBackgroundSoundFromSettings(1001, false, persist, scope)
    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(false)
    expect(persist).toHaveBeenLastCalledWith(false)
  })

  it('optimistically projects owner writes and rolls the previous value back on persistence failure', async () => {
    const localStorage = new MemoryStorage()
    const scope = { localStorage }
    const observations: boolean[] = []
    const persist = vi.fn(async (enabled: boolean) => {
      observations.push(arkmeBackgroundSoundCaptureEnabled(1001, scope))
      if (enabled) throw new Error('owner rejected')
    })

    await expect(setArkmeBackgroundSoundFromSettings(
      1001,
      true,
      persist,
      scope,
    )).rejects.toThrow('owner rejected')

    expect(observations).toEqual([true])
    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(false)

    setArkmeBackgroundSoundCaptureEnabled(1001, true, scope)
    await setArkmeBackgroundSoundFromSettings(1001, false, persist, scope)
    expect(observations).toEqual([true, false])
    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(false)
  })

  it('does not let a stale mutation apply or roll back a newer local projection', async () => {
    const localStorage = new MemoryStorage()
    const scope = { localStorage }
    let current = false
    const staleBeforeProjection = setArkmeBackgroundSoundFromSettings(
      1001,
      true,
      undefined,
      scope,
      () => current,
    )
    setArkmeBackgroundSoundCaptureEnabled(1001, false, scope)
    await expect(staleBeforeProjection).rejects.toThrow('已被更新的操作取代')
    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(false)

    current = true
    let rejectPersistence: ((error: Error) => void) | undefined
    const stalePersistence = setArkmeBackgroundSoundFromSettings(
      1001,
      true,
      async () => await new Promise<void>((_resolve, reject) => { rejectPersistence = reject }),
      scope,
      () => current,
    )
    await Promise.resolve()
    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(true)
    current = false
    // A newer, same-target mutation has already projected true. The stale
    // rejection must not restore its own earlier false snapshot over it.
    setArkmeBackgroundSoundCaptureEnabled(1001, true, scope)
    rejectPersistence?.(new Error('stale owner response'))
    await expect(stalePersistence).rejects.toThrow('stale owner response')
    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(true)
  })

  it('applies only a found owner snapshot belonging to the active account', () => {
    const localStorage = new MemoryStorage()
    const scope = { localStorage }

    expect(applyArkmeBackgroundSoundOwnerSnapshot(1001, { userId: 2002, enabled: true, found: true }, scope)).toBe(false)
    expect(applyArkmeBackgroundSoundOwnerSnapshot(1001, { userId: 1001, enabled: true, found: false }, scope)).toBe(true)
    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(false)

    expect(applyArkmeBackgroundSoundOwnerSnapshot(1001, { userId: 1001, enabled: true, found: true }, scope)).toBe(true)
    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(true)

    expect(applyArkmeBackgroundSoundOwnerSnapshot(1001, {
      userId: 1001,
      enabled: true,
      found: false,
      eligible: false,
    }, scope)).toBe(true)
    expect(arkmeBackgroundSoundCaptureEnabled(1001, scope)).toBe(false)
  })

  it('shares one mutation fence across settings and sidebar reads', () => {
    const runtime = new ArkmeBackgroundSoundServerPreferenceRuntime()
    const earlyRead = runtime.beginRead(1001)
    expect(runtime.current(earlyRead)).toBe(true)

    const mutation = runtime.beginMutation(1001)
    const readDuringMutation = runtime.beginRead(1001)
    expect(runtime.current(earlyRead)).toBe(false)
    expect(runtime.current(readDuringMutation)).toBe(false)
    expect(runtime.current(mutation)).toBe(true)

    runtime.finish(mutation)
    expect(runtime.current(mutation)).toBe(false)
    expect(runtime.current(readDuringMutation)).toBe(false)
    expect(runtime.current(runtime.beginRead(1001))).toBe(true)
    expect(runtime.current(runtime.beginMutation(2002))).toBe(true)
  })

  it('keeps a fail-safe in-memory projection when localStorage rejects a disable write', () => {
    const writable = new MemoryStorage()
    setArkmeBackgroundSoundCaptureEnabled(1001, true, { localStorage: writable })
    const blockedStorage = {
      getItem: () => 'enabled',
      setItem: () => { throw new Error('quota blocked') },
    }

    setArkmeBackgroundSoundCaptureEnabled(1001, false, { localStorage: blockedStorage })

    expect(arkmeBackgroundSoundCaptureEnabled(1001, { localStorage: blockedStorage })).toBe(false)
  })

  it('observes another window disabling the same account preference', () => {
    const previousWindow = globalThis.window
    const localStorage = new MemoryStorage()
    const eventTarget = new EventTarget()
    const fakeWindow = Object.assign(eventTarget, { localStorage })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
    try {
      setArkmeBackgroundSoundCaptureEnabled(1001, true, { localStorage })
      const changed = vi.fn()
      const unsubscribe = subscribeArkmeBackgroundSoundCapturePreference(1001, changed)
      localStorage.setItem('arkme.record-capture.background-sound.enabled.1001', 'disabled')
      const event = new Event('storage')
      Object.defineProperties(event, {
        key: { value: 'arkme.record-capture.background-sound.enabled.1001' },
        newValue: { value: 'disabled' },
      })
      eventTarget.dispatchEvent(event)

      expect(changed).toHaveBeenCalledOnce()
      expect(arkmeBackgroundSoundCaptureEnabled(1001, { localStorage })).toBe(false)
      unsubscribe()
      localStorage.setItem('arkme.record-capture.background-sound.enabled.1001', 'enabled')
      expect(arkmeBackgroundSoundCaptureEnabled(1001, { localStorage })).toBe(true)
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
    }
  })

  it('queries microphone permission without prompting and releases every track after explicit authorization', async () => {
    const stopA = vi.fn()
    const stopB = vi.fn()
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: stopA }, { stop: stopB }],
    } as unknown as MediaStream))
    const source = {
      permissions: { query: vi.fn(async () => ({ state: 'prompt' as PermissionState })) },
      mediaDevices: { getUserMedia },
    }

    await expect(arkmeMicrophonePermissionState(source)).resolves.toBe('prompt')
    expect(getUserMedia).not.toHaveBeenCalled()
    await expect(requestArkmeBackgroundSoundPermission(source)).resolves.toBe('granted')
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false })
    expect(stopA).toHaveBeenCalledOnce()
    expect(stopB).toHaveBeenCalledOnce()
  })

  it('retains an explicit grant across a page reload when Permissions.query is unavailable', async () => {
    const sessionStorage = new MemoryStorage()
    const grantScope = { sessionStorage }
    const source = {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] } as unknown as MediaStream),
      },
    }
    await requestArkmeBackgroundSoundPermission(source, grantScope)
    // Simulate module reload state while preserving this tab's session marker.
    await arkmeMicrophonePermissionState({
      ...source,
      permissions: { query: async () => ({ state: 'prompt' as PermissionState }) },
    }, {})

    await expect(arkmeMicrophonePermissionState(source, grantScope)).resolves.toBe('granted')
  })
})

describe('BrowserArkmeBackgroundSoundRecorder resource ownership', () => {
  it('releases stream, WebAudio graph and sampling timer after producing a segment', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    class FakeMediaRecorder extends EventTarget {
      state: RecordingState = 'inactive'
      readonly mimeType = 'audio/webm'

      start(): void { this.state = 'recording' }
      stop(): void {
        this.state = 'inactive'
        const dataEvent = new Event('dataavailable')
        Object.defineProperty(dataEvent, 'data', { value: new Blob(['encoded'], { type: this.mimeType }) })
        this.dispatchEvent(dataEvent)
        queueMicrotask(() => { this.dispatchEvent(new Event('stop')) })
      }
    }
    const mediaRecorder = new FakeMediaRecorder()
    const disconnectSource = vi.fn()
    const disconnectAnalyser = vi.fn()
    const closeContext = vi.fn(async () => undefined)
    const clearAmplitudeTimer = vi.fn()
    const context = {
      state: 'running',
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: disconnectSource }),
      createAnalyser: () => ({
        fftSize: 256,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData: (samples: Float32Array) => { samples.fill(0.1) },
        disconnect: disconnectAnalyser,
      }),
      resume: vi.fn(async () => undefined),
      close: closeContext,
    } as unknown as AudioContext
    let now = 1_000
    const recorder = new BrowserArkmeBackgroundSoundRecorder({
      getUserMedia: vi.fn(async () => stream),
      createMediaRecorder: () => mediaRecorder as unknown as MediaRecorder,
      createAudioContext: () => context,
      now: () => now,
      setAmplitudeTimer: callback => { callback(); return 17 as unknown as ReturnType<typeof globalThis.setInterval> },
      clearAmplitudeTimer,
    })
    const amplitudes: number[] = []
    recorder.subscribeAmplitude(value => { amplitudes.push(value) })

    await recorder.start()
    now = 1_900
    const segment = await recorder.stop()

    expect(segment).toMatchObject({ fileName: 'arkme-background-sound-1000.webm', mimeType: 'audio/webm', durationMillis: 900 })
    expect(await segment?.blob.text()).toBe('encoded')
    expect(amplitudes).toHaveLength(1)
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(disconnectSource).toHaveBeenCalledOnce()
    expect(disconnectAnalyser).toHaveBeenCalledOnce()
    expect(clearAmplitudeTimer).toHaveBeenCalledOnce()
    expect(closeContext).toHaveBeenCalledOnce()
  })

  it('stops acquired tracks if MediaRecorder construction fails', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    const recorder = new BrowserArkmeBackgroundSoundRecorder({
      getUserMedia: async () => stream,
      createMediaRecorder: () => { throw new Error('constructor failed') },
    })

    await expect(recorder.start()).rejects.toThrow('constructor failed')
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it('generation-fences and releases a late microphone grant after cancellation', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    let grant: ((stream: MediaStream) => void) | undefined
    const recorder = new BrowserArkmeBackgroundSoundRecorder({
      getUserMedia: async () => await new Promise<MediaStream>(resolve => { grant = resolve }),
      createMediaRecorder: () => { throw new Error('must not construct after cancel') },
    })

    const start = recorder.start()
    await recorder.cancel()
    grant?.(stream)

    await expect(start).rejects.toThrow('背景音录制已取消')
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it('does not let a late stop completion release a newer recording session', async () => {
    class ControlledMediaRecorder extends EventTarget {
      state: RecordingState = 'inactive'
      readonly mimeType = 'audio/webm'
      constructor(private readonly autoComplete: boolean, private readonly payload: string) { super() }
      start(): void { this.state = 'recording' }
      stop(): void {
        this.state = 'inactive'
        if (this.autoComplete) this.complete()
      }
      complete(): void {
        const dataEvent = new Event('dataavailable')
        Object.defineProperty(dataEvent, 'data', { value: new Blob([this.payload], { type: this.mimeType }) })
        this.dispatchEvent(dataEvent)
        this.dispatchEvent(new Event('stop'))
      }
    }
    const stopTrackA = vi.fn()
    const stopTrackB = vi.fn()
    const streams = [
      { getTracks: () => [{ stop: stopTrackA }] } as unknown as MediaStream,
      { getTracks: () => [{ stop: stopTrackB }] } as unknown as MediaStream,
    ]
    const mediaA = new ControlledMediaRecorder(false, 'late-a')
    const mediaB = new ControlledMediaRecorder(true, 'current-b')
    const media = [mediaA, mediaB]
    const recorder = new BrowserArkmeBackgroundSoundRecorder({
      getUserMedia: async () => streams.shift()!,
      createMediaRecorder: () => media.shift()! as unknown as MediaRecorder,
    })

    await recorder.start()
    const lateStop = recorder.stop()
    await recorder.cancel()
    await recorder.start()
    mediaA.complete()
    await expect(lateStop).resolves.toBeUndefined()

    expect(stopTrackA).toHaveBeenCalledOnce()
    expect(stopTrackB).not.toHaveBeenCalled()
    const current = await recorder.stop()
    expect(await current?.blob.text()).toBe('current-b')
    expect(stopTrackB).toHaveBeenCalledOnce()
  })

  it('uses timesliced recording and stops at the encoded byte ceiling while retaining legal chunks', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    class ChunkedMediaRecorder extends EventTarget {
      state: RecordingState = 'inactive'
      readonly mimeType = 'audio/webm'
      timeslice: number | undefined
      start(timeslice?: number): void { this.timeslice = timeslice; this.state = 'recording' }
      stop(): void { this.state = 'inactive'; this.dispatchEvent(new Event('stop')) }
      emit(payload: string): void {
        const event = new Event('dataavailable')
        Object.defineProperty(event, 'data', { value: new Blob([payload], { type: this.mimeType }) })
        this.dispatchEvent(event)
      }
    }
    const mediaRecorder = new ChunkedMediaRecorder()
    const recorder = new BrowserArkmeBackgroundSoundRecorder({
      getUserMedia: async () => stream,
      createMediaRecorder: () => mediaRecorder as unknown as MediaRecorder,
      mediaRecorderTimesliceMillis: 250,
      maxEncodedBytes: 5,
    })
    const failures: string[] = []
    recorder.subscribeFailure(failure => { failures.push(failure) })

    await recorder.start()
    mediaRecorder.emit('abc')
    mediaRecorder.emit('overflow')
    const segment = await recorder.stop()

    expect(mediaRecorder.timeslice).toBe(250)
    expect(failures).toEqual(['limit-reached'])
    expect(await segment?.blob.text()).toBe('abc')
    expect(segment?.blob.size).toBeLessThanOrEqual(5)
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it('retains the final MediaRecorder chunk when the duration limit is shorter than its timeslice', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    let reachDurationLimit: (() => void) | undefined
    class FinalChunkMediaRecorder extends EventTarget {
      state: RecordingState = 'inactive'
      readonly mimeType = 'audio/webm'
      start(): void { this.state = 'recording' }
      stop(): void {
        if (this.state === 'inactive') return
        this.state = 'inactive'
        const data = new Event('dataavailable')
        Object.defineProperty(data, 'data', { value: new Blob(['final'], { type: this.mimeType }) })
        this.dispatchEvent(data)
        this.dispatchEvent(new Event('stop'))
      }
    }
    const recorder = new BrowserArkmeBackgroundSoundRecorder({
      getUserMedia: async () => stream,
      createMediaRecorder: () => new FinalChunkMediaRecorder() as unknown as MediaRecorder,
      mediaRecorderTimesliceMillis: 1_000,
      maxCaptureDurationMillis: 100,
      setLimitTimer: callback => {
        reachDurationLimit = callback
        return 1 as unknown as ReturnType<typeof globalThis.setTimeout>
      },
      clearLimitTimer: vi.fn(),
    })

    await recorder.start()
    reachDurationLimit?.()
    const segment = await recorder.stop()

    expect(await segment?.blob.text()).toBe('final')
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it('bounds stop itself and releases listeners, tracks, WebAudio and timers when stop never responds', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    const removed = new Map<string, number>()
    class StalledMediaRecorder extends EventTarget {
      state: RecordingState = 'inactive'
      readonly mimeType = 'audio/webm'
      start(): void { this.state = 'recording' }
      stop(): void { /* deliberately never dispatch stop/error */ }
      override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
        removed.set(type, (removed.get(type) ?? 0) + 1)
        super.removeEventListener(type, callback, options)
      }
    }
    const disconnectSource = vi.fn()
    const disconnectAnalyser = vi.fn()
    const closeContext = vi.fn(async () => undefined)
    const clearAmplitudeTimer = vi.fn()
    const clearLimitTimer = vi.fn()
    const context = {
      state: 'running',
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: disconnectSource }),
      createAnalyser: () => ({
        fftSize: 256,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData: vi.fn(),
        disconnect: disconnectAnalyser,
      }),
      close: closeContext,
    } as unknown as AudioContext
    const recorder = new BrowserArkmeBackgroundSoundRecorder({
      getUserMedia: async () => stream,
      createMediaRecorder: () => new StalledMediaRecorder() as unknown as MediaRecorder,
      createAudioContext: () => context,
      stopTimeoutMillis: 10,
      maxCaptureDurationMillis: 60_000,
      setAmplitudeTimer: () => 11 as unknown as ReturnType<typeof globalThis.setInterval>,
      clearAmplitudeTimer,
      setLimitTimer: () => 12 as unknown as ReturnType<typeof globalThis.setTimeout>,
      clearLimitTimer,
    })

    await recorder.start()
    await expect(recorder.stop()).rejects.toThrow('背景音录制结束超时')

    expect(removed.get('stop')).toBeGreaterThanOrEqual(1)
    expect(removed.get('error')).toBeGreaterThanOrEqual(1)
    expect(removed.get('dataavailable')).toBeGreaterThanOrEqual(1)
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(disconnectSource).toHaveBeenCalledOnce()
    expect(disconnectAnalyser).toHaveBeenCalledOnce()
    expect(closeContext).toHaveBeenCalledOnce()
    expect(clearAmplitudeTimer).toHaveBeenCalledOnce()
    expect(clearLimitTimer).toHaveBeenCalledOnce()
  })
})

describe('ArkmeRecordInputCaptureOwner', () => {
  it('keeps construction side-effect free until the committed owner activates', async () => {
    const recorder = new FakeRecorder()
    const unsubscribe = vi.fn()
    const subscribePreference = vi.fn(() => unsubscribe)
    const owner = new ArkmeRecordInputCaptureOwner({
      accountId: 1001,
      recorder,
      subscribeBackgroundSoundPreference: subscribePreference,
    })

    expect(subscribePreference).not.toHaveBeenCalled()
    owner.activate()
    owner.activate()
    expect(subscribePreference).toHaveBeenCalledOnce()
    await owner.dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('survives a StrictMode effect cleanup and setup replay before disposal', async () => {
    const recorder = new FakeRecorder()
    const unsubscribe = vi.fn()
    const subscribePreference = vi.fn(() => unsubscribe)
    const owner = new ArkmeRecordInputCaptureOwner({
      accountId: 1001,
      recorder,
      startDelayMillis: 0,
      backgroundSoundEnabled: () => true,
      subscribeBackgroundSoundPreference: subscribePreference,
    })

    owner.activate()
    owner.deactivate()
    owner.activate()
    await Promise.resolve()
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()

    expect(recorder.startCalls).toBe(1)
    expect(recorder.disposeCalls).toBe(0)
    expect(subscribePreference).toHaveBeenCalledTimes(2)
    owner.deactivate()
    await Promise.resolve()
    await flushLifecycle()
    expect(recorder.disposeCalls).toBe(1)
  })

  it('binds default browser timer receivers instead of crashing the conversation slot', async () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const scheduled: Array<() => void> = []
    const cleared: unknown[] = []
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value: function receiverCheckedSetTimeout(this: unknown, callback: () => void) {
        if (this !== globalThis) throw new TypeError('Illegal invocation')
        scheduled.push(callback)
        return 91 as unknown as ReturnType<typeof globalThis.setTimeout>
      },
    })
    Object.defineProperty(globalThis, 'clearTimeout', {
      configurable: true,
      value: function receiverCheckedClearTimeout(this: unknown, timer: unknown) {
        if (this !== globalThis) throw new TypeError('Illegal invocation')
        cleared.push(timer)
      },
    })
    let owner: ArkmeRecordInputCaptureOwner | undefined
    try {
      owner = createOwner({ recorder: new FakeRecorder() })
      expect(() => {
        owner!.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
      }).not.toThrow()
      expect(scheduled).toHaveLength(1)
      await owner.dispose()
      expect(cleared).toContain(91)
    } finally {
      Object.defineProperty(globalThis, 'setTimeout', { configurable: true, value: originalSetTimeout })
      Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, value: originalClearTimeout })
      await owner?.dispose()
    }

    const source = readFileSync(new URL('../src/client/record-input-capture.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/\?\? globalThis\.(?:setTimeout|clearTimeout|setInterval|clearInterval)(?!\.bind\(globalThis\))/u)
  })

  it('discards active audio when an ineligible server projection force-closes the local owner', async () => {
    const recorder = new FakeRecorder()
    const localStorage = new MemoryStorage()
    const scope = { localStorage }
    setArkmeBackgroundSoundCaptureEnabled(1001, true, scope)
    const owner = new ArkmeRecordInputCaptureOwner({
      accountId: 1001,
      recorder,
      startDelayMillis: 0,
      operationTimeoutMillis: 100,
      backgroundSoundEnabled: () => arkmeBackgroundSoundCaptureEnabled(1001, scope),
      microphoneReady: () => true,
    })
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    recorder.emit(0.7)

    expect(applyArkmeBackgroundSoundOwnerSnapshot(1001, {
      userId: 1001,
      enabled: true,
      found: false,
      eligible: false,
    }, scope)).toBe(true)
    await flushLifecycle()
    await flushLifecycle()

    const result = await owner.finishForSubmit('draft-a')
    expect(result.backgroundSound).toMatchObject({ enabled: false, state: 'disabled', segments: [] })
    expect(recorder.cancelCalls).toBeGreaterThanOrEqual(1)
    await owner.dispose()
  })

  it('does not start from an account preference until this browser has an explicit or persisted grant', async () => {
    const recorder = new FakeRecorder()
    let microphoneReady = false
    let preferenceChanged: (() => void) | undefined
    const owner = new ArkmeRecordInputCaptureOwner({
      accountId: 1001,
      recorder,
      startDelayMillis: 0,
      operationTimeoutMillis: 100,
      backgroundSoundEnabled: () => true,
      microphoneReady: () => microphoneReady,
      subscribeBackgroundSoundPreference: listener => {
        preferenceChanged = listener
        return () => undefined
      },
    })

    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    expect(recorder.startCalls).toBe(0)
    expect(owner.getWaveformSnapshot('draft-a').visible).toBe(false)

    microphoneReady = true
    preferenceChanged?.()
    await flushLifecycle()
    expect(recorder.startCalls).toBe(1)
    await owner.dispose()
  })

  it('requests microphone permission once from the first real input event, never from focus or sync effects', async () => {
    const recorder = new FakeRecorder()
    let microphoneReady = false
    const requestPermission = vi.fn(async (): Promise<'granted'> => {
      microphoneReady = true
      return 'granted'
    })
    const owner = createOwner({
      recorder,
      microphoneReady: () => microphoneReady,
      requestMicrophonePermission: requestPermission,
    })

    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: false })
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(recorder.startCalls).toBe(0)

    owner.beginUserInput('draft-a')
    owner.beginUserInput('draft-a')
    await flushLifecycle()
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(recorder.startCalls).toBe(1)
    await owner.dispose()
  })

  it('latches an input permission denial for the draft while keeping text submission fail-open', async () => {
    const recorder = new FakeRecorder()
    const failures: string[] = []
    const requestPermission = vi.fn(async (): Promise<'granted'> => {
      throw new DOMException('blocked', 'NotAllowedError')
    })
    const owner = createOwner({
      recorder,
      failures,
      microphoneReady: () => false,
      requestMicrophonePermission: requestPermission,
    })

    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    owner.beginUserInput('draft-a')
    owner.beginUserInput('draft-a')
    await flushLifecycle()

    expect(requestPermission).toHaveBeenCalledOnce()
    expect(failures).toEqual(['permission-denied'])
    const result = await owner.finishForSubmit('draft-a')
    expect(result).toMatchObject({
      recordDurationMillis: expect.any(Number),
      backgroundSound: { enabled: true, state: 'denied', segments: [] },
    })
    expect(recorder.startCalls).toBe(0)
    await owner.dispose()
  })

  it('drops a late input permission result after the logical draft is cleared', async () => {
    const recorder = new FakeRecorder()
    let microphoneReady = false
    let grant: (() => void) | undefined
    const owner = createOwner({
      recorder,
      microphoneReady: () => microphoneReady,
      requestMicrophonePermission: async () => await new Promise<'granted'>(resolve => {
        grant = () => { microphoneReady = true; resolve('granted') }
      }),
    })

    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    owner.beginUserInput('draft-a')
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: false })
    grant?.()
    await flushLifecycle()

    expect(recorder.startCalls).toBe(0)
    expect(owner.getStartedAtMillis('draft-a')).toBeUndefined()
    await owner.dispose()
  })

  it('starts and finalizes a delayed capture when the user submits before its timer fires', async () => {
    const recorder = new FakeRecorder()
    const owner = createOwner({ recorder, startDelayMillis: 600 })

    owner.sync({ draftKey: 'quick-submit', isActive: true, hasUserContent: true })
    expect(recorder.startCalls).toBe(0)
    const result = await owner.finishForSubmit('quick-submit')

    expect(recorder.startCalls).toBe(1)
    expect(recorder.stopCalls).toBe(1)
    expect(result.backgroundSound).toMatchObject({ state: 'captured' })
    expect(result.backgroundSound.segments).toHaveLength(1)
    await owner.dispose()
  })

  it('matches desktop input by scheduling an already-granted capture without a debounce delay', async () => {
    const recorder = new FakeRecorder()
    let scheduledDelay = -1
    const owner = new ArkmeRecordInputCaptureOwner({
      accountId: 1001,
      recorder,
      operationTimeoutMillis: 100,
      backgroundSoundEnabled: () => true,
      microphoneReady: () => true,
      subscribeBackgroundSoundPreference: () => () => undefined,
      setTimer: (_callback, delayMillis) => {
        scheduledDelay = delayMillis
        return 91 as never
      },
      clearTimer: () => undefined,
    })

    owner.sync({ draftKey: 'default-delay', isActive: true, hasUserContent: true })
    expect(scheduledDelay).toBe(0)
    await owner.dispose()
  })

  it('waits for an in-flight recorder start before finalizing a quick submit', async () => {
    const recorder = new FakeRecorder()
    let finishStart: (() => void) | undefined
    recorder.startOverride = async () => await new Promise<void>(resolve => { finishStart = resolve })
    const owner = createOwner({ recorder })

    owner.sync({ draftKey: 'starting-submit', isActive: true, hasUserContent: true })
    await flushLifecycle()
    expect(recorder.startCalls).toBe(1)
    const submission = owner.finishForSubmit('starting-submit')
    await Promise.resolve()
    expect(recorder.stopCalls).toBe(0)

    finishStart?.()
    const result = await submission
    expect(recorder.stopCalls).toBe(1)
    expect(result.backgroundSound).toMatchObject({ state: 'captured' })
    expect(result.backgroundSound.segments).toHaveLength(1)
    await owner.dispose()
  })

  it('owns start time, bounded amplitudes, context and submit result for one draft', async () => {
    const recorder = new FakeRecorder()
    let now = 100
    const owner = createOwner({ recorder, now: () => now })

    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: false })
    await flushLifecycle()
    expect(recorder.startCalls).toBe(0)
    expect(owner.getStartedAtMillis('draft-a')).toBeUndefined()

    now = 1_000
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    expect(recorder.startCalls).toBe(1)
    for (let index = 0; index < 45; index += 1) recorder.emit(index / 44)
    expect(owner.getWaveformSnapshot('draft-a')).toMatchObject({ visible: true, recording: true })
    expect(owner.getWaveformSnapshot('draft-a').amplitudes).toHaveLength(40)

    now = 4_500
    const result = await owner.finishForSubmit('draft-a')
    expect(result).toMatchObject({
      schemaVersion: 1,
      captureId: 'capture-test',
      startedAtMillis: 1_000,
      completedAtMillis: 4_500,
      recordDurationMillis: 3_500,
      captureContext: { clientName: 'Test Browser' },
      backgroundSound: { enabled: true, state: 'captured' },
    })
    expect(result.backgroundSound.segments).toHaveLength(1)
    expect(result.backgroundSound.segments[0]?.amplitudes).toHaveLength(40)
    expect(recorder.stopCalls).toBe(1)
    expect(owner.getWaveformSnapshot('draft-a')).toMatchObject({ visible: false, recording: false })
    await owner.dispose()
  })

  it('preserves multiple focus segments while keeping switched drafts isolated', async () => {
    const recorder = new FakeRecorder()
    const owner = createOwner({ recorder })

    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    recorder.emit(0.2)

    owner.sync({ draftKey: 'draft-b', isActive: true, hasUserContent: true })
    await flushLifecycle()
    await flushLifecycle()
    expect(recorder.stopCalls).toBe(1)
    expect(recorder.startCalls).toBe(2)
    recorder.emit(0.8)

    const resultB = await owner.finishForSubmit('draft-b')
    const resultA = await owner.finishForSubmit('draft-a')
    expect(await resultB.backgroundSound.segments[0]?.blob.text()).toBe('segment-2')
    expect(resultB.backgroundSound.amplitudes).toEqual([0.8])
    expect(await resultA.backgroundSound.segments[0]?.blob.text()).toBe('segment-1')
    expect(resultA.backgroundSound.amplitudes).toEqual([0.2])
    await owner.dispose()
  })

  it('evicts the oldest inactive recording when retained draft capacity is reached', async () => {
    const recorder = new FakeRecorder()
    const owner = createOwner({ recorder, maxRetainedDrafts: 2 })

    for (const draftKey of ['draft-a', 'draft-b', 'draft-c']) {
      owner.sync({ draftKey, isActive: true, hasUserContent: true })
      await flushLifecycle()
      await flushLifecycle()
    }

    expect(owner.getStartedAtMillis('draft-a')).toBeUndefined()
    const retained = await owner.finishForSubmit('draft-b')
    expect(await retained.backgroundSound.segments[0]?.blob.text()).toBe('segment-2')
    const evicted = await owner.finishForSubmit('draft-a')
    expect(evicted.backgroundSound.segments).toEqual([])
    expect(evicted.backgroundSound.failure).toBe('retention-evicted')
    await owner.dispose()
  })

  it.each(['preference', 'microphone'] as const)(
    'discards every unsent segment and the active recording when the %s privacy gate closes',
    async gate => {
      const recorder = new FakeRecorder()
      let enabled = true
      let microphoneReady = true
      let preferenceChanged: (() => void) | undefined
      const owner = new ArkmeRecordInputCaptureOwner({
        accountId: 1001,
        recorder,
        startDelayMillis: 0,
        operationTimeoutMillis: 100,
        backgroundSoundEnabled: () => enabled,
        microphoneReady: () => microphoneReady,
        subscribeBackgroundSoundPreference: listener => { preferenceChanged = listener; return () => undefined },
      })

      owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
      await flushLifecycle()
      recorder.emit(0.2)
      owner.sync({ draftKey: 'draft-b', isActive: true, hasUserContent: true })
      await flushLifecycle()
      await flushLifecycle()
      recorder.emit(0.8)

      if (gate === 'preference') enabled = false
      else microphoneReady = false
      preferenceChanged?.()
      await flushLifecycle()
      await flushLifecycle()

      const resultA = await owner.finishForSubmit('draft-a')
      const resultB = await owner.finishForSubmit('draft-b')
      expect(resultA.backgroundSound.segments).toEqual([])
      expect(resultB.backgroundSound.segments).toEqual([])
      expect(recorder.cancelCalls).toBeGreaterThanOrEqual(1)
      expect(owner.getWaveformSnapshot('draft-b')).toMatchObject({ visible: false, recording: false })
      await owner.dispose()
    },
  )

  it('stops a long active input capture at the total duration limit, preserves legal audio and never restarts it', async () => {
    const recorder = new FakeRecorder()
    recorder.stopSegment = {
      blob: new Blob(['legal'], { type: 'audio/webm' }),
      fileName: 'legal.webm',
      mimeType: 'audio/webm',
      durationMillis: 10,
    }
    const failures: string[] = []
    const owner = createOwner({ recorder, failures, maxCaptureDurationMillis: 15 })

    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await new Promise(resolve => { setTimeout(resolve, 35) })
    await flushLifecycle()

    expect(recorder.startCalls).toBe(1)
    expect(recorder.stopCalls).toBe(1)
    expect(failures).toEqual(['limit-reached'])
    expect(owner.getWaveformSnapshot('draft-a')).toMatchObject({
      visible: false,
      recording: false,
      failure: 'limit-reached',
    })
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    expect(recorder.startCalls).toBe(1)

    const result = await owner.finishForSubmit('draft-a')
    expect(result.backgroundSound.failure).toBe('limit-reached')
    expect(await result.backgroundSound.segments[0]?.blob.text()).toBe('legal')
    await owner.dispose()
  })

  it('keeps prior legal segments but rejects a segment that would cross the total encoded byte ceiling', async () => {
    const recorder = new FakeRecorder()
    recorder.stopSegment = {
      blob: new Blob(['1234'], { type: 'audio/webm' }),
      fileName: 'segment.webm',
      mimeType: 'audio/webm',
      durationMillis: 1,
    }
    const failures: string[] = []
    const owner = createOwner({ recorder, failures, maxEncodedBytes: 6 })
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    owner.sync({ draftKey: 'draft-a', isActive: false, hasUserContent: true })
    await flushLifecycle()
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    owner.sync({ draftKey: 'draft-a', isActive: false, hasUserContent: true })
    await flushLifecycle()

    const result = await owner.finishForSubmit('draft-a')
    expect(result.backgroundSound.segments).toHaveLength(1)
    expect(await result.backgroundSound.segments[0]?.blob.text()).toBe('1234')
    expect(failures).toContain('limit-reached')
    await owner.dispose()
  })

  it('detaches a submitted generation before async stop so the same draft key can accept new input', async () => {
    const recorder = new FakeRecorder()
    let now = 100
    let completeStop: ((segment: ArkmeBackgroundSoundRecorderSegment) => void) | undefined
    recorder.stopOverride = async () => await new Promise(resolve => { completeStop = resolve })
    const owner = createOwner({ recorder, now: () => now })
    owner.sync({ draftKey: 'stable-key', isActive: true, hasUserContent: true })
    await flushLifecycle()
    recorder.emit(0.25)

    now = 1_000
    const oldSubmit = owner.finishForSubmit('stable-key')
    await Promise.resolve()
    await Promise.resolve()
    expect(completeStop).toBeTypeOf('function')
    now = 1_200
    owner.sync({ draftKey: 'stable-key', isActive: true, hasUserContent: true })
    expect(owner.getStartedAtMillis('stable-key')).toBe(1_200)

    completeStop?.({
      blob: new Blob(['old-generation'], { type: 'audio/webm' }),
      fileName: 'old.webm',
      mimeType: 'audio/webm',
      durationMillis: 900,
    })
    const oldResult = await oldSubmit
    await flushLifecycle()

    expect(oldResult.startedAtMillis).toBe(100)
    expect(oldResult.backgroundSound.amplitudes).toEqual([0.25])
    expect(await oldResult.backgroundSound.segments[0]?.blob.text()).toBe('old-generation')
    expect(owner.getStartedAtMillis('stable-key')).toBe(1_200)
    expect(recorder.startCalls).toBe(2)
    await owner.dispose()
  })

  it('cancels an empty blurred draft and does not retain its audio', async () => {
    const recorder = new FakeRecorder()
    const owner = createOwner({ recorder })
    owner.sync({ draftKey: 'empty', isActive: true, hasUserContent: false })
    await flushLifecycle()

    owner.sync({ draftKey: 'empty', isActive: false, hasUserContent: false })
    await flushLifecycle()
    const result = await owner.finishForSubmit('empty')

    expect(recorder.startCalls).toBe(0)
    expect(recorder.cancelCalls).toBe(0)
    expect(recorder.stopCalls).toBe(0)
    expect(result.backgroundSound.segments).toEqual([])
    expect(result.recordDurationMillis).toBe(0)
    await owner.dispose()
  })

  it('treats non-empty to empty as a new same-key generation without retaining earlier audio', async () => {
    const recorder = new FakeRecorder()
    let now = 100
    const owner = createOwner({ recorder, now: () => now })
    owner.sync({ draftKey: 'stable-key', isActive: true, hasUserContent: true })
    await flushLifecycle()
    recorder.emit(0.2)

    now = 900
    owner.sync({ draftKey: 'stable-key', isActive: true, hasUserContent: false })
    await flushLifecycle()
    await flushLifecycle()
    now = 1_200
    owner.sync({ draftKey: 'stable-key', isActive: true, hasUserContent: true })
    await flushLifecycle()
    recorder.emit(0.9)

    const result = await owner.finishForSubmit('stable-key')
    expect(result.startedAtMillis).toBe(1_200)
    expect(result.backgroundSound.amplitudes).toEqual([0.9])
    expect(await result.backgroundSound.segments[0]?.blob.text()).toBe('segment-2')
    expect(recorder.cancelCalls).toBeGreaterThanOrEqual(1)
    await owner.dispose()
  })

  it('latches a start failure for one active cycle and retries only after refocus', async () => {
    const recorder = new FakeRecorder()
    recorder.startError = new Error('你未允许浏览器使用麦克风')
    const failures: string[] = []
    const owner = createOwner({ recorder, failures })

    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    expect(recorder.startCalls).toBe(1)
    expect(failures).toEqual(['permission-denied'])
    expect(owner.getWaveformSnapshot('draft-a')).toMatchObject({ visible: false, failure: 'permission-denied' })

    owner.sync({ draftKey: 'draft-a', isActive: false, hasUserContent: true })
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    expect(recorder.startCalls).toBe(2)
    expect(failures).toEqual(['permission-denied', 'permission-denied'])
    await owner.dispose()
  })

  it('fails open when stopping or context collection fails and still disposes the recorder', async () => {
    const recorder = new FakeRecorder()
    recorder.stopError = new Error('stop failed')
    const failures: string[] = []
    const owner = createOwner({
      recorder,
      failures,
      captureContext: async () => { throw new Error('battery unavailable') },
    })
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()

    const result = await owner.finishForSubmit('draft-a')
    expect(result.backgroundSound).toMatchObject({ enabled: true, state: 'failed', segments: [] })
    expect(result.captureContext).toEqual({ clientName: '浏览器（DeepSeek Harness）' })
    expect(failures).toEqual(['stop-failed'])
    await owner.dispose()
    expect(recorder.disposeCalls).toBe(1)
  })

  it('restores an immutable submit capture for retry without sharing its arrays', async () => {
    const recorder = new FakeRecorder()
    const owner = createOwner({ recorder })
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    recorder.emit(0.4)
    const first = await owner.finishForSubmit('draft-a')

    owner.restoreForRetry('retry-a', first)
    const restored = await owner.finishForSubmit('retry-a')
    expect(restored.backgroundSound.amplitudes).toEqual([0.4])
    expect(restored.backgroundSound.segments).not.toBe(first.backgroundSound.segments)
    expect(restored.backgroundSound.segments[0]?.amplitudes).not.toBe(first.backgroundSound.segments[0]?.amplitudes)
    await owner.dispose()
  })

  it('does not overwrite a newer same-key capture when an older send fails', async () => {
    const recorder = new FakeRecorder()
    let now = 100
    const owner = createOwner({ recorder, now: () => now })
    owner.sync({ draftKey: 'stable-key', isActive: true, hasUserContent: true })
    await flushLifecycle()
    recorder.emit(0.2)
    const oldResult = await owner.finishForSubmit('stable-key')

    now = 2_000
    owner.sync({ draftKey: 'stable-key', isActive: true, hasUserContent: true })
    await flushLifecycle()
    recorder.emit(0.9)
    owner.restoreForRetry('stable-key', oldResult)

    expect(owner.getStartedAtMillis('stable-key')).toBe(2_000)
    const newResult = await owner.finishForSubmit('stable-key')
    expect(newResult.backgroundSound.amplitudes).toEqual([0.9])
    expect(await newResult.backgroundSound.segments[0]?.blob.text()).toBe('segment-2')
    await owner.dispose()
  })

  it('never restores captured audio after the background-sound gate has been disabled', async () => {
    const recorder = new FakeRecorder()
    let enabled = true
    const owner = createOwner({ recorder, enabled: () => enabled })
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    await flushLifecycle()
    const failedSend = await owner.finishForSubmit('draft-a')
    expect(failedSend.backgroundSound.segments).toHaveLength(1)

    enabled = false
    owner.restoreForRetry('draft-a', failedSend)
    const restored = await owner.finishForSubmit('draft-a')
    expect(restored.backgroundSound).toMatchObject({ enabled: false, state: 'disabled', segments: [] })
    await owner.dispose()
  })

  it('clears every owner timer during disposal', async () => {
    const recorder = new FakeRecorder()
    let nextTimer = 0
    const timers = new Map<number, () => void>()
    const owner = createOwner({
      recorder,
      setTimer: callback => {
        nextTimer += 1
        timers.set(nextTimer, callback)
        return nextTimer as unknown as ReturnType<typeof globalThis.setTimeout>
      },
      clearTimer: timer => { timers.delete(timer as unknown as number) },
    })
    owner.sync({ draftKey: 'draft-a', isActive: true, hasUserContent: true })
    expect(timers.size).toBe(1)

    await owner.dispose()
    expect(timers.size).toBe(0)
    expect(recorder.disposeCalls).toBe(1)
  })
})

describe('shared input support and coarse capture context', () => {
  it.each(['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic'] as const)(
    'supports %s through the unified record-input owner',
    kind => { expect(arkmeSourceSupportsRecordInputCapture(kind)).toBe(true) },
  )

  it('rejects non-record input sources', () => {
    expect(arkmeSourceSupportsRecordInputCapture('bot_private_chat')).toBe(false)
    expect(arkmeSourceSupportsRecordInputCapture(undefined)).toBe(false)
  })

  it('collects browser, coarse network and battery facts with normalized values', async () => {
    const context = await captureArkmeRecordInputContext({
      userAgent: 'Mozilla/5.0 Chrome/140 Safari/537.36',
      onLine: true,
      connection: { type: 'wifi' },
      getBattery: async () => ({ level: 0.804, charging: false }),
    })
    expect(context).toEqual({
      clientName: 'Google Chrome（DeepSeek Harness）',
      networkName: 'Wi‑Fi',
      electric: 80,
      charge: 2,
    })
  })

  it('keeps submit metadata fail-open when the browser battery API stalls', async () => {
    const context = await captureArkmeRecordInputContext({
      userAgent: 'Firefox/142',
      onLine: false,
      getBattery: async () => await new Promise(() => undefined),
    }, 5)
    expect(context).toEqual({
      clientName: 'Firefox（DeepSeek Harness）',
      networkName: '离线',
    })
  })
})
