// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const { call, suspend } = vi.hoisted(() => ({ call: vi.fn(), suspend: vi.fn(() => vi.fn()) }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/read-intent-visibility.js', () => ({ suspendArkmeVisibleReadIntent: suspend }))
vi.mock('../src/client/ArkmeRichContent.js', () => ({ ArkmeMessageContent: ({item}: any) => <span>{item.text}</span> }))
vi.mock('../src/client/ArkoImageAttachments.js', () => ({ ArkoMessageImages: () => null }))
vi.mock('../src/client/WindowedTimelineRows.js', () => ({ WindowedTimelineRows: ({children}: any) => <>{children}</> }))
vi.mock('../src/client/ArkmeMarkdownBody.js', () => ({ ArkmeMarkdownBody: ({text}: any) => <span>{text}</span> }))
import { BuiltinConversationPreview } from '../src/client/BuiltinConversationPreview.js'
import { HarnessHistoryConversation } from '../src/client/HarnessHistoryConversation.js'
import { historyMessageNode } from '../src/client/harness-history-conversation.js'
import { BuiltinDirectoryPreferences, parseBuiltinPins } from '../src/client/builtin-directory-preferences.js'
import { ArkmeUiController } from '../src/client/ui-controller.js'
import type { ArkmeSourceItem } from '../src/types.js'
let host: HTMLDivElement, root: Root
const close = vi.fn()
const historyProps = { composer: <><textarea disabled aria-label="消息输入框" /><button disabled aria-label="发送消息" /></>, renderNode: (node: any) => <span>{JSON.stringify(historyMessageNode(node)?.data ?? node.presentation)}</span> }
const source = { sourceRef: 'my-topic', kind: 'topic', displayName: '工作', activeAtMillis: 1, unreadCount: 0 } as ArkmeSourceItem
const msg = (id: string, at=1) => ({ itemUid: id, text: id, sendAtMillis: at, isMe: true, senderName: '我' })
const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent === name)!
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host=document.createElement('div'); document.body.append(host); root=createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('keeps remembered personal topic and reads only its timeline, with stable paged content on errors', async () => {
  const ui = new ArkmeUiController(); ui.selectSource(source); ui.showArko()
  const before = ui.getSnapshot(); expect(ui.getRememberedSelfSource()).toBe(source); expect(ui.getSnapshot()).toBe(before)
  call.mockResolvedValueOnce({ items: [msg('new', 2)], hasMore: true, nextCursor: { beforeMillis: 2 } })
    .mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce({ items: [msg('old')], hasMore: false })
  await act(async () => root.render(<BuiltinConversationPreview kind="self" name="发给自己" selfSource={source} onClose={close} />))
  expect(document.body.textContent).toContain('工作'); expect(document.body.textContent).toContain('new')
  await act(async () => button('加载更早消息').click())
  expect(document.body.textContent).toContain('网络断开'); expect(document.body.textContent).toContain('new')
  await act(async () => button('重试').click())
  expect(document.body.textContent).toContain('old'); expect(document.body.textContent).toContain('new')
  expect(call.mock.calls.every(([op,p]) => op === 'source.timeline' && p.sourceRef === 'my-topic')).toBe(true)
  expect(suspend).toHaveBeenCalledOnce()
  await act(async () => document.querySelector('[data-arkme-builtin-preview-backdrop]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(close).toHaveBeenCalledOnce()
  ui.authChanged(false); expect(ui.getRememberedSelfSource()).toBeUndefined()
})
it('does not start an Arko session and drops a stale account response', async () => {
  let finish!: (value: unknown) => void
  call.mockImplementationOnce(() => new Promise(r => finish=r)).mockResolvedValueOnce({ items: [{sessionId:2,messageId:2,role:'assistant',text:'新账号消息',createdAtMillis:2}],hasMore:false })
  await act(async () => root.render(<BuiltinConversationPreview key="prod:11" kind="arko" name="Arko" onClose={close} />))
  const signal = call.mock.calls[0]![2] as AbortSignal
  await act(async () => root.render(<BuiltinConversationPreview key="prod:22" kind="arko" name="Arko" onClose={close} />))
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ items:[{sessionId:1,messageId:1,role:'user',text:'旧账号隐私',createdAtMillis:1}],hasMore:false }))
  expect(document.body.textContent).not.toContain('旧账号隐私'); expect(document.body.textContent).toContain('新账号消息')
  expect(call.mock.calls.every(([op]) => op === 'arko.history')).toBe(true)
})
it('previews Harness tasks then real read-only history without navigation or commands', async () => {
  call.mockImplementation(async op => op === 'remote.sessions.list' ? { contractVersion:1,items:[{runtimeRef:'runtime',sessionRef:'session',title:'任务甲',presence:'offline',capabilities:[],workspaceName:'项目'}] }
    : { nodes:[{node_ref:'m',kind:'assistant',anchor_seq:1,ordinal:0,time:1,presentation:{details:'真实回复',tone:'neutral'}}],complete:true })
  await act(async () => root.render(<BuiltinConversationPreview kind="harness" name="DeepSeek Harness" onClose={close} />))
  await act(async () => button('任务甲项目').click())
  expect(document.body.textContent).toContain('真实回复')
  expect(call).toHaveBeenLastCalledWith('remote.session.read', {runtimeRef:'runtime',sessionRef:'session',source:'cloud'},expect.any(AbortSignal))
  expect(call.mock.calls.every(([op]) => ['remote.sessions.list','remote.session.read'].includes(op))).toBe(true)
  await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  expect(close).toHaveBeenCalledOnce()
})
it('rejects repeating pagination without dropping loaded content', async () => {
  call.mockResolvedValue({ items:[{sessionId:1,messageId:1,role:'user',text:'保留',createdAtMillis:1}],hasMore:true,nextOffset:40 })
  await act(async () => root.render(<BuiltinConversationPreview kind="arko" name="Arko" onClose={close} />))
  await act(async () => button('加载更早消息').click())
  expect(document.body.textContent).toContain('历史分页异常');expect(document.body.textContent).toContain('保留')
})
it('persists only stable entry IDs, isolates accounts and reports save failures', () => {
  const data = new Map<string,string>(), storage = {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)}}
  const prefs=new BuiltinDirectoryPreferences(()=>storage), changed=vi.fn();prefs.subscribe(changed)
  prefs.pin('prod:11','self',true);prefs.pin('prod:11','harness',true)
  expect(prefs.read('prod:11').self).toBeGreaterThan(0);expect(prefs.read('test:11')).toEqual({});expect(changed).toHaveBeenCalledTimes(2)
  prefs.pin('prod:11','self',false);expect(prefs.read('prod:11').self).toBeUndefined()
  expect(parseBuiltinPins('{"self":-1,"harness":"bad","arko":5,"foreign":1}')).toEqual({arko:5})
  expect(()=>new BuiltinDirectoryPreferences(()=>undefined).pin('prod:11','self',true)).toThrow('本机设置保存失败')
})

