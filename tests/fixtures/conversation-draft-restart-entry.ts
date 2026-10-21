import { arkmeAuthStore } from '../../src/client/auth-store.js'
import '../../src/client/composer-draft-auth-binding.js'
import { arkmeComposerDraftStore } from '../../src/client/composer-draft-store.js'
import { bindConversationWindows } from '../../src/client/conversation-window-sync.js'
import { conversationWindowBridge } from '../../src/client/conversation-window.js'
const userId = Number(new URLSearchParams(location.search).get('user') ?? 42)
arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId})
bindConversationWindows()
const key = (suffix: string) => `arkme-composer:${userId}:${suffix}`
Object.assign(window, {
 draftRead: (suffix: string) => arkmeComposerDraftStore.get(key(suffix)),
 draftWrite: (suffix: string, text: string) => arkmeComposerDraftStore.setText(key(suffix),text),
 draftClear: (suffix: string) => arkmeComposerDraftStore.clear(key(suffix)),
 draftReady: async () => { await new Promise(resolve=>setTimeout(resolve,50)); return conversationWindowBridge()?.snapshot(`test:${userId}`) },
})
