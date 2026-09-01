export type ArkmeRequestLane = 'auth' | 'interactive-read' | 'background-read' | 'write' | 'image'

export type ArkmeRequestService =
  | 'auth'
  | 'chat'
  | 'record'
  | 'data'
  | 'audio'
  | 'world'
  | 'relation'
  | 'intelligent'
  | 'webrtc'
  | 'extension'
  | 'oss'
  | 'other'

export interface ArkmeRequestLimit {
  maxConcurrent: number
  ratePerSecond: number
  burst: number
  maxQueued: number
}

export interface ArkmeRequestCoordinatorOptions {
  laneLimits?: Partial<Record<ArkmeRequestLane, Partial<ArkmeRequestLimit>>>
  serviceLimits?: Partial<Record<ArkmeRequestService, Partial<ArkmeRequestLimit>>>
  defaultServiceLimit?: Partial<ArkmeRequestLimit>
  now?: () => number
  random?: () => number
}

export interface ArkmeCoordinatedRequest<T> {
  scope: string
  lane: ArkmeRequestLane
  service: ArkmeRequestService
  /** Omit for mutations and other calls that must never be coalesced. */
  key?: string
  cacheMs?: number
  failureCooldownMs?: number
  bypassCache?: boolean
  signal?: AbortSignal
  clone?: (value: T) => T
  shouldCooldown?: (error: unknown) => boolean
  /** Optional service-wide cooldown, for example Retry-After from 429/503. */
  serviceCooldownMs?: (error: unknown) => number
  operation(signal: AbortSignal): Promise<T>
}

export interface ArkmeRequestStats {
  started: number
  joined: number
  cacheHits: number
  cooldownSkips: number
  staleDropped: number
  queueRejected: number
}

interface ResolvedLimit extends ArkmeRequestLimit {
  active: number
  tokens: number
  lastRefillAt: number
  cooldownUntil: number
}

interface QueuedPermit {
  lane: ArkmeRequestLane
  service: ArkmeRequestService
  sequence: number
  signal: AbortSignal
  resolve(release: () => void): void
  reject(error: unknown): void
  abort(): void
}

interface CacheEntry {
  value: unknown
  expiresAt: number
  epoch: number
}

interface FailureEntry {
  error: unknown
  retryAt: number
  epoch: number
}

interface InFlightEntry {
  promise: Promise<unknown>
  controller: AbortController
  epoch: number
}

const DEFAULT_LANE_LIMITS: Record<ArkmeRequestLane, ArkmeRequestLimit> = {
  auth: { maxConcurrent: 1, ratePerSecond: 4, burst: 4, maxQueued: 16 },
  'interactive-read': { maxConcurrent: 4, ratePerSecond: 6, burst: 10, maxQueued: 128 },
  'background-read': { maxConcurrent: 2, ratePerSecond: 2, burst: 4, maxQueued: 256 },
  write: { maxConcurrent: 4, ratePerSecond: 5, burst: 8, maxQueued: 128 },
  image: { maxConcurrent: 4, ratePerSecond: 8, burst: 12, maxQueued: 256 },
}

const DEFAULT_SERVICE_LIMIT: ArkmeRequestLimit = { maxConcurrent: 6, ratePerSecond: 8, burst: 12, maxQueued: 512 }

const LANE_PRIORITY: Record<ArkmeRequestLane, number> = {
  auth: 0,
  write: 1,
  'interactive-read': 2,
  'background-read': 3,
  image: 4,
}

export class ArkmeStaleRequestError extends Error {
  constructor() {
    super('Arkme request result belongs to a stale account generation')
    this.name = 'ArkmeStaleRequestError'
  }
}

export class ArkmeRequestQueueOverflowError extends Error {
  constructor(readonly lane: ArkmeRequestLane, readonly service: ArkmeRequestService) {
    super(`Arkme request queue is full for ${lane}:${service}`)
    this.name = 'ArkmeRequestQueueOverflowError'
  }
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.trunc(positiveNumber(value, fallback)))
}

function resolveLimit(base: ArkmeRequestLimit, patch: Partial<ArkmeRequestLimit> | undefined, now: number): ResolvedLimit {
  const burst = positiveNumber(patch?.burst, base.burst)
  return {
    maxConcurrent: positiveInteger(patch?.maxConcurrent, base.maxConcurrent),
    ratePerSecond: positiveNumber(patch?.ratePerSecond, base.ratePerSecond),
    burst,
    maxQueued: positiveInteger(patch?.maxQueued, base.maxQueued),
    active: 0,
    tokens: burst,
    lastRefillAt: now,
    cooldownUntil: 0,
  }
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason
  const error = new Error('Arkme request was aborted')
  error.name = 'AbortError'
  return error
}