it('opens a selected foreign session directly with cloud pagination, warnings and cancellation', async () => {
  const session = { runtimeRef: 'foreign', sessionRef: 'same', title: '外机会话', presence: 'online', sameDesktop: true, capabilities: ['session.history'] } as any
  const node = { node_ref: 'n', kind: 'assistant', anchor_seq: 9, ordinal: 0, time: 1, presentation: { details: '已同步部分' } }
  call.mockResolvedValueOnce({ nodes: [node], complete: false, warning: '部分历史尚未同步', nextCursor: { source: 'cloud', before: 9 } })
    .mockRejectedValueOnce(new Error('暂时断网'))
  await act(async () => root.render(<HarnessHistoryConversation {...historyProps} session={session} accountScope="prod" />))
  expect(document.body.textContent).toContain('外机会话'); expect(document.body.textContent).toContain('其他实例')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('textarea')?.disabled).toBe(true)
  expect(document.querySelector('button[aria-label="发送消息"]')?.hasAttribute('disabled')).toBe(true)
  expect(document.body.textContent).not.toContain('只读')
  expect(document.querySelector('[aria-label="返回任务列表"]')).toBeNull()
  expect(call).toHaveBeenLastCalledWith('remote.session.read', { runtimeRef: 'foreign', sessionRef: 'same', source: 'cloud' }, expect.any(AbortSignal))
  expect(document.body.textContent).not.toContain('加载更早消息')
  await act(async () => document.querySelector('[aria-label="消息列表"]')!.dispatchEvent(new Event('scroll', { bubbles: true })))
  expect(document.body.textContent).toContain('暂时断网'); expect(document.body.textContent).toContain('已同步部分'); expect(document.body.textContent).not.toContain('部分历史尚未同步')
  expect(call.mock.lastCall![1].cursor).toEqual({ source: 'cloud', before: 9 })
  let finish!: (v: unknown) => void
  call.mockImplementationOnce(() => new Promise(r => finish = r))
  await act(async () => button('重试').click())
  const signal = call.mock.lastCall![2] as AbortSignal
  await act(async () => root.render(null))
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ nodes: [{ ...node, presentation: { details: '迟到内容' } }] }))
  expect(document.body.textContent).not.toContain('迟到内容')
  expect(call.mock.calls.every(([op]) => op === 'remote.session.read')).toBe(true)
})

