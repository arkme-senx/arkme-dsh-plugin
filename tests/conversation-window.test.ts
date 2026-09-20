import {afterEach, describe, expect, it, vi} from 'vitest'
import {conversationWindowTarget, openConversationWindow} from '../src/client/conversation-window.js'
import {ArkmeComposerDraftStore} from '../src/client/composer-draft-store.js'
import {connectConversationDrafts} from '../src/client/conversation-window-sync.js'
afterEach(() => vi.unstubAllGlobals())
const source = {kind:'private_chat', sourceKey:'chat:1', sourceRef:'signed', displayName:'张三'} as any
describe('conversation window entry', () => {
 it('accepts only the approved types and stable identities', () => {
  for (const kind of ['private_chat','group_chat','send_to_self']) expect(conversationWindowTarget('prod:7', {...source,kind})?.source.kind).toBe(kind)
  for (const kind of ['arko','bot','agent','topic']) expect(conversationWindowTarget('prod:7', {...source,kind})).toBeUndefined()
 })
 it('reports an unsupported shell without changing navigation', async () => {
  await expect(openConversationWindow(source)).rejects.toThrow('客户端')
 })
})
it('synchronizes text, attachments and clears by key without echo or deleting other drafts', async () => {
 const a = new ArkmeComposerDraftStore(), b = new ArkmeComposerDraftStore(); const listeners = new Map<number, Function>(); const states = new Map();
 const bridge = (id: number): any => ({snapshot: async () => [...states.values()], onEvent: (fn: Function) => {listeners.set(id,fn); return () => listeners.delete(id)}, publish: async (event: any) => {states.set(event.key,event); for (const [key, fn] of listeners) if(key !== id) fn(event); return true}})
 const key = 'arkme-composer:7:source:private_chat:chat%3A1';
 const stopA = await connectConversationDrafts(bridge(1),a,7,'prod:7'), stopB = await connectConversationDrafts(bridge(2),b,7,'prod:7');
 a.setText(key,'hello'); expect(b.get(key).text).toBe('hello');
 b.setText('arkme-composer:7:source:group_chat:chat%3A2','group');
 a.clear(key); expect(b.get(key).text).toBe(''); expect(b.get('arkme-composer:7:source:group_chat:chat%3A2').text).toBe('group');
 stopA(); stopB();
})
it('replicates replacement and removal of a cached long-article card', async () => {
 const {ComposerArticleStore} = await import('../src/client/composer-article-store.js')
 const a = new ArkmeComposerDraftStore(), b = new ArkmeComposerDraftStore(), aa = new ComposerArticleStore(), bb = new ComposerArticleStore()
 const listeners = new Map<number,Function>(); const states = new Map()
 const bridge = (id:number): any => ({snapshot:async()=>[...states.values()],onEvent:(fn:Function)=>{listeners.set(id,fn);return()=>listeners.delete(id)},publish:async(event:any)=>{states.set(event.key,event);for(const [k,fn] of listeners)if(k!==id)fn(event);return true}})
 const key='test:42:arkme-composer:42:source:private_chat:chat%3A1'
 const article=(name:string):any=>({kind:'existing',detail:{sourceRef:'ref',title:name,textContent:name},messageActionRef:name})
 const stopA=await connectConversationDrafts(bridge(1),a,42,'test:42',aa),stopB=await connectConversationDrafts(bridge(2),b,42,'test:42',bb)
 aa.set(key,article('A')); expect(bb.get(key)?.article).toEqual(aa.get(key)?.article)
 aa.set(key,article('B')); expect(bb.get(key)?.article).toEqual(aa.get(key)?.article)
 bb.remove(key); expect(aa.get(key)).toBeUndefined(); stopA();stopB()
})
it('does not republish a broker snapshot as a new local edit on window startup', async () => {
 const store = new ArkmeComposerDraftStore()
 const key = 'arkme-composer:7:source:private_chat:chat%3A1'
 const publish=vi.fn(async()=>true)
 const bridge:any={snapshot:async()=>[{kind:'draft',key,value:{text:'authoritative',attachments:[],mentions:[],emojis:[]}}],onEvent:()=>()=>{},publish}
 const stop=await connectConversationDrafts(bridge,store,7,'prod:7')
 expect(store.get(key).text).toBe('authoritative');expect(publish).not.toHaveBeenCalled();stop()
})

describe('navigation from a conversation window', () => {
 async function setupNavigation() {
  const {arkmeAuthStore} = await import('../src/client/auth-store.js')
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42})
  vi.stubGlobal('location',{search:'?arkmeConversation=1'})
  const bridge = {version:1,account:vi.fn(async()=>false),context:vi.fn(async()=>({accountKey:'test:42'})),active:vi.fn(async()=>true),open:vi.fn(async()=>true),focusMain:vi.fn(async()=>true)}
  vi.stubGlobal('arkmeConversation',bridge)
  return bridge
 }
 it('opens another window without attempting to own the account', async () => {
  const bridge = await setupNavigation()
  await openConversationWindow(source)
  expect(bridge.account).not.toHaveBeenCalled()
  expect(bridge.open).toHaveBeenCalledWith(expect.objectContaining({accountKey:'test:42',source}))
 })
 it('falls back to the target conversation in main if native opening fails', async () => {
  const bridge = await setupNavigation(); bridge.open.mockRejectedValue(new Error('native failure'))
  const {navigateConversationWindow} = await import('../src/client/conversation-window.js')
  await expect(navigateConversationWindow(source)).resolves.toEqual({destination:'main',reason:'native failure'})
  expect(bridge.focusMain).toHaveBeenCalledWith(expect.objectContaining({source}))
 })
 it('reports failure when both destinations fail', async () => {
  const bridge = await setupNavigation(); bridge.open.mockResolvedValue(false); bridge.focusMain.mockResolvedValue(false)
  const {navigateConversationWindow} = await import('../src/client/conversation-window.js')
  await expect(navigateConversationWindow(source)).rejects.toThrow('主窗口')
 })
 it('never redirects an expired account window', async () => {
  const bridge = await setupNavigation(); bridge.active.mockResolvedValue(false)
  const {navigateConversationWindow} = await import('../src/client/conversation-window.js')
  await expect(navigateConversationWindow(source)).rejects.toThrow()
  expect(bridge.open).not.toHaveBeenCalled(); expect(bridge.focusMain).not.toHaveBeenCalled()
 })
})