function normalizedDuration(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.trunc(value))
}

function requestStatKey(lane: ArkmeRequestLane, service: ArkmeRequestService): string {
  return `${lane}:${service}`
}

/**
 * Host-owned request coalescing and admission control.
 *
 * It joins only explicitly keyed reads. Unkeyed mutations are independently
 * admitted through the same lane/service budgets and are never deduplicated.
 */
export class ArkmeRequestCoordinator {
  private readonly now: () => number
  private readonly random: () => number
  private readonly laneLimits = new Map<ArkmeRequestLane, ResolvedLimit>()
  private readonly serviceLimits = new Map<ArkmeRequestService, ResolvedLimit>()
  private readonly queue: QueuedPermit[] = []
  private readonly cache = new Map<string, CacheEntry>()
  private readonly failures = new Map<string, FailureEntry>()
  private readonly inFlight = new Map<string, InFlightEntry>()
  private readonly activeControllersByScope = new Map<string, Set<AbortController>>()
  private readonly epochs = new Map<string, number>()
  private readonly stats = new Map<string, ArkmeRequestStats>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private sequence = 0

  constructor(options: ArkmeRequestCoordinatorOptions = {}) {
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    const now = this.now()
    for (const lane of Object.keys(DEFAULT_LANE_LIMITS) as ArkmeRequestLane[]) {
      this.laneLimits.set(lane, resolveLimit(DEFAULT_LANE_LIMITS[lane], options.laneLimits?.[lane], now))
    }
    for (const service of [
      'auth', 'chat', 'record', 'data', 'audio', 'world', 'relation', 'intelligent', 'webrtc', 'extension', 'oss', 'other',
    ] as ArkmeRequestService[]) {
      const base = {
        maxConcurrent: positiveInteger(options.defaultServiceLimit?.maxConcurrent, DEFAULT_SERVICE_LIMIT.maxConcurrent),
        ratePerSecond: positiveNumber(options.defaultServiceLimit?.ratePerSecond, DEFAULT_SERVICE_LIMIT.ratePerSecond),
        burst: positiveNumber(options.defaultServiceLimit?.burst, DEFAULT_SERVICE_LIMIT.burst),
        maxQueued: positiveInteger(options.defaultServiceLimit?.maxQueued, DEFAULT_SERVICE_LIMIT.maxQueued),
      }
      this.serviceLimits.set(service, resolveLimit(base, options.serviceLimits?.[service], now))
    }
  }

  async run<T>(request: ArkmeCoordinatedRequest<T>): Promise<T> {
    const scope = request.scope.trim() || 'public'
    const epoch = this.epoch(scope)
    const key = request.key?.trim()
    if (key === undefined || key === '') {
      if (request.signal?.aborted === true) throw abortError(request.signal.reason)
      const controller = new AbortController()
      const abort = () => { controller.abort(request.signal?.reason) }
      request.signal?.addEventListener('abort', abort, { once: true })
      try {
        return await this.execute(request, scope, epoch, controller)
      } finally {
        request.signal?.removeEventListener('abort', abort)
      }
    }
    const fullKey = `${scope}\u0000${key}`
    const now = this.now()
    const clone = request.clone ?? ((value: T) => value)
    const cached = this.cache.get(fullKey)
    if (request.bypassCache !== true && cached !== undefined && cached.epoch === epoch && cached.expiresAt > now) {
      this.bump(request, 'cacheHits')
      return clone(cached.value as T)
    }
    const failure = this.failures.get(fullKey)
    if (failure !== undefined && failure.epoch === epoch && failure.retryAt > now) {
      this.bump(request, 'cooldownSkips')
      throw failure.error
    }
    const existing = this.inFlight.get(fullKey)
    if (existing !== undefined && existing.epoch === epoch) {
      this.bump(request, 'joined')
      return await this.joinCaller(existing.promise as Promise<T>, request.signal).then(clone)
    }
    const controller = new AbortController()
    const cacheMs = normalizedDuration(request.cacheMs)
    const failureCooldownMs = normalizedDuration(request.failureCooldownMs)
    const { signal: _callerSignal, ...sharedRequest } = request
    let promise: Promise<T>
    promise = this.execute(sharedRequest, scope, epoch, controller)
      .then(value => {
        if (this.epoch(scope) !== epoch) {
          this.bump(request, 'staleDropped')
          throw new ArkmeStaleRequestError()
        }
        if (this.inFlight.get(fullKey)?.promise !== promise) return value
        this.failures.delete(fullKey)
        if (cacheMs > 0) this.cache.set(fullKey, { value: clone(value), expiresAt: this.now() + cacheMs, epoch })
        return value
      })
      .catch(error => {
        if (this.epoch(scope) === epoch
          && this.inFlight.get(fullKey)?.promise === promise
          && failureCooldownMs > 0
          && (request.shouldCooldown?.(error) ?? true)) {
          const jitter = 0.9 + this.random() * 0.2
          this.failures.set(fullKey, {
            error,
            retryAt: this.now() + Math.max(1, Math.round(failureCooldownMs * jitter)),
            epoch,
          })
        }
        throw error
      })
      .finally(() => {
        if (this.inFlight.get(fullKey)?.promise === promise) this.inFlight.delete(fullKey)
      })
    this.inFlight.set(fullKey, { promise, controller, epoch })
    return await this.joinCaller(promise, request.signal).then(clone)
  }

