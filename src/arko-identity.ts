import type { ArkmeArkoPersona, ArkmeArkoProfile } from './types.js'

/**
 * In 即我 the local Harness agent and the cloud assistant are one assistant:
 * Arko, under whatever name the user gave it in the cloud. This module keeps
 * the last known Arko profile for the signed-in account and states that
 * identity, with the user's 「Arko 偏好」 (tone, how to address them, about
 * them), first in the system prompt on every model step. The wording comes
 * from the cloud so both ends say the same thing; the local wording below is
 * only the offline fallback and must match the cloud's identity sentences.
 */
export const ARKO_IDENTITY_DEFAULT_NAME = 'Arko'
export const ARKO_IDENTITY_SECTION = 'arkme:arko-identity'
/** Mirrors `HARNESS_IDENTITY` in dsh-system-prompt, which this section replaces. */
export const ARKO_IDENTITY_FALLBACK_ORDER = -1000
const MAX_NAME_LENGTH = 32

/** The cloud returns the legacy default "Agent" at version 0 for never-renamed accounts. */
export function arkoIdentityName(profile: ArkmeArkoProfile | undefined): string {
  const name = (profile?.displayName ?? '').replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
  if (name === '' || (profile?.version === 0 && name === 'Agent')) return ARKO_IDENTITY_DEFAULT_NAME
  return name.length <= MAX_NAME_LENGTH ? name : name.slice(0, MAX_NAME_LENGTH).trimEnd()
}

/** Kept short and stable: it is sent on every step and a change costs a prompt-cache miss. */
export function arkoIdentityPrompt(name: string): string {
  return [
    `In 即我 (Arkme) you are ${name}, the user's personal AI assistant.`,
    `${name} is one assistant across the user's phone and computers: in the 即我 app ${name} works in the cloud, and here ${name} works on this computer with the user's files and tools.`,
    `When the user asks who you are or what your name is, answer as ${name}. Do not call yourself DeepSeek Harness, DSH or an agent powered by DeepSeek Harness; name the underlying model only when the user asks which model you run on.`,
  ].join(' ')
}

/** Upper bound for cloud-rendered text; the cloud caps it far lower. */
const MAX_PERSONA_PROMPT_LENGTH = 8000

/** Cloud text is used as-is unless it is empty, oversized or carries a NUL. */
export function arkoPersonaPrompt(prompt: string): string | undefined {
  const text = prompt.trim()
  if (text === '' || text.length > MAX_PERSONA_PROMPT_LENGTH || text.includes('\u0000')) return undefined
  return text
}

/** Last known Arko profile and cloud wording per signed-in account; never blocks the prompt on a network read. */
export class ArkoIdentityHolder {
  private userId: number | undefined
  private profile: ArkmeArkoProfile | undefined
  private persona: { version: number; prompt: string } | undefined

  current(): string { return arkoIdentityName(this.profile) }

  /** The cloud wording for the current profile version, else the local identity for the current name. */
  prompt(): string {
    const persona = this.persona
    if (persona !== undefined && this.profile !== undefined && persona.version === this.profile.version) return persona.prompt
    return arkoIdentityPrompt(this.current())
  }

  /** The version of the known profile for the active account; -1 before one arrives. */
  knownVersion(): number { return this.profile?.version ?? -1 }

  /** A different account starts from the default until its own profile arrives. */
  activate(userId: number | undefined): void {
    const next = userId !== undefined && Number.isSafeInteger(userId) && userId > 0 ? userId : undefined
    if (next === this.userId) return
    this.userId = next
    this.profile = undefined
    this.persona = undefined
  }

  /** Accepts a profile read for the active account; an older version never wins. */
  accept(userId: number, profile: ArkmeArkoProfile): boolean {
    if (userId !== this.userId) return false
    if (this.profile !== undefined && profile.version < this.profile.version) return false
    this.profile = { ...profile }
    return true
  }

  /** Accepts a profile with its cloud wording; wording for an older version than the known profile is dropped. */
  acceptPersona(userId: number, persona: ArkmeArkoPersona): boolean {
    if (!this.accept(userId, persona.profile)) return false
    const prompt = arkoPersonaPrompt(persona.prompt)
    this.persona = prompt === undefined ? undefined : { version: persona.profile.version, prompt }
    return true
  }
}

