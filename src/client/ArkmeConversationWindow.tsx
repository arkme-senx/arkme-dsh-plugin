import { useEffect, useState, useSyncExternalStore } from 'react'
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
 useEffect(() => { arkmeAvatarImages.activateScope(target.accountKey) }, [target.accountKey])
 return <ArkmeSurface productChrome={false} ownsQrLogin={false} />
}
export function ArkmeConversationWindow() {
 useArkmeLocale()
 const bridge = conversationWindowBridge()
 const [target,setTarget] = useState<ConversationWindowTarget>()
 const [error,setError] = useState('')
 useEffect(() => {
  let alive = true
  void (async () => {
   const context = await bridge?.context()
   if (!context) throw new Error('会话窗口已失效，请关闭后重新打开')
   await arkmeAuthStore.refresh()
   if (!await bridge?.active() || conversationAccountKey() !== context.accountKey) throw new Error('账号已切换，请重新打开会话')
   if (!alive) return
   arkmeUi.selectSource(context.source)
   document.title = `${context.source.displayName} · Arkme`
   setTarget(context)
  })().catch(caught => { if (alive) setError(caught instanceof Error ? caught.message : '会话加载失败') })
  const timer = setInterval(() => { void bridge?.active().then(valid => { if (!valid && alive) { setTarget(undefined); setError('会话已失效，请关闭后重新打开') } }).catch(() => {}) },1000)
  return () => { alive = false; clearInterval(timer) }
 },[bridge])
 // Internal links must not silently turn this window into another conversation.
 useEffect(() => {
  if (!target) return
  return arkmeUi.subscribe(() => {
   const ui = arkmeUi.getSnapshot()
   if (ui.mode !== 'source' || !ui.selectedSource || arkmeSourceIdentityKey(ui.selectedSource) !== target.sourceKey) arkmeUi.selectSource(target.source)
  })
 },[target])
 return <section data-arkme-owned="conversation-window" style={{position:'fixed',inset:0,display:'flex',flexDirection:'column',background:arkmeTheme.base,color:arkmeTheme.text}}>
  <div style={{position:'relative',flex:1,minHeight:0}}>{target ? <ConversationContent target={target}/> : <div role={error ? 'alert' : 'status'} style={{padding:24}}>{error || tr('正在加载会话…')}</div>}</div>
 </section>
}