  /** Hard account/lifecycle invalidation. Old completions cannot populate the new scope. */
  invalidateScope(scopeInput: string): void {
    const scope = scopeInput.trim() || 'public'
    this.epochs.set(scope, this.epoch(scope) + 1)
    const prefix = `${scope}\u0000`
    for (const key of this.cache.keys()) if (key.startsWith(prefix)) this.cache.delete(key)
    for (const key of this.failures.keys()) if (key.startsWith(prefix)) this.failures.delete(key)
    for (const [key, entry] of this.inFlight) {
      if (!key.startsWith(prefix)) continue
      entry.controller.abort(new ArkmeStaleRequestError())
      this.inFlight.delete(key)
    }
    for (const controller of this.activeControllersByScope.get(scope) ?? []) {
      controller.abort(new ArkmeStaleRequestError())
    }
  }

  invalidateKey(scopeInput: string, keyPrefix: string): void {
    const scope = scopeInput.trim() || 'public'
    const prefix = `${scope}\u0000${keyPrefix}`
    for (const key of this.cache.keys()) if (key.startsWith(prefix)) this.cache.delete(key)
    for (const key of this.failures.keys()) if (key.startsWith(prefix)) this.failures.delete(key)
    // Detach rather than abort: existing callers keep their result while future callers start fresh.
    for (const key of this.inFlight.keys()) if (key.startsWith(prefix)) this.inFlight.delete(key)
  }

  snapshotStats(): Record<string, ArkmeRequestStats> {
    return Object.fromEntries([...this.stats].map(([key, value]) => [key, { ...value }]))
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    for (const entry of this.inFlight.values()) entry.controller.abort()
    this.inFlight.clear()
    for (const controllers of this.activeControllersByScope.values()) {
      for (const controller of controllers) controller.abort()
    }
    this.activeControllersByScope.clear()
    for (const queued of this.queue.splice(0)) queued.abort()
  }

  private epoch(scope: string): number {
    return this.epochs.get(scope) ?? 0
  }

  private async execute<T>(
    request: ArkmeCoordinatedRequest<T>,
    scope: string,
    epoch: number,
    controller = new AbortController(),
  ): Promise<T> {
    const controllers = this.activeControllersByScope.get(scope) ?? new Set<AbortController>()
    controllers.add(controller)
    this.activeControllersByScope.set(scope, controllers)
    let release: (() => void) | undefined
    try {
      release = await this.acquire(request.lane, request.service, controller.signal)
      this.bump(request, 'started')
      if (controller.signal.aborted) throw abortError(controller.signal.reason)
      if (this.epoch(scope) !== epoch) throw new ArkmeStaleRequestError()
      let value: T
      try {
        value = await request.operation(controller.signal)
      } catch (error) {
        const cooldownMs = normalizedDuration(request.serviceCooldownMs?.(error))
        if (cooldownMs > 0) {
          const service = this.serviceLimits.get(request.service)!
          service.cooldownUntil = Math.max(service.cooldownUntil, this.now() + cooldownMs)
        }
        throw error
      }
      if (this.epoch(scope) !== epoch) {
        this.bump(request, 'staleDropped')
        throw new ArkmeStaleRequestError()
      }
      return value
    } finally {
      release?.()
      controllers.delete(controller)
      if (controllers.size === 0 && this.activeControllersByScope.get(scope) === controllers) {
        this.activeControllersByScope.delete(scope)
      }
    }
  }