export interface ArkoIdentityPorts {
  currentUserId(): Promise<number | undefined>
  readPersona(signal: AbortSignal): Promise<ArkmeArkoPersona>
  onProfile(listener: (userId: number, profile: ArkmeArkoProfile) => void): () => void
  onAccountChange(listener: () => void): () => void
}

interface ArkoIdentitySection {
  name: string
  order: number
  interpolate?: boolean
  text: () => string
}

export interface ArkoIdentityContext {
  systemPrompt: {
    section(section: ArkoIdentitySection): unknown
    getSectionOrder?(name: string): number
  }
  effect(execute: () => () => void, label?: string): unknown
  on?(name: 'session/event', listener: (session: unknown, event: { type?: unknown } | undefined) => void, options?: { global?: boolean }): unknown
}

/** Background refresh, so a change made on the phone reaches an idle computer. */
export const ARKO_IDENTITY_REFRESH_MILLIS = 2 * 60_000
/** A new local turn re-reads the profile at most this often. */
export const ARKO_IDENTITY_TURN_REFRESH_MILLIS = 20_000

/**
 * States the Arko identity and preferences first in every local agent's
 * system prompt. The text is read synchronously on each model step, so a
 * change takes effect on the next step of every open session without
 * restarting the Harness. Each new local turn also re-reads the profile, so
 * a change made on the phone usually applies from the next reply.
 */
export function registerArkoIdentity(
  ctx: ArkoIdentityContext,
  ports: ArkoIdentityPorts,
  refreshMillis = ARKO_IDENTITY_REFRESH_MILLIS,
  turnRefreshMillis = ARKO_IDENTITY_TURN_REFRESH_MILLIS,
): ArkoIdentityHolder {
  const holder = new ArkoIdentityHolder()
  let order = ARKO_IDENTITY_FALLBACK_ORDER
  try { order = ctx.systemPrompt.getSectionOrder?.('HARNESS_IDENTITY') ?? order } catch { /* Older registries keep the documented slot. */ }
  ctx.systemPrompt.section({
    name: ARKO_IDENTITY_SECTION,
    order,
    // The name and preferences are user-chosen text; they must never be read as a template.
    interpolate: false,
    text: () => holder.prompt(),
  })
  let onTurn: (() => void) | undefined
  ctx.on?.('session/event', (_session, event) => {
    if (event?.type === 'turn/start') onTurn?.()
  }, { global: true })
  ctx.effect(() => {
    let generation = 0
    let refreshing = false
    let lastRefreshAt = Number.NEGATIVE_INFINITY
    let controller: AbortController | undefined
    const refresh = async () => {
      const token = ++generation
      lastRefreshAt = Date.now()
      refreshing = true
      controller?.abort()
      const current = new AbortController()
      controller = current
      try {
        const userId = await ports.currentUserId().catch(() => undefined)
        if (token !== generation) return
        holder.activate(userId)
        if (userId === undefined) return
        try {
          const persona = await ports.readPersona(current.signal)
          if (token === generation) holder.acceptPersona(userId, persona)
        } catch { /* Offline or signed out: keep the last known identity. */ }
      } finally {
        if (token === generation) refreshing = false
      }
    }
    onTurn = () => { if (Date.now() - lastRefreshAt >= turnRefreshMillis) void refresh() }
    // A newer profile seen elsewhere in this host (a rename in the cloud chat)
    // applies at once; its cloud wording follows. The persona read itself also
    // publishes the profile, so reads in flight never trigger another one.
    const stopProfile = ports.onProfile((userId, profile) => {
      const before = holder.knownVersion()
      if (holder.accept(userId, profile) && profile.version > before && !refreshing) void refresh()
    })
    const stopAccount = ports.onAccountChange(() => { void refresh() })
    const timer = setInterval(() => { void refresh() }, refreshMillis)
    ;(timer as { unref?: () => void }).unref?.()
    void refresh()
    return () => {
      generation++
      onTurn = undefined
      controller?.abort()
      clearInterval(timer)
      stopAccount()
      stopProfile()
    }
  }, 'dsh-arkme: Arko identity and preferences for the local agent')
  return holder
}
