import { arkmeChatDirectory } from '../src/client/chat-directory-store.js'
import { reactionNotifications } from '../src/client/reaction-notifications.js'
import { ArkmeRootChatPreview } from '../src/client/ArkmeVirtualWorkspace.js'
import { act, create } from 'react-test-renderer'
import { describe, it, expect, vi } from 'vitest'
import { ArkmeReactionNotificationPreview, latestReactionPreview } from '../src/client/ArkmeReactionNotification.js'
const { open, rows } = vi.hoisted(() => ({open:vi.fn(), rows:[{itemUid:'old',recordOwnerUserId:1,sendAtMillis:10,text:'原消息',selections:[{expression:{emoji:'surprised_face',hand:'thumb_up',text:'稳了'},at:1}]}]}))
vi.mock('../src/client/auth-store.js',()=>{const state={auth:undefined};return {arkmeAuthStore:{subscribe:()=>()=>{},getSnapshot:()=>state}}})
vi.mock('../src/client/reaction-notifications.js',()=>({reactionNotifications:{subscribe:()=>()=>{},getSnapshot:()=>0,startHighlights:vi.fn(),highlights:()=>undefined,forSource:()=>rows,beginViewing:vi.fn()}}))
vi.mock('../src/client/ui-controller.js',()=>({arkmeUi:{showConversationTarget:open}}))
describe('reaction notice presentation',()=>{
 it('cannot reopen a conversation through its reminder while removal is pending',()=>{
  open.mockClear()
  let ui!:ReturnType<typeof create>
  act(()=>{ui=create(<ArkmeReactionNotificationPreview source={{sourceKey:'chat',sourceRef:'signed',unreadCount:0} as never} disabled />)})
  const button=ui.root.findByType('button')
  expect(button.props.disabled).toBe(true)
  act(()=>button.props.onClick({stopPropagation(){}}))
  expect(open).not.toHaveBeenCalled()
  act(()=>ui.unmount())
 })
 it('renders the original face and gesture assets, and locates without marking read',()=>{
  let ui!:ReturnType<typeof create>
  const source={sourceKey:'chat',sourceRef:'signed',unreadCount:0} as never
  act(()=>{ui=create(<ArkmeReactionNotificationPreview source={source}/> )})
  expect(ui.root.findAllByType('img')).toHaveLength(2)
  expect(JSON.stringify(ui.toJSON())).toContain('原消息')
  act(()=>ui.root.findByType('button').props.onClick({stopPropagation(){}}))
  expect(open).toHaveBeenCalledWith(source,'old',10,1,undefined,true)
  act(()=>ui.unmount())
 })

 it('shows one latest preview for three actors on one message and keeps the next message after viewing it',()=>{
  const initial=rows.slice();let ui!:ReturnType<typeof create>
  const make=(uid:string,at:number,text:string)=>({...initial[0]!,itemUid:uid,text,selections:[{...initial[0]!.selections[0]!,at}]})
  try {
   rows.splice(0,rows.length,make('same',1,'共同消息'),make('same',2,'共同消息'),make('same',3,'共同消息'),make('other',0.5,'另一条消息'))
   act(()=>{ui=create(<ArkmeReactionNotificationPreview source={{sourceKey:'chat',sourceRef:'signed',unreadCount:0} as never}/>)})
   expect(ui.root.findAllByType('button')).toHaveLength(1)
   expect(ui.root.findByType('button').props['aria-label']).toContain('共同消息')
   rows.splice(0,3)
   act(()=>ui.update(<ArkmeReactionNotificationPreview source={{sourceKey:'chat',sourceRef:'signed',unreadCount:0} as never}/>))
   expect(ui.root.findByType('button').props['aria-label']).toContain('另一条消息')
  } finally {act(()=>ui?.unmount());rows.splice(0,rows.length,...initial)}
 })
})

 it('keeps ordinary unread messages ahead of even newer reactions without clearing the inbox', () => {
  const old = { ...rows[0]!, selections: [{ ...rows[0]!.selections[0]!, at: 100 }] }
  const fresh = { ...old, selections: [{ ...old.selections[0]!, at: 300 }] }
  const inbox = [old, fresh] as never
  expect(latestReactionPreview(inbox, 1)).toBeUndefined()
  expect(latestReactionPreview(inbox, 20)).toBeUndefined()
  expect(latestReactionPreview(inbox, 0, true)).toBeUndefined()
  expect(latestReactionPreview(inbox, 0)).toBe(fresh)
  expect(latestReactionPreview([old] as never, 0)).toBe(old)
  expect(latestReactionPreview([], 0)).toBeUndefined()
  expect(inbox).toEqual([old, fresh])
 })

 it('shows reactions only after ordinary messages are read and restores message priority on another arrival', () => {
  let ui!: ReturnType<typeof create>
  const source = { sourceKey: 'chat', sourceRef: 'signed', kind: 'group_chat', displayName: '群', unreadCount: 1, badgeUnreadCount: 0, isMuted: true, activeAtMillis: 200, latestPreview: '最新普通消息' } as const
  const pending = vi.spyOn(arkmeChatDirectory, 'hasOptimisticRead').mockReturnValue(false)
  const begin = vi.mocked(reactionNotifications.beginViewing)
  begin.mockClear()
  try {
   act(() => { ui = create(<ArkmeRootChatPreview source={source} />) })
   expect(ui.root.findAllByProps({ 'data-arkme-reaction-notice': true })).toHaveLength(0)
   expect(JSON.stringify(ui.toJSON())).toContain('最新普通消息')
   pending.mockReturnValue(true)
   act(() => ui.update(<ArkmeRootChatPreview source={{ ...source, unreadCount: 0 }} />))
   expect(ui.root.findAllByProps({ 'data-arkme-reaction-notice': true })).toHaveLength(0)
   pending.mockReturnValue(false)
   act(() => ui.update(<ArkmeRootChatPreview source={{ ...source, unreadCount: 0 }} />))
   expect(ui.root.findAllByProps({ 'data-arkme-reaction-notice': true })).toHaveLength(1)
   expect(begin).not.toHaveBeenCalled()
   act(() => ui.update(<ArkmeRootChatPreview source={{ ...source, activeAtMillis: 300, latestPreview: '又来一条消息' }} />))
   expect(ui.root.findAllByProps({ 'data-arkme-reaction-notice': true })).toHaveLength(0)
   expect(JSON.stringify(ui.toJSON())).toContain('又来一条消息')
   expect(begin).not.toHaveBeenCalled()
  } finally { act(() => ui?.unmount()); pending.mockRestore() }
 })
