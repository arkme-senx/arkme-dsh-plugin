import { createRoot } from 'react-dom/client'
import { registerConversationWindowRoot } from '../../src/client/conversation-window-root.js'
import { createElement } from 'react'
import { ArkmeSurface } from '../../src/client/ArkmeSidebar.js'
import { installArkmeRedesignStyles } from '../../src/client/redesign/styles.js'
import { arkmeAuthStore } from '../../src/client/auth-store.js'
import { arkmeUi } from '../../src/client/ui-controller.js'
import { arkmeChatDirectory } from '../../src/client/chat-directory-store.js'
import { arkmeComposerDraftStore, arkmeSourceComposerDraftKey } from '../../src/client/composer-draft-store.js'
import { bindConversationWindows, withConversationSend } from '../../src/client/conversation-window-sync.js'
import { openConversationWindow } from '../../src/client/conversation-window.js'
import type { ArkmeSourceItem } from '../../src/types.js'
const sources: ArkmeSourceItem[] = [
 {kind:'private_chat',sourceRef:'private-A',sourceKey:'chat:A',displayName:'张三',activeAtMillis:Date.now(),unreadCount:0,latestSequence:1,latestPreview:"测试消息"},
 {kind:'group_chat',sourceRef:'group-B',sourceKey:'chat:B',displayName:'产品讨论群',activeAtMillis:Date.now(),unreadCount:0,latestSequence:1,latestPreview:"测试消息"},
 {kind:'send_to_self',sourceRef:'self-C',displayName:'我发给自己',activeAtMillis:Date.now(),unreadCount:0,latestSequence:1,latestPreview:"测试消息"},
]
installArkmeRedesignStyles()
arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42})
arkmeChatDirectory.activateAccount('test:42'); arkmeChatDirectory.publish(sources)
bindConversationWindows()
Object.assign(window, {
 smokeOpen: (index: number) => openConversationWindow(sources[index]!),
 smokeSelect: (index: number) => arkmeUi.selectSource(sources[index]!),
 smokeDraft: (index: number, text: string) => arkmeComposerDraftStore.setText(arkmeSourceComposerDraftKey(42,sources[index]),text),
 smokeRead: (index: number) => arkmeComposerDraftStore.get(arkmeSourceComposerDraftKey(42,sources[index])).text,
 smokeSend: (index: number) => withConversationSend(arkmeSourceComposerDraftKey(42,sources[index]),async consumed => {
  const key = arkmeSourceComposerDraftKey(42,sources[index]); const text = arkmeComposerDraftStore.get(key).text;
  if (!text) return; arkmeComposerDraftStore.clear(key); await consumed(); await fetch('/smoke-send',{method:'POST',body:JSON.stringify({text,index})})
 }),
 smokeSelected: () => arkmeUi.getSnapshot().selectedSource?.kind,
 smokeSources: sources,
})
if (location.search.includes('arkmeConversation=1')) {
 // Exercise the same registration and component as the production root slot.
 registerConversationWindowRoot({
  effect: (run: () => unknown) => run(),
  slots: { register: (options: {name: string; priority: number}, Component: any) => {
   if (options.name !== 'root' || options.priority !== -100) throw new Error('Expected native root replacement')
   createRoot(document.getElementById('root')!).render(createElement(Component))
  } },
 } as any)
}
else { arkmeUi.selectSource(sources[0]!); createRoot(document.getElementById('root')!).render(<ArkmeSurface />) }
