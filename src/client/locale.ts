import { useSyncExternalStore } from 'react'
import { arkmeEnglish } from './locales/en.js'
import { mobileEnglish } from './locales/mobile-en.js'
import { actionEnglish } from './locales/actions-en.js'
import { dynamicEnglish } from './locales/dynamic-en.js'

export type ArkmeLocale = 'zh' | 'en'
interface LocaleSource {
  getLocale(): { active: string }
  subscribe(listener: () => void): () => void
}

let active: ArkmeLocale = 'zh'
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getArkmeLocale = (): ArkmeLocale => active

/** One language owner: the Harness preference. No second persisted preference,
 * component remount, network translation, or access to user-authored content. */
export function connectArkmeLocale(source: LocaleSource): () => void {
  const sync = () => {
    const next = source.getLocale().active === 'en' ? 'en' : 'zh'
    if (next === active) return
    active = next
    for (const listener of listeners) listener()
  }
  const stop = source.subscribe(sync)
  sync()
  return stop
}

export function useArkmeLocale(): ArkmeLocale {
  return useSyncExternalStore(subscribe, getArkmeLocale, getArkmeLocale)
}

/** For application-owned copy only. Never pass messages, names or transcripts. */
export function tr(source: string, values?: Record<string, string | number>): string {
  const translated = active === 'en' ? arkmeEnglish[source] ?? mobileEnglish[source] ?? actionEnglish[source] ?? dynamicEnglish[source] ?? source : source
  return values === undefined ? translated : translated.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match)
}

export const arkmeIntlLocale = (): string => active === 'en' ? 'en-US' : 'zh-CN'

export const calendarWeekdays = (): readonly string[] => active === 'en'
  ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  : ['一', '二', '三', '四', '五', '六', '日']

/** Static copy can be retained in tables without freezing the active language. */
export function uiLabel(source: string): string { return tr(source) }