  private async joinCaller<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (signal === undefined) return await promise
    if (signal.aborted) throw abortError(signal.reason)
    return await new Promise<T>((resolve, reject) => {
      const abort = () => { reject(abortError(signal.reason)) }
      signal.addEventListener('abort', abort, { once: true })
      void promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
    })
  }

  private acquire(
    lane: ArkmeRequestLane,
    service: ArkmeRequestService,
    signal: AbortSignal,
  ): Promise<() => void> {
    if (signal.aborted) return Promise.reject(abortError(signal.reason))
    const laneLimit = this.laneLimits.get(lane)!
    const serviceLimit = this.serviceLimits.get(service)!
    const laneQueued = this.queue.reduce((count, item) => count + (item.lane === lane ? 1 : 0), 0)
    const serviceQueued = this.queue.reduce((count, item) => count + (item.service === service ? 1 : 0), 0)
    if (laneQueued >= laneLimit.maxQueued || serviceQueued >= serviceLimit.maxQueued) {
      const error = new ArkmeRequestQueueOverflowError(lane, service)
      const stats = this.stats.get(requestStatKey(lane, service))
        ?? { started: 0, joined: 0, cacheHits: 0, cooldownSkips: 0, staleDropped: 0, queueRejected: 0 }
      stats.queueRejected += 1
      this.stats.set(requestStatKey(lane, service), stats)
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      let queued: QueuedPermit
      const abort = () => {
        const index = this.queue.indexOf(queued)
        if (index >= 0) this.queue.splice(index, 1)
        signal.removeEventListener('abort', abort)
        reject(abortError(signal.reason))
      }
      queued = { lane, service, sequence: this.sequence++, signal, resolve, reject, abort }
      signal.addEventListener('abort', abort, { once: true })
      this.queue.push(queued)
      this.queue.sort((left, right) => LANE_PRIORITY[left.lane] - LANE_PRIORITY[right.lane]
        || left.sequence - right.sequence)
      this.drain()
    })
  }

  private drain(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    let selected = this.nextRunnableIndex()
    while (selected >= 0) {
      const [queued] = this.queue.splice(selected, 1)
      if (queued === undefined) break
      queued.signal.removeEventListener('abort', queued.abort)
      const lane = this.laneLimits.get(queued.lane)!
      const service = this.serviceLimits.get(queued.service)!
      this.refill(lane)
      this.refill(service)
      lane.tokens = Math.max(0, lane.tokens - 1)
      service.tokens = Math.max(0, service.tokens - 1)
      lane.active += 1
      service.active += 1
      let released = false
      queued.resolve(() => {
        if (released) return
        released = true
        lane.active = Math.max(0, lane.active - 1)
        service.active = Math.max(0, service.active - 1)
        this.drain()
      })
      selected = this.nextRunnableIndex()
    }
    this.scheduleNextDrain()
  }

  private nextRunnableIndex(): number {
    for (let index = 0; index < this.queue.length; index += 1) {
      const queued = this.queue[index]
      if (queued === undefined) continue
      if (queued.signal.aborted) {
        this.queue.splice(index, 1)
        index -= 1
        continue
      }
      const lane = this.laneLimits.get(queued.lane)!
      const service = this.serviceLimits.get(queued.service)!
      this.refill(lane)
      this.refill(service)
      if (lane.active < lane.maxConcurrent && service.active < service.maxConcurrent
        && this.now() >= lane.cooldownUntil && this.now() >= service.cooldownUntil
        && lane.tokens >= 1 && service.tokens >= 1) return index
    }
    return -1
  }

  private refill(limit: ResolvedLimit): void {
    const now = this.now()
    if (now <= limit.lastRefillAt) return
    limit.tokens = Math.min(limit.burst, limit.tokens + ((now - limit.lastRefillAt) / 1000) * limit.ratePerSecond)
    limit.lastRefillAt = now
  }

  private scheduleNextDrain(): void {
    if (this.queue.length === 0 || this.timer !== undefined) return
    let delay = Number.POSITIVE_INFINITY
    for (const queued of this.queue) {
      const lane = this.laneLimits.get(queued.lane)!
      const service = this.serviceLimits.get(queued.service)!
      this.refill(lane)
      this.refill(service)
      if (lane.active >= lane.maxConcurrent || service.active >= service.maxConcurrent) continue
      const now = this.now()
      delay = Math.min(delay, Math.max(
        this.tokenDelay(lane),
        this.tokenDelay(service),
        lane.cooldownUntil - now,
        service.cooldownUntil - now,
      ))
    }
    if (!Number.isFinite(delay)) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.drain()
    }, Math.max(1, Math.ceil(delay)))
  }

  private tokenDelay(limit: ResolvedLimit): number {
    if (limit.tokens >= 1) return 0
    return ((1 - limit.tokens) / limit.ratePerSecond) * 1000
  }

  private bump(request: Pick<ArkmeCoordinatedRequest<unknown>, 'lane' | 'service'>, field: keyof ArkmeRequestStats): void {
    const key = requestStatKey(request.lane, request.service)
    const current = this.stats.get(key)
      ?? { started: 0, joined: 0, cacheHits: 0, cooldownSkips: 0, staleDropped: 0, queueRejected: 0 }
    current[field] += 1
    this.stats.set(key, current)
  }
}
