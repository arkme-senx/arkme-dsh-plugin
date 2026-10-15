import type { BaiduMap, BaiduMaps, BaiduPoint } from './baidu-map.js'

export interface LocationMapSession {
  account: string; key: string; element: HTMLDivElement
  map?: BaiduMap; sdk?: BaiduMaps
  scope?: string
  points: Map<string, BaiduPoint>
  ready: boolean; initialized: boolean; interacted: boolean; fitted: boolean; active: boolean; disposed: boolean
  timer?: ReturnType<typeof setTimeout> | undefined
}
let retained: LocationMapSession | undefined
function dispose(session: LocationMapSession) {
  if (session.disposed) return
  session.disposed = true; clearTimeout(session.timer); session.map?.destroy(); session.element.remove(); session.points.clear()
  if (retained === session) retained = undefined
}
/** Retain one detached Baidu canvas for five minutes; never move an actively displayed map. */
export function acquireLocationMapSession(account: string, key: string): LocationMapSession {
  if (retained && (retained.account !== account || retained.key !== key)) dispose(retained)
  if (retained && !retained.active) { clearTimeout(retained.timer); retained.active = true; return retained }
  const element = document.createElement('div'); element.style.cssText = 'position:absolute;inset:0'
  const session: LocationMapSession = { account, key, element, points: new Map(), ready: false, initialized: false, interacted: false, fitted: false, active: true, disposed: false }
  if (!retained) retained = session
  return session
}
export function releaseLocationMapSession(session: LocationMapSession): void {
  session.active = false; session.element.remove()
  if (retained !== session) { dispose(session); return }
  session.timer = setTimeout(() => dispose(session), 300_000)
}
export function resetLocationMapSessions(account?: string): void {
  if (retained && retained.account !== account) dispose(retained)
}
export function discardLocationMapSession(session: LocationMapSession): void { dispose(session) }
