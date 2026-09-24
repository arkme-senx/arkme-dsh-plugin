import { act, create } from 'react-test-renderer'
import { describe, it, expect, vi } from 'vitest'
import { ArkmeReactionNotificationPreview } from '../src/client/ArkmeReactionNotification.js'
const { open, rows } = vi.hoisted(() => ({open:vi.fn(), rows:[{itemUid:'old',recordOwnerUserId:1,sendAtMillis:10,text:'原消息',selections:[{expression:{emoji:'surprised_face',hand:'thumb_up',text:'稳了'},at:1}]}]}))
vi.mock('../src/client/auth-store.js',()=>{const state={auth:undefined};return {arkmeAuthStore:{subscribe:()=>()=>{},getSnapshot:()=>state}}})
vi.mock('../src/client/reaction-notifications.js',()=>({reactionNotifications:{subscribe:()=>()=>{},getSnapshot:()=>0,startHighlights:vi.fn(),highlights:()=>undefined,forSource:()=>rows,beginViewing:vi.fn()}}))
vi.mock('../src/client/ui-controller.js',()=>({arkmeUi:{showConversationTarget:open}}))
describe('reaction notice presentation',()=>{
 it('renders the original face and gesture assets, and locates without marking read',()=>{
  let ui!:ReturnType<typeof create>
  const source={sourceKey:'chat'} as never
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
   rows.splice(0,rows.length,make('same',1,'共同消息'),make('same',2,'共同消息'),make('same',3,'共同消息'),make('other',0,'另一条消息'))
   act(()=>{ui=create(<ArkmeReactionNotificationPreview source={{sourceKey:'chat'} as never}/>)})
   expect(ui.root.findAllByType('button')).toHaveLength(1)
   expect(ui.root.findByType('button').props['aria-label']).toContain('共同消息')
   rows.splice(0,3)
   act(()=>ui.update(<ArkmeReactionNotificationPreview source={{sourceKey:'chat'} as never}/>))
   expect(ui.root.findByType('button').props['aria-label']).toContain('另一条消息')
  } finally {act(()=>ui?.unmount());rows.splice(0,rows.length,...initial)}
 })
})