it('renders projected user content and assistant blocks instead of an empty presentation', async () => {
  call.mockResolvedValue({ nodes: [
    { node_ref: 'user', kind: 'user', anchor_seq: 1, ordinal: 0, time: 1, data: { content: [{ type: 'text', text: '用户正文' }] }, presentation: { version: 1, format: 'message', tone: 'neutral' } },
    { node_ref: 'assistant', kind: 'assistant', anchor_seq: 2, ordinal: 1, time: 2, data: { blocks: [{ type: 'text', text: '助手正文' }], message: { content: [{ type: 'text', text: '不要重复' }] } }, presentation: { version: 1, format: 'message', tone: 'neutral' } },
    { node_ref: 'legacy', kind: 'assistant', anchor_seq: 3, ordinal: 2, time: 3, data: { message: { content: [{ type: 'text', text: '兼容正文' }] } }, presentation: { version: 1, format: 'message', tone: 'neutral' } },
  ], complete: true })
  await act(async () => root.render(<HarnessHistoryConversation {...historyProps} session={{ runtimeRef: 'other', sessionRef: 's', presence: 'offline', capabilities: [] } as any} accountScope="prod" />))
  expect(document.body.textContent).toContain('用户正文'); expect(document.body.textContent).toContain('助手正文'); expect(document.body.textContent).toContain('兼容正文')
  expect(document.body.textContent).not.toContain('暂无文本内容'); expect(document.body.textContent).not.toContain('不要重复')
})


it('keeps loaded cloud history when runtime presence and capabilities refresh', async () => {
  const session = { runtimeRef: 'foreign', sessionRef: 'same', title: '外机会话', presence: 'offline', capabilities: [] } as any
  call.mockResolvedValue({ nodes: [{ node_ref: 'n', kind: 'assistant', anchor_seq: 1, ordinal: 0, time: 1, presentation: { details: '已经加载的正文' } }], complete: false })
  await act(async () => root.render(<HarnessHistoryConversation {...historyProps} session={session} accountScope="prod" />))
  expect(call).toHaveBeenCalledOnce()
  await act(async () => root.render(<HarnessHistoryConversation {...historyProps} session={{ ...session, presence: 'online', capabilities: ['session.history'] }} accountScope="prod" />))
  expect(call).toHaveBeenCalledOnce()
  expect(document.body.textContent).toContain('已经加载的正文')
})
