// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { GroupMemberRow, GroupMembersDrawer } from '../src/client/ArkmeGroupChatControls.js'
import { MessageAvatar } from '../src/client/ArkmeSidebar.js'
import { ArkmeTimelineDetailDrawer, arkmeTimelineDetailSenderText } from '../src/client/ArkmeNoteDetails.js'
import { ArkmeActionMenu } from '../src/client/ArkmeDshMenu.js'
import { inMenuHoverRegion } from '../src/client/menu-hover-region.js'
import type { ArkmeConversationMemberItem, ArkmeTimelineItem } from '../src/types.js'

const member: ArkmeConversationMemberItem = { memberRef:'member-ref', mentionRef:'mention-ref', displayName:'何宏顺', memberName:'1D3E',
  role:'member', status:'active', isSelf:false, isOwner:false, joinedAtMillis:1, recordCount:7, mentionCount:2 }
const item: ArkmeTimelineItem = { itemUid:'item', memberRef:member.memberRef, senderName:'1D3E', isMe:false, sendAtMillis:1,
  status:1, title:'', textContent:'快记正文', contentBlocks:[], quickNoteDetailsSupported:false }
let host:HTMLDivElement, root:Root
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); host=document.createElement('div');document.body.append(host);root=createRoot(host) })
afterEach(async () => { await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();window.localStorage.clear() })
function pointer(target:Element, type:string, pointerType='mouse', x=0, y=0) {
  const event=new MouseEvent(type,{bubbles:true,clientX:x,clientY:y,buttons:0});Object.defineProperty(event,'pointerType',{value:pointerType});target.dispatchEvent(event)
}
it('uses only the matching member display name and preserves bot and unknown-sender identity', () => {
  expect(arkmeTimelineDetailSenderText(item,[member])).toBe('何宏顺')
  expect(arkmeTimelineDetailSenderText({...item,memberRef:'other'},[member])).toBe('1D3E')
  expect(arkmeTimelineDetailSenderText({...item,senderKind:'bot'},[member])).toBe('1D3E')
  expect(arkmeTimelineDetailSenderText(item,[{...member,displayName:'群成员'}])).toBe('1D3E')
})
it('renders author and close in the same header, without a duplicate title or nickname', async () => {
  await act(async()=>root.render(<ArkmeTimelineDetailDrawer item={item} conversationMembers={[member]} showOriginal={false} onClose={()=>{}} onToggleOriginal={()=>{}} />))
  expect(host.querySelector('header')?.textContent).toContain('何宏顺')
  expect(host.querySelector('header')?.textContent).not.toContain('1D3E')
  expect(host.querySelector('header h3')).toBeNull()
  expect(host.querySelectorAll('[data-arkme-detail-author]')).toHaveLength(1)
  expect(host.querySelector('header [aria-label="关闭详情"]')).not.toBeNull()
  expect(host.textContent).toContain('快记正文')
})
it.each(['row','avatar'])('%s opens hover actions only for a mouse, retaining click, right click and keyboard',async kind=>{
  const hover=vi.fn(),open=vi.fn(),context=vi.fn()
  await act(async()=>root.render(kind==='row'?<GroupMemberRow member={member} onMemberOpen={open} onMemberContextMenu={context} onMemberHover={hover}/>
    :<MessageAvatar member={member} profileEnabled onOpen={open} onContextMenu={context} onHover={hover}/>))
  const button=host.querySelector('button')!
  await act(async()=>pointer(button,'pointerover','touch'));expect(hover).not.toHaveBeenCalled()
  await act(async()=>pointer(button,'pointerover'));expect(hover).toHaveBeenCalledOnce();expect(hover.mock.calls[0]?.[1]).toBe(button)
  expect(open).not.toHaveBeenCalled();expect(context).not.toHaveBeenCalled()
  await act(async()=>button.click());expect(open).toHaveBeenCalledWith(member)
  await act(async()=>button.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})));expect(context).toHaveBeenCalledOnce()
  await act(async()=>button.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));expect(context).toHaveBeenCalledTimes(2)
})
it('renames and resizes the group member drawer without reusing note width storage',async()=>{
  window.localStorage.setItem('arkme:note-detail-width:v1','500')
  Object.defineProperty(host,'clientWidth',{value:1000})
  await act(async()=>root.render(<GroupMembersDrawer source={{sourceRef:'group',kind:'group_chat',displayName:'测试群',activeAtMillis:1,unreadCount:0}}
    accountScope={undefined} open onClose={()=>{}} onAdd={()=>{}} onMemberOpen={()=>{}} onMemberContextMenu={()=>{}} onError={()=>{}}/>))
  const panel=host.querySelector<HTMLElement>('[aria-label="群成员"]')!,handle=host.querySelector('[aria-label="调整群成员宽度"]')!
  expect(panel.style.width).toBe('262px');expect(panel.textContent).toContain('群成员');expect(panel.textContent).not.toContain('协作者')
  await act(async()=>handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true})))
  expect(panel.style.width).toBe('282px');expect(window.localStorage.getItem('arkme:group-members-width:v1')).toBe('282')
  expect(window.localStorage.getItem('arkme:note-detail-width:v1')).toBe('500')
})
it('keeps the trigger-to-menu crossing gap active, but not surrounding empty space',()=>{
  const anchor={left:722,right:950,top:100,bottom:164},menu={left:500,right:718,top:100,bottom:228}
  expect(inMenuHoverRegion(720,132,anchor,menu)).toBe(true)
  expect(inMenuHoverRegion(720,200,anchor,menu)).toBe(false)
  expect(inMenuHoverRegion(600,132,anchor,menu)).toBe(true)
  expect(inMenuHoverRegion(800,132,anchor,menu)).toBe(true)
  expect(inMenuHoverRegion(400,132,anchor,menu)).toBe(false)
})
it('dismisses a real portaled menu immediately outside the hover union, without stealing focus',async()=>{
  const close=vi.fn(),anchor=document.createElement('button');document.body.append(anchor);anchor.focus()
  vi.spyOn(anchor,'getBoundingClientRect').mockReturnValue(new DOMRect(722,100,228,64))
  await act(async()=>root.render(<ArkmeActionMenu label="hover-menu" hoverAnchor={anchor} point={{x:718,y:96}} align="end" onClose={close}
    actions={[{id:'view',label:'看TA的快记',onSelect:vi.fn()}]}/>))
  const menu=document.querySelector<HTMLElement>('[role="menu"]')!
  vi.spyOn(menu,'getBoundingClientRect').mockReturnValue(new DOMRect(500,100,218,128))
  expect(document.activeElement).toBe(anchor)
  for(const x of [800,720,600]) await act(async()=>pointer(document.body,'pointermove','mouse',x,132))
  expect(close).not.toHaveBeenCalled()
  await act(async()=>pointer(document.body,'pointermove','mouse',400,132));expect(close).toHaveBeenCalledOnce()
  await act(async()=>root.render(null));anchor.remove()
})
it('retries keyboard focus after the native portal finishes its hidden measurement', async () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  let afterPlacement: FrameRequestCallback | undefined
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { afterPlacement = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const nativeFocus = HTMLElement.prototype.focus
  let hidden = true
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options) {
    if (!hidden) nativeFocus.call(this, options)
  })
  await act(async () => root.render(<ArkmeActionMenu autoFocus label="keyboard-menu" point={{ x: 300, y: 100 }} onClose={() => {}}
    actions={[{ id: 'view', label: '看TA的快记', onSelect: () => {} }]} />))
  expect(document.activeElement).toBe(trigger)
  expect(afterPlacement).toBeDefined()
  hidden = false
  await act(async () => afterPlacement?.(0))
  expect(document.querySelector('[role="menu"]')?.contains(document.activeElement)).toBe(true)
  await act(async () => root.render(null))
  trigger.remove()
})
