import { createRoot } from 'react-dom/client'
// @vitest-environment jsdom
import { ArkmeComposerSendButton } from '../src/client/ArkmeComposerSendButton.js'
import { ArkmeRichComposerInput } from '../src/client/ArkmeRichComposerInput.js'
import { TeamConversationMessage } from '../src/client/TeamConversationMessage.js'
import { ArkmeAttachmentDraftTile } from '../src/client/ArkmeRichContent.js'
import { ArkmeConfirmDialog } from '../src/client/ArkmeConfirmDialog.js'
import { ArkmeReadReceiptPanel, ArkmeReadReceiptMember } from '../src/client/ArkmeReadReceiptPanel.js'
import { ArkmeActionMenu } from '../src/client/ArkmeDshMenu.js'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamConversation, TeamMessage } from '../src/team-app-contract.js'
import { invalidateTeamMessages } from '../src/client/team-messaging-events.js'

vi.mock('react-dom', async original => ({...await original<typeof import('react-dom')>(),createPortal:(children:unknown)=>children}))
const mocks = vi.hoisted(() => ({ call: vi.fn(), upload: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ upload: mocks.upload }) }))
import { TeamMessagingPanel, TeamConversationPane } from '../src/client/TeamMessagingPanel.js'

import { startTeamDirectory, refreshTeamDirectory } from '../src/client/team-conversation-directory.js'

const conversation: TeamConversation = { ref: 'conv', key: 'key', channel: { teamRef: 'team', name: '团队', jotmoId: 'arkme_cn', publicRef: 'a'.repeat(32), link: '', enabled: true, revision: 1, canManage: false }, side: 'external', lastSeq: 0, latestTeamReplySeq: 0, myReadSeq: 0, unread: 0, needsReply: false, blocked: false, revision: 1, updatedAt: 1 }
const storageKey = 'arkme.team.draft:account:key'
let renderer: ReactTestRenderer | undefined
const tick = async () => { await Promise.resolve(); await Promise.resolve() }

