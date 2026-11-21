import type { ArkmeArkoProfile } from './types.js'

/**
 * In 即我 the local Harness agent and the cloud assistant are one assistant:
 * Arko, under whatever name the user gave it in the cloud. This module keeps
 * the last known name for the signed-in account and words the system-prompt
 * section that states that identity on every model step.
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

/** Last known Arko name per signed-in account; never blocks the prompt on a network read. */
export class ArkoIdentityHolder {
  private userId: number | undefined
  private profile: ArkmeArkoProfile | undefined

  current(): string { return arkoIdentityName(this.profile) }

  /** A different account starts from the default until its own profile arrives. */
  activate(userId: number | undefined): void {
    const next = userId !== undefined && Number.isSafeInteger(userId) && userId > 0 ? userId : undefined
    if (next === this.userId) return
    this.userId = next
    this.profile = undefined
  }

  /** Accepts a profile read for the active account; an older version never wins. */
  accept(userId: number, profile: ArkmeArkoProfile): boolean {
    if (userId !== this.userId) return false
    if (this.profile !== undefined && profile.version < this.profile.version) return false
    this.profile = { ...profile }
    return true
  }
}

export interface ArkoIdentityPorts {
  currentUserId(): Promise<number | undefined>
  readProfile(signal: AbortSignal): Promise<ArkmeArkoProfile>
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
}

export const ARKO_IDENTITY_REFRESH_MILLIS = 15 * 60_000

/**
 * States the Arko identity first in every local agent's system prompt. The
 * text is read synchronously on each model step, so a rename takes effect on
 * the next step of every open session without restarting the Harness.
 */
export function registerArkoIdentity(ctx: ArkoIdentityContext, ports: ArkoIdentityPorts, refreshMillis = ARKO_IDENTITY_REFRESH_MILLIS): ArkoIdentityHolder {
  const holder = new ArkoIdentityHolder()
  let order = ARKO_IDENTITY_FALLBACK_ORDER
  try { order = ctx.systemPrompt.getSectionOrder?.('HARNESS_IDENTITY') ?? order } catch { /* Older registries keep the documented slot. */ }
  ctx.systemPrompt.section({
    name: ARKO_IDENTITY_SECTION,
    order,
    // The name is user-chosen text; it must never be read as a template.
    interpolate: false,
    text: () => arkoIdentityPrompt(holder.current()),
  })
  ctx.effect(() => {
    let generation = 0
    let controller: AbortController | undefined
    const refresh = async () => {
      const token = ++generation
      controller?.abort()
      const current = new AbortController()
      controller = current
      const userId = await ports.currentUserId().catch(() => undefined)
      if (token !== generation) return
      holder.activate(userId)
      if (userId === undefined) return
      try {
        const profile = await ports.readProfile(current.signal)
        if (token === generation) holder.accept(userId, profile)
      } catch { /* Offline or signed out: keep the last known name. */ }
    }
    const stopProfile = ports.onProfile((userId, profile) => { holder.accept(userId, profile) })
    const stopAccount = ports.onAccountChange(() => { void refresh() })
    const timer = setInterval(() => { void refresh() }, refreshMillis)
    ;(timer as { unref?: () => void }).unref?.()
    void refresh()
    return () => {
      generation++
      controller?.abort()
      clearInterval(timer)
      stopAccount()
      stopProfile()
    }
  }, 'dsh-arkme: Arko identity for the local agent')
  return holder
}
