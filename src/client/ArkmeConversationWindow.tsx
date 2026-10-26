import { validConversationWindowBootstrap } from './conversation-window-bootstrap.js'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeSurface } from './ArkmeSidebar.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeAvatarImages } from './avatar-image-runtime.js'
import { useArkmeRealtimeClientEvents } from './realtime-client-events.js'
import { conversationAccountKey, conversationWindowBridge, type ConversationWindowTarget } from './conversation-window.js'
import { arkmeSourceIdentityKey } from './source-identity.js'
import { tr, useArkmeLocale } from './locale.js'
function ConversationContent({target}: {target: ConversationWindowTarget}) {
 const auth = useSyncExternalStore(arkmeAuthStore.subscribe,arkmeAuthStore.getSnapshot,arkmeAuthStore.getSnapshot).auth
 useArkmeRealtimeClientEvents(auth,0,false,{ownsMessagePreparing:true,ownsNotifications:false})
 return <ArkmeSurface productChrome={false} ownsQrLogin={false} conversationBootstrap={target.bootstrap} />
}
export function ArkmeConversationWindow() {
 useArkmeLocale()
 const bridge = conversationWindowBridge()
 const [target,setTarget] = useState<ConversationWindowTarget>()
 const [error,setError] = useState('')
 const [syncError,setSyncError] = useState(false)
 const retryAuth = useRef<() => void>(() => {})
 useEffect(() => {
  let alive = true
  let current: ConversationWindowTarget | undefined
  const invalidate = () => {
   if (!alive) return
   current = undefined
   setTarget(undefined)
   setSyncError(false)
   setError('账号或会话已失效，请重新打开会话')
  }
  const refresh = async () => {
   const context = current
   if (!context || !alive) return
   setSyncError(false)
   try {
    await arkmeAuthStore.refresh()
    if (!alive || current !== context) return
    if (!await bridge?.active() || conversationAccountKey() !== context.accountKey) { invalidate(); return }
   } catch { if (alive && current === context) setSyncError(true) }
  }
  retryAuth.current = () => { void refresh() }
  void (async () => {
   const context = await bridge?.context()
   if (!context || !await bridge?.active()) throw new Error('会话窗口已失效，请关闭后重新打开')
   if (!alive) return
   const bootstrap = context.bootstrap
   const existing = conversationAccountKey()
   const seeded = validConversationWindowBootstrap(bootstrap, context.accountKey, context.sourceKey)
    && (existing === null || existing === context.accountKey)
   if (seeded) arkmeAuthStore.restoreWindowSession(bootstrap.auth, bootstrap.config)
   else await arkmeAuthStore.refresh()
   if (!alive) return
   if (!await bridge?.active() || conversationAccountKey() !== context.accountKey) throw new Error('账号已切换，请重新打开会话')
   if (!alive) return
   // Install the scope and warm bytes before mounting any message/avatar subscribers.
   arkmeAvatarImages.activateScope(context.accountKey)
   if (seeded && bootstrap.content?.avatars) arkmeAvatarImages.restore?.(context.accountKey, bootstrap.content.avatars)
   current = context
   arkmeUi.selectSource(context.source)
   document.title = `${context.source.displayName} · Arkme`
   setTarget(seeded ? context : {accountKey: context.accountKey, sourceKey: context.sourceKey, source: context.source})
   // The first paint uses the trusted local seed. Refresh failure must not discard it.
   if (seeded) void refresh()
  })().catch(caught => { if (alive) setError(caught instanceof Error ? caught.message : '会话加载失败') })
  const stopAuth = arkmeAuthStore.subscribe(() => {
   if (current && conversationAccountKey() !== current.accountKey) invalidate()
  })
  const timer = setInterval(() => { void bridge?.active().then(valid => { if (!valid) invalidate() }).catch(() => {}) },1000)
  return () => { alive = false; current = undefined; retryAuth.current = () => {}; stopAuth(); clearInterval(timer) }
 },[bridge])
 // Internal links must not silently turn this window into another conversation.
 useEffect(() => {
  if (!target) return
  return arkmeUi.subscribe(() => {
   const ui = arkmeUi.getSnapshot()
   if (ui.mode !== 'source' || !ui.selectedSource || arkmeSourceIdentityKey(ui.selectedSource) !== target.sourceKey) arkmeUi.selectSource(target.source)
  })
 },[target])
 return <section data-arkme-owned="conversation-window" data-arkme-workspace style={{position:'fixed',inset:0,display:'flex',flexDirection:'column',background:arkmeTheme.base}}>
  {target && syncError && <div role="alert" style={{padding:'8px 16px',fontSize:12}}>
   {tr('同步失败，已有内容仍可阅读')} <button type="button" onClick={() => retryAuth.current()}>{tr('重试')}</button>
  </div>}
  <div style={{position:'relative',flex:1,minHeight:0}}>{target ? <ConversationContent target={target}/> : <div role={error ? 'alert' : 'status'} style={{padding:24}}>{error || tr('正在加载会话…')}</div>}</div>
 </section>
}
