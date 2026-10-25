import type { ArkmeTeam } from '../types.js'
import type { WorldPublishOrigin } from '../world-publish-source.js'
import { isNativeForwardCaller } from './native-forward-entry.js'
export interface WorldPublishRequest { accountKey: string; origin: WorldPublishOrigin }
type Presenter = (request: WorldPublishRequest, signal?: AbortSignal) => void
const key = '__arkmeWorldPublishEntry'
type Host = Window & { [key]?: { open(request: WorldPublishRequest, signal: AbortSignal | undefined, caller: Window): void } }
let presenter: Presenter | undefined
let preferredTeam: { accountKey: string; team: ArkmeTeam } | undefined
export function rememberWorldPublishTeam(accountKey: string, team?: ArkmeTeam) { preferredTeam = team ? { accountKey, team } : undefined }
export function takeWorldPublishTeam(accountKey: string) {
  const value = preferredTeam; preferredTeam = undefined
  return value?.accountKey === accountKey ? value.team : undefined
}
export function registerWorldPublish(next: Presenter) {
  presenter = next
  const host = window as Host
  const entry = { open(request: WorldPublishRequest, signal: AbortSignal | undefined, caller: Window) {
    if (host[key] !== entry || !isNativeForwardCaller(host, caller)) throw new Error('对话已切换，请重新选择')
    signal?.throwIfAborted(); next(request, signal)
  } }
  host[key] = entry
  return () => { if (presenter === next) presenter = undefined; if (host[key] === entry) delete host[key] }
}
export function openWorldPublish(request: WorldPublishRequest, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (presenter) return presenter(request, signal)
  const caller = window, entry = (caller.parent as Host)[key]
  if (caller.parent === caller || !entry) throw new Error('发布页面尚未就绪，请稍后重试')
  entry.open(request, signal, caller)
}