describe('Team send UI recovery', () => {
  beforeEach(() => {
    localStorage.clear(); mocks.call.mockReset()
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1 })
    localStorage.setItem(storageKey, JSON.stringify({ text: '问题', assets: [] }))
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      throw new Error('network lost')
    })
  })
  afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals() })
  const mount = async () => { await act(async () => { renderer = create(<TeamConversationPane conversation={conversation} accountKey="account" onChanged={() => {}} />); await tick() }) }
  const send = async () => { await act(async () => { renderer!.root.findByType(ArkmeComposerSendButton).props.onClick(); await tick() }) }

  it('uses the shared attachment tile preview and releases removed upload previews', async () => {
    const createUrl = vi.fn(() => 'blob:team-upload')
    const revokeUrl = vi.fn()
    vi.stubGlobal('URL', class extends URL { static createObjectURL=createUrl; static revokeObjectURL=revokeUrl })
    mocks.upload.mockResolvedValue({fileAssetUid:'asset',fileName:'image.png',mimeType:'image/png',fileKind:1,size:10})
    await mount()
    const input = renderer!.root.findByProps({type:'file'})
    await act(async () => {
      input.props.onChange({target:{files:[new File(['image'], 'image.png', {type:'image/png'})],value:''}})
      await tick()
    })
    expect(renderer!.root.findByType(ArkmeAttachmentDraftTile).props.previewUrl).toBe('blob:team-upload')
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(revokeUrl).not.toHaveBeenCalled()
    await act(async () => { renderer!.root.findByType(ArkmeAttachmentDraftTile).props.onRemove(); await tick() })
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:team-upload')
  })

  it('shows an accepted row immediately, permits the next draft and retains an acknowledged body through refresh failure', async () => {
    let release!: (value: unknown) => void
    let refreshFails = false
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') {
        if (refreshFails) throw new Error('刷新失败')
        return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      }
      if (op === 'team.app.send') return new Promise(resolve => {release=resolve})
      return {}
    })
    await mount(); await send()
    expect(renderer!.root.findByType(TeamConversationMessage).props.message.content.text_content).toBe('问题')
    const editor = renderer!.root.findByType(ArkmeRichComposerInput)
    expect(editor.props.disabled).toBe(false)
    await act(async () => {editor.props.onTextChange('下一条'); await tick()})
    refreshFails = true
    await act(async () => {
      release({message:{key:'sent',ref:'sent',seq:1,revision:1,side:'external',sender:{nickname:'我'},own:true,state:'published',createdAt:1,canEdit:false,canDelete:false,media:[],version:0}})
      await tick()
    })
    expect(renderer!.root.findByType(TeamConversationMessage).props.message.content.text_content).toBe('问题')
    expect(renderer!.root.findByType(TeamConversationMessage).props.message.state).toBe('published')
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({text:'下一条',assets:[]})
    expect(JSON.stringify(renderer!.toJSON())).toContain('刷新失败')
    refreshFails = false
    await act(async () => {invalidateTeamMessages('account');await tick()})
    expect(renderer!.root.findByType(TeamConversationMessage).props.message.content.text_content).toBe('问题')
  })

  it('retains the live editor DOM and selection on background invalidation', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<TeamConversationPane conversation={conversation} accountKey="account" onChanged={() => {}} />); await tick() })
      const editor = host.querySelector('[contenteditable="true"]') as HTMLElement
      editor.focus()
      const text = editor.firstChild!
      const range = document.createRange(); range.setStart(text, 1); range.collapse(true)
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
      await act(async () => { invalidateTeamMessages('account'); await tick() })
      expect(editor.firstChild).toBe(text)
      expect(text.isConnected).toBe(true)
      expect(window.getSelection()!.anchorOffset).toBe(1)
      expect(document.activeElement).toBe(editor)
    } finally { await act(async () => root.unmount()); host.remove() }
  })
  it.each([false, true, undefined])('external receipt is status only and disappears when read: %s', async read => {
    const own = {key:'m',ref:'m',seq:1,revision:1,side:'external',sender:{nickname:'我'},own:true,state:'published',createdAt:1,canEdit:false,canDelete:false,version:1,contentStatus:'available',media:[],recipientRead:read}
    mocks.call.mockImplementation(async (op: string) => op === 'team.app.timeline'
      ? {conversation,messages:[own,{...own,key:'other',own:false,side:'team'}],hasMore:false,beforeSeq:0}
      : {teamRead:true,visitorRead:true,members:[]})
    await mount()
    const indicators = renderer!.root.findAll(v => typeof v.type === 'string' && v.props['data-arkme-read-receipt-indicator'])
    expect(indicators).toHaveLength(read === true ? 0 : 1)
    if (read !== true) {
      expect(indicators[0]!.props['data-arkme-read-receipt-indicator']).toBe(read === undefined ? 'error' : 'unread')
      expect(indicators[0]!.parent!.type).toBe('span')
      expect(indicators[0]!.parent!.props.onClick).toBeUndefined()
    }
    expect(renderer!.root.findAllByType(TeamConversationMessage).every(v => !v.props.showReceipts)).toBe(true)
    expect(mocks.call.mock.calls.some(v => v[0] === 'team.app.receipts')).toBe(false)
    expect(renderer!.root.findAllByType(ArkmeReadReceiptPanel)).toHaveLength(0)
  })
  it('lets a team member open the shared receipt panel from the unread dot', async () => {
    const own = {key:'m',ref:'m',seq:1,revision:1,side:'team',sender:{nickname:'我'},own:true,state:'published',createdAt:1,canEdit:false,canDelete:false,version:1,contentStatus:'available',media:[],recipientRead:false}
    mocks.call.mockImplementation(async (op: string) => op === 'team.app.timeline'
      ? {conversation:{...conversation,side:'team'},messages:[own],hasMore:false,beforeSeq:0}
      : {teamRead:true,visitorRead:false,members:[]})
    await mount()
    const button = renderer!.root.findByProps({'data-arkme-read-receipt-indicator':'unread'}).parent!
    expect(button.type).toBe('button')
    await act(async () => { button.props.onClick(); await tick() })
    expect(renderer!.root.findAllByType(ArkmeReadReceiptPanel)).toHaveLength(1)
    await act(async () => { button.props.onClick(); await tick() })
    expect(renderer!.root.findAllByType(ArkmeReadReceiptPanel)).toHaveLength(0)
  })
  it('shows directory failure and retries without claiming there are no conversations', async () => {
    let failed = true
    mocks.call.mockImplementation(async (op: string, payload: { side?: string }) => {
      if (op === 'team.app.conversations') {
        if (failed) throw new Error('团队对话暂时无法刷新')
        return { items: payload.side === 'external' ? [conversation] : [], hasMore: false }
      }
      throw new Error(op)
    })
    const stop = startTeamDirectory('account')
    try {
      await act(async () => { renderer = create(<TeamMessagingPanel accountKey="account" intent={{ kind: 'inbox' }} />); await tick() })
      await act(async () => { await refreshTeamDirectory('account'); await tick() })
      expect(JSON.stringify(renderer!.toJSON())).toContain('团队对话暂时无法刷新')
      expect(JSON.stringify(renderer!.toJSON())).not.toContain('还没有团队对话')
      failed = false
      await act(async () => { renderer!.root.findAllByType('button').find(v => v.children.join('') === '重试')!.props.onClick(); await tick() })
      expect(renderer!.root.findAllByProps({ className: 'team-conversation-row' })).toHaveLength(1)
      failed = true
      await act(async () => { await refreshTeamDirectory('account'); await tick() })
      expect(renderer!.root.findAllByProps({ className: 'team-conversation-row' })).toHaveLength(1)
      expect(JSON.stringify(renderer!.toJSON())).toContain('团队对话暂时无法刷新')
    } finally { await act(async () => { stop() }) }
  })

  it.each(['arkme_cn', 'project_team'])('keeps author history copy specific to the official team: %s', async jotmoId => {
    const target = { ...conversation, channel: { ...conversation.channel, jotmoId } }
    mocks.call.mockImplementation(async () => ({ conversation: target, messages: [], hasMore: false, beforeSeq: 0 }))
    await act(async () => { renderer = create(<TeamConversationPane conversation={target} accountKey="account" onChanged={() => {}} />); await tick() })
    expect(JSON.stringify(renderer!.toJSON()).includes('与作者的历史私聊')).toBe(jotmoId === 'arkme_cn')
  })

  it('persists the stable request before network I/O, refuses double admission, and reuses it after remount', async () => {
    let release!: (value: unknown) => void
    mocks.call.mockImplementation(async (op: string, payload: { clientUid?: string }) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      if (op === 'team.app.send') {
        expect(JSON.parse(localStorage.getItem(storageKey)!).attempt.uid).toBe(payload.clientUid)
        return await new Promise(resolve => { release = resolve })
      }
      throw new Error(op)
    })
    await mount()
    await act(async () => {
      const submit = renderer!.root.findByType(ArkmeComposerSendButton).props.onClick
      submit({ preventDefault() {} }); submit({ preventDefault() {} }); await tick()
    })
    const first = mocks.call.mock.calls.filter(v => v[0] === 'team.app.send')
    expect(first).toHaveLength(1)
    await act(async () => { renderer?.unmount(); release({ reason: 'dependency_unavailable' }); await tick() })
    await mount(); await send()
    const sends = mocks.call.mock.calls.filter(v => v[0] === 'team.app.send')
    expect(sends[1]?.[1].clientUid).toBe(first[0]?.[1].clientUid)
    await act(async () => { release({ message: { key:'sent',ref:'sent',seq:1,state:'published',sender:{nickname:'我'},own:true,media:[],version:0 } }); await tick() })
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt).toBeUndefined()
  })
  it.each(['team-invalid_request', 'team-channel_paused', 'team-conversation_blocked'])('restores both drafts after a pre-admission rejection: %s', async code => {
    let reject!: (error: unknown) => void
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      if (op === 'team.app.send') return new Promise((_, fail) => { reject = fail })
      return {}
    })
    await mount(); await send()
    await act(async () => { renderer!.root.findByType(ArkmeRichComposerInput).props.onTextChange('下一条'); await tick() })
    await act(async () => { reject(Object.assign(new Error('发送未接受'), { body: { code } })); await tick() })
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({text: '问题\n\n下一条', assets: []})
    expect(renderer!.root.findAllByType(TeamConversationMessage)).toHaveLength(0)
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.value).toBe('问题\n\n下一条')
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.disabled).toBe(false)
    expect(mocks.call.mock.calls.filter(v => v[0] === 'team.app.send')).toHaveLength(1)
  })
  it('unlocks a definitive invalid request but retains a cancellable accepted operation', async () => {
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      throw Object.assign(new Error('请求内容无效'), { body: { code: 'team-invalid_request' } })
    })
    await mount(); await send()
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt).toBeUndefined()
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      if (op === 'team.app.send') return { reason: 'invalid_request', message: { ref: 'accepted', state: 'preparing' } }
      return {}
    })
    await send()
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt.message.ref).toBe('accepted')
    const cancel = renderer!.root.findAllByType('button').find(v => v.children.join('') === '取消本次发送，保留草稿')!
    await act(async () => { cancel.props.onClick(); await tick() })
    expect(mocks.call.mock.calls.find(v => v[0] === 'team.app.cancel')?.[1]).toEqual({ messageRef: 'accepted' })
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ text: '问题', assets: [] })
  })
  it.each(['cancelled'])('unlocks a %s send without losing draft or sending a new request', async state => {
    mocks.call.mockImplementation(async (op: string) => op === 'team.app.timeline'
      ? { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      : { message: { state } })
    await mount(); await send()
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ text: '问题', assets: [] })
    expect(renderer!.root.findAllByType(ArkmeRichComposerInput).find(v=>v.props.ariaLabel==='团队消息内容')!.props.disabled).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('草稿已保留')
    expect(mocks.call.mock.calls.filter(v => v[0] === 'team.app.send')).toHaveLength(1)
  })
  it('keeps an edit draft and requires reading the new version before explicit overwrite', async () => {
    let message: TeamMessage = { ref: 'message', key: 'message', seq: 1, revision: 1, side: 'team', sender: { nickname: '成员' }, own: true, state: 'published', createdAt: 1, canEdit: true, canDelete: true, content: { text_content: '原内容', template_kind: 1 }, version: 1, contentStatus: 'available', media: [] }
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation: { ...conversation, side: 'team' }, messages: [message], hasMore: false, beforeSeq: 0 }
      if (op === 'team.app.edit' && message.version === 1) {
        message = { ...message, version: 2, content: { text_content: '另一位成员的新内容', template_kind: 1 } }
        throw Object.assign(new Error('内容已更新'), { body: { code: 'team-version_conflict' } })
      }
      return {}
    })
    const button = (label: string) => renderer!.root.findAllByType('button').find(v => v.children.join('') === label || v.props['aria-label'] === label)!
    const click = async (label: string) => { await act(async () => { button(label).props.onClick(); await tick() }) }
    await mount()
    expect(button('屏蔽此用户')).toBeUndefined()
    await act(async () => { renderer!.root.findByType(TeamConversationMessage).findByProps({ 'aria-label': '消息操作' }).props.onContextMenu({ preventDefault() {}, clientX: 10, clientY: 10 }); await tick() })
    await act(async () => { renderer!.root.findAllByType(ArkmeActionMenu).find(v => v.props.label === '消息操作')!.props.actions.find((v: {id?:string}) => v.id === 'edit').onSelect(); await tick() })
    expect(renderer!.root.findAllByType(ArkmeActionMenu).filter(v => v.props.label === '消息操作')).toHaveLength(0)
    await act(async () => { renderer!.root.findAllByType(ArkmeRichComposerInput).find(v=>v.props.ariaLabel==='修改消息内容')!.props.onTextChange('我的修改') })
    await click('保存修改')
    expect(button('保存修改').props.disabled).toBe(true)
    expect(renderer!.root.findAllByType(ArkmeRichComposerInput).find(v=>v.props.ariaLabel==='修改消息内容')!.props.value).toBe('我的修改')
    await click('读取最新版本')
    expect(JSON.stringify(renderer!.toJSON())).toContain('另一位成员的新内容')
    expect(mocks.call.mock.calls.filter(v => v[0] === 'team.app.edit')).toHaveLength(1)
    await click('确认覆盖最新版本')
    const edits = mocks.call.mock.calls.filter(v => v[0] === 'team.app.edit')
    expect(edits.map(v => v[1].version)).toEqual([1, 2])
    expect(edits[1]![1].content.text_content).toBe('我的修改')
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.value).toBe('问题')
    expect(renderer!.root.findAllByType(ArkmeConfirmDialog)).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '修改消息内容' })).toHaveLength(0)
  })
  it('regression: definite paused rejection keeps the draft editable', async () => {
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      throw Object.assign(new Error('团队已暂停接收新消息'), { body: { code: 'team-channel_paused' } })
    })
    await mount(); await send()
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt).toBeUndefined()
    expect(renderer!.root.findAllByType(ArkmeRichComposerInput).find(v=>v.props.ariaLabel==='团队消息内容')!.props.disabled).toBe(false)
    expect(renderer!.root.findAllByType('button').filter(v => v.children.join('').includes('取消本次发送'))).toHaveLength(0)
  })
  it('regression: real-time refresh reauthorizes and retains the loaded history window', async () => {
    const message = (key: string, seq: number) => ({ ref:key,key,seq,revision:1,side:'external',sender:{nickname:'用户'},own:true,state:'published',createdAt:1,canEdit:false,canDelete:false,content:{text_content:key},version:1,contentStatus:'available',media:[] })
    mocks.call.mockImplementation(async (op: string, p: {beforeSeq?: number}) => {
      if(op === 'team.app.timeline') return {conversation,messages:p.beforeSeq ? [message('older',10)] : [message('latest',60)],hasMore: !p.beforeSeq,beforeSeq: p.beforeSeq ? 0:60}
      return {}
    })
    await mount()
    await act(async () => { renderer!.root.findAllByType('button').find(v => v.children.join('') === '加载更早消息')!.props.onClick(); await tick() })
    expect(renderer!.root.findAllByType('article')).toHaveLength(2)
    await act(async () => { invalidateTeamMessages('account'); await tick() })
    expect(renderer!.root.findAllByType('article')).toHaveLength(2)
  })
  it('refreshes open receipts without dropping pages and never reopens a dismissed receipt', async () => {
    const message: TeamMessage = {ref:'message',key:'message',seq:1,revision:1,side:'team',sender:{nickname:'成员'},own:true,state:'published',createdAt:1,canEdit:false,canDelete:false,version:1,contentStatus:'available',media:[]}
    let read=false, deferred: ((value: unknown)=>void) | undefined, hold=false
    mocks.call.mockImplementation(async (op: string,p:{cursor?:string}) => {
      if(op==='team.app.timeline') return {conversation:{...conversation,side:'team'},messages:[message],hasMore:false,beforeSeq:0}
      if(op==='team.app.receipts') {
        if(hold) return new Promise(resolve=>{deferred=resolve})
        return {teamRead:read,visitorRead:read,members:[{nickname:p.cursor?'two':'one',read}],hasMore:!p.cursor,nextCursor:p.cursor?'':'next'}
      }
      return {}
    })
    const click=async(label:string)=>{await act(async()=>{renderer!.root.findAllByType('button').find(v=>v.children.join('')===label)!.props.onClick();await tick()})}
    await mount();await act(async()=>{renderer!.root.findByType(TeamConversationMessage).props.onReceipts();await tick()});await click('更多成员')
    read=true;await act(async()=>{invalidateTeamMessages('account');await tick()})
    expect(JSON.stringify(renderer!.toJSON())).toContain('two')
    expect(JSON.stringify(renderer!.toJSON())).toContain('用户已查看')
    expect(renderer!.root.findAllByType(ArkmeReadReceiptMember)).toHaveLength(2)
    expect(renderer!.root.findAllByType(ArkmeConfirmDialog)).toHaveLength(0)
    hold=true;await act(async()=>{invalidateTeamMessages('account');await tick()})
    await act(async()=>{renderer!.root.findByType(ArkmeReadReceiptPanel).props.onClose();await tick()});await act(async()=>{deferred?.({members:[],hasMore:false,teamRead:true});await tick()})
    expect(renderer!.root.findAllByType(ArkmeReadReceiptPanel)).toHaveLength(0)
  })
  it('notifies the inbox owner immediately when detail authorization is revoked', async () => {
    const revoked=vi.fn()
    mocks.call.mockRejectedValue(Object.assign(new Error('no access'),{body:{code:'team-not_accessible'}}))
    await act(async()=>{renderer=create(<TeamConversationPane conversation={conversation} accountKey="account" onChanged={()=>{}} onAccessLost={revoked}/>);await tick()})
    expect(revoked).toHaveBeenCalledTimes(1)
    expect(renderer!.root.findAllByType('article')).toHaveLength(0)
  })
  it('does not send when durable local storage is unavailable', async () => {
    await mount()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await send()
    expect(mocks.call.mock.calls.some(v => v[0] === 'team.app.send')).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('无法保存发送请求')
  })
})
