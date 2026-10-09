import { createRoot } from 'react-dom/client'
// @vitest-environment jsdom
import { ArkmeEmojiPicker } from '../src/client/ArkmeEmojiPicker.js'
import { arkmeEmojiById } from '../src/client/arkme-emoji.js'
import { ArkmeComposerSendButton } from '../src/client/ArkmeComposerSendButton.js'
import { ArkmeSendTaskStatus } from '../src/client/ArkmeSendTaskStatus.js'
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
const mocks = vi.hoisted(() => ({ call: vi.fn(), upload: vi.fn(), stage: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ upload: mocks.upload, fileCapabilities:async()=>({maxAttachments:9}),stageFile:mocks.stage,localFileUrl:(ref:string)=>`/local/${ref}` }) }))
import { TeamMessagingPanel, TeamConversationPane, TeamConversationRow } from '../src/client/TeamMessagingPanel.js'
import { conversationDirectoryStyles } from '../src/client/conversation-directory-presentation.js'
import { connectArkmeLocale } from '../src/client/locale.js'

import { startTeamDirectory, refreshTeamDirectory } from '../src/client/team-conversation-directory.js'

const conversation: TeamConversation = { ref: 'conv', key: 'key', channel: { teamRef: 'team', name: '团队', jotmoId: 'arkme_cn', publicRef: 'a'.repeat(32), link: '', enabled: true, revision: 1, canManage: false }, side: 'external', lastSeq: 0, latestTeamReplySeq: 0, myReadSeq: 0, unread: 0, needsReply: false, blocked: false, revision: 1, updatedAt: 1 }
const storageKey = 'arkme.team.draft:account:key'
let renderer: ReactTestRenderer | undefined
const tick = async () => { await Promise.resolve(); await Promise.resolve() }

function accepted(overrides: Record<string, unknown> = {}) {
  const command = mocks.call.mock.calls.filter(v=>v[0]==='team.app.send.enqueue').at(-1)![1]
  return {...command,taskRef:'task',conversationKey:'key',createdAtMillis:Date.now(),state:'queued',files:[],attempts:0,nextAttemptAt:0,...overrides}
}

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

  for (const side of ['team', 'external'] as const) {
    it.each([
      ['available', '', 3, true, '[语音]'],
      ['available', '', 3, false, '[语音]'],
      ['available', '转写内容', 3, true, '转写内容'],
      ['available', '', 4, true, '[附件]'],
      ['available', '', undefined, true, '[附件]'],
      ['available', '', undefined, false, ''],
      ['deleted', '旧正文不能泄露', 3, true, '内容暂不可用'],
      ['unavailable', '旧正文不能泄露', 3, true, '内容暂不可用'],
    ] as const)(`${side} preview %s/%s/%s/%s renders %s`, async (status, text, templateKind, hasMedia, expected) => {
      await act(async () => { renderer = create(<TeamConversationRow conversation={{ ...conversation, side,
        preview: { status, text, hasMedia, ...(templateKind === undefined ? {} : { templateKind }) },
      }} onClick={() => {}} />) })
      expect(renderer!.root.findByProps({ style: conversationDirectoryStyles.preview }).children.join('')).toBe(expected)
    })
  }

  it('uses existing voice translation and preserves user transcription after refresh', async () => {
    const setLocale = (active: string) => connectArkmeLocale({ getLocale: () => ({ active }), subscribe: () => () => {} })()
    setLocale('en')
    try {
      const row = (text: string) => <TeamConversationRow conversation={{ ...conversation,
        preview: { status: 'available', text, hasMedia: true, templateKind: 3 },
      }} onClick={() => {}} />
      await act(async () => { renderer = create(row('')) })
      const preview = () => renderer!.root.findByProps({ style: conversationDirectoryStyles.preview })
      expect(preview().children.join('')).toBe('[Voice]')
      const first = preview()
      await act(async () => { renderer!.update(row('语音原文')) })
      expect(preview()).toBe(first)
      expect(preview().children.join('')).toBe('语音原文')
    } finally { setLocale('zh') }
  })

  it.each(['queued','uploading','sending'])('keeps initial %s text delivery in the message without extra status controls',async state=>{
    let tasks:ReturnType<typeof accepted>[]=[]
    mocks.call.mockImplementation(async(op:string)=>{
      if(op==='team.app.timeline')return {conversation,messages:[],hasMore:false,beforeSeq:0}
      if(op==='team.app.send.enqueue'){tasks=[accepted({state})];return tasks[0]}
      return tasks
    })
    await mount();await send()
    expect(renderer!.root.findByType(TeamConversationMessage).props.message.state).toBe('sending')
    expect(renderer!.root.findAllByType(ArkmeSendTaskStatus)).toHaveLength(0)
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.disabled).toBe(false)
    await act(async()=>{renderer!.root.findByType(ArkmeRichComposerInput).props.onTextChange('下一条');await tick()})
    expect(renderer!.root.findByType(ArkmeComposerSendButton).props.disabled).toBe(false)
  })
  it.each(['retrying','failed','cancelling'])('keeps %s delivery actionable in the shared status component',async state=>{
    let tasks:ReturnType<typeof accepted>[]=[]
    mocks.call.mockImplementation(async(op:string)=>{
      if(op==='team.app.timeline')return {conversation,messages:[],hasMore:false,beforeSeq:0}
      if(op==='team.app.send.enqueue'){tasks=[accepted({state,attempts:1,error:'网络断开',cancelRequested:state==='cancelling'})];return tasks[0]}
      return tasks
    })
    await mount();await send()
    expect(renderer!.root.findAllByType(ArkmeSendTaskStatus)).toHaveLength(1)
    expect(renderer!.root.findByType(ArkmeSendTaskStatus).props.state).toBe(state)
  })

  it('keeps automatic offline retries quiet and allows composing the next message', async () => {
    let tasks: ReturnType<typeof accepted>[] = []
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return {conversation,messages:[],hasMore:false,beforeSeq:0}
      if (op === 'team.app.send.enqueue') { tasks = [accepted({state:'retrying',attempts:2,reason:'dependency_unavailable',error:'服务暂时不可用，请使用原请求重试'})]; return tasks[0] }
      return tasks
    })
    await mount(); await send()
    const status = renderer!.root.findByType(ArkmeSendTaskStatus)
    expect(status.findAllByType('button')).toHaveLength(0)
    expect(status.findByType('div').children.join('')).toBe('等待发送')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('原请求')
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.disabled).toBe(false)
  })

  it('uses the shared composer geometry, recipient placeholder and token-preserving emoji edit', async () => {
    await mount()
    const input = () => renderer!.root.findByType(ArkmeRichComposerInput)
    expect(input().props.className).toBe('arkme-conversation-textarea')
    expect(input().props.placeholder).toBe('发消息到 团队')
    const surface = () => renderer!.root.findByProps({'data-arkme-primary-composer':'true'})
    expect(surface().props.style.borderColor).toBe('transparent')
    await act(async () => input().props.onFocus())
    expect(surface().props.style.borderColor).not.toBe('transparent')
    await act(async () => input().props.onSelectionChange('问题',2,2))
    await act(async () => renderer!.root.findByType(ArkmeEmojiPicker).props.onSelect(arkmeEmojiById.smiling_face))
    expect(input().props.value).toBe('问题\uFFFC')
    expect(input().props.emojis).toEqual([{emojiId:'smiling_face',startIndex:2}])
    await send()
    expect(mocks.call.mock.calls.find(call=>call[0]==='team.app.send.enqueue')?.[1].content.text_content).toBe('问题[jm_emoji:smiling_face]')
  })

  it('retries a failed timeline read without losing the draft', async () => {
    mocks.call.mockRejectedValue(new Error('无法连接本机插件，请确认插件正在运行后重试'))
    await mount()
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.value).toBe('问题')
    const retry = renderer!.root.findAllByType('button').find(button=>button.children.join('')==='重试')!
    mocks.call.mockImplementation(async(op:string)=>op==='team.app.timeline'?{conversation,messages:[],hasMore:false,beforeSeq:0}:[])
    await act(async()=>{retry.props.onClick();await tick()})
    expect(renderer!.root.findAllByProps({role:'alert'})).toHaveLength(0)
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.value).toBe('问题')
  })

  it.each([false, undefined, true])('requires explicit inbox authority even when the directory has cached rows: %s', async openInbox => {
    mocks.call.mockImplementation(async(op:string,p:{side?:string}) => {
      if(op==='team.app.official') return conversation.channel
      if(op==='team.app.open') return {channel:conversation.channel,openInbox}
      if(op==='team.app.conversations') return {items:p.side==='team'?[{...conversation,side:'team'}]:[],hasMore:false}
      return []
    })
    const stop=startTeamDirectory('account')
    try {
      await act(async()=>{renderer=create(<TeamMessagingPanel accountKey="account" intent={{kind:'official'}} />);await tick()})
      await act(async()=>{await refreshTeamDirectory('account');await tick()})
      expect(JSON.stringify(renderer!.toJSON()).includes('暂时无法打开对话，请重试')).toBe(openInbox!==true)
      expect(renderer!.root.findAllByType(TeamConversationRow)).toHaveLength(openInbox===true?1:0)
    } finally { await act(async()=>stop()) }
  })

  it('online recovery retries the same command once and keeps the next draft and original time', async () => {
    await mount(); await send()
    const original = JSON.parse(localStorage.getItem(storageKey)!).attempt
    await act(async () => { renderer!.root.findByType(ArkmeRichComposerInput).props.onTextChange('下一条'); await tick() })
    let release!: (value: unknown) => void
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return {conversation,messages:[],hasMore:false,beforeSeq:0}
      if (op === 'team.app.send.enqueue') return new Promise(resolve => { release = resolve })
      return {}
    })
    await act(async () => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); await tick() })
    const sends = mocks.call.mock.calls.filter(call => call[0] === 'team.app.send.enqueue')
    expect(sends).toHaveLength(2)
    expect(sends.map(call => call[1].clientUid)).toEqual([original.uid, original.uid])
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt.createdAt).toBe(original.createdAt)
    await act(async () => {
      release(accepted())
      await tick()
    })
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({text:'下一条',assets:[]})
  })

  it.each(['idempotency_conflict', 'not_accessible'])('does not automatically retry %s after reconnect', async reason => {
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return {conversation,messages:[],hasMore:false,beforeSeq:0}
      throw Object.assign(new Error(reason), {body:{code:`team-${reason}`}})
    })
    await mount(); await send()
    await act(async () => { window.dispatchEvent(new Event('online')); await tick() })
    expect(mocks.call.mock.calls.filter(call => call[0] === 'team.app.send.enqueue')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt.reason).toBe(reason)
  })

  it('does not lose an invalidation arriving during an in-flight refresh', async () => {
    await mount()
    let release!: (value: unknown) => void
    let reads = 0
    mocks.call.mockImplementation(async (op: string) => {
      if (op !== 'team.app.timeline') return {}
      if (++reads === 1) return new Promise(resolve => { release = resolve })
      return {conversation,messages:[{key:'latest',ref:'latest',seq:1,revision:1,createdAt:1,canEdit:false,canDelete:false,state:'published',side:'external',own:true,
        sender:{nickname:'我'},media:[],version:1,contentStatus:'available',content:{text_content:'最新回复'}}],hasMore:false,beforeSeq:0}
    })
    await act(async () => { invalidateTeamMessages('account'); await tick() })
    await act(async () => { invalidateTeamMessages('account'); await tick() })
    await act(async () => { release({conversation,messages:[],hasMore:false,beforeSeq:0}); await tick() })
    expect(reads).toBe(2)
    expect(renderer!.root.findByType(TeamConversationMessage).props.message.key).toBe('latest')
  })

  it('does not recover a pending write without a fresh authorized timeline', async () => {
    await mount(); await send()
    mocks.call.mockRejectedValue(new Error('still offline'))
    await act(async () => { window.dispatchEvent(new Event('online')); await tick() })
    expect(mocks.call.mock.calls.filter(call => call[0] === 'team.app.send.enqueue')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt).toBeDefined()
  })

  it('stages attachments locally through the SDK and restores their shared preview without uploading', async () => {
    mocks.stage.mockResolvedValue({fileRef:'local-image',fileName:'image.png',mimeType:'image/png',fileKind:1,size:10})
    await mount()
    const picker=renderer!.root.findByProps({type:'file'})
    await act(async()=>{picker.props.onChange({target:{files:[new File(['image'],'image.png',{type:'image/png'})],value:''}});await tick()})
    expect(renderer!.root.findByType(ArkmeAttachmentDraftTile).props.previewUrl).toBe('/local/local-image')
    expect(mocks.upload).not.toHaveBeenCalled()
    await act(async()=>renderer!.unmount());await mount()
    expect(renderer!.root.findByType(ArkmeAttachmentDraftTile).props.previewUrl).toBe('/local/local-image')
    await act(async()=>{renderer!.root.findByType(ArkmeAttachmentDraftTile).props.onRemove();await tick()})
    expect(JSON.parse(localStorage.getItem(storageKey)!).localFiles).toEqual([])
  })

  it('shows an accepted row immediately, permits the next draft and retains an acknowledged body through refresh failure', async () => {
    let release!: (value: unknown) => void
    let refreshFails = false
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') {
        if (refreshFails) throw new Error('刷新失败')
        return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      }
      if (op === 'team.app.send.enqueue') return new Promise(resolve => {release=resolve})
      return {}
    })
    await mount(); await send()
    expect(renderer!.root.findByType(TeamConversationMessage).props.message.content.text_content).toBe('问题')
    const editor = renderer!.root.findByType(ArkmeRichComposerInput)
    expect(editor.props.disabled).toBe(false)
    await act(async () => {editor.props.onTextChange('下一条'); await tick()})
    refreshFails = true
    await act(async () => {
      release(accepted({state:'sent',message:{key:'sent',ref:'sent',seq:1,revision:1,side:'external',sender:{nickname:'我'},own:true,state:'published',createdAt:1,canEdit:false,canDelete:false,media:[],version:0,contentStatus:''}}))
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

  it('keeps staged image bytes visible when a minimal published ACK is followed by a failed refresh',async()=>{
    const file={fileRef:'local-image',fileName:'image.png',mimeType:'image/png',fileKind:1,size:10}
    localStorage.setItem(storageKey,JSON.stringify({text:'图片',assets:[],localFiles:[file]}))
    let refreshFails=false
    mocks.call.mockImplementation(async(op:string)=>{
      if(op==='team.app.timeline'){
        if(refreshFails)throw new Error('刷新失败')
        return {conversation,messages:[],hasMore:false,beforeSeq:0}
      }
      if(op==='team.app.send.enqueue'){
        refreshFails=true
        return accepted({state:'sent',createdAtMillis:Date.now()-8*86400000,completedAtMillis:Date.now(),files:[file],message:{key:'image-ack',ref:'image-ack',seq:1,revision:1,side:'external',own:true,sender:{nickname:'我'},state:'published',createdAt:1,version:0,contentStatus:'',media:[]}})
      }
      throw new Error(op)
    })
    await mount();await send()
    const shown=renderer!.root.findByType(TeamConversationMessage).props.message
    expect(shown.contentStatus).toBe('available')
    expect(shown.content.text_content).toBe('图片')
    expect(shown.media[0].url).toBe('/local/local-image')
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

  it.each(['arkme_cn', 'project_team'])('omits redundant explanation and Home controls for external conversations: %s', async jotmoId => {
    const target = { ...conversation, channel: { ...conversation.channel, jotmoId } }
    mocks.call.mockImplementation(async () => ({ conversation: target, messages: [], hasMore: false, beforeSeq: 0 }))
    await act(async () => { renderer = create(<TeamConversationPane conversation={target} accountKey="account" onChanged={() => {}} />); await tick() })
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('与作者的历史私聊')
    expect(renderer!.root.findAllByType(ArkmeActionMenu)).toHaveLength(0)
    expect(mocks.call.mock.calls.some(v => v[0] === 'team.app.home.visibility')).toBe(false)
  })

  it.each(['team', 'external'] as const)('hides moderation and empty menus for owners on the %s side', async side => {
    const target = { ...conversation, side, channel: { ...conversation.channel, canManage: true } }
    mocks.call.mockImplementation(async () => ({ conversation: target, messages: [], hasMore: false, beforeSeq: 0 }))
    await act(async () => { renderer = create(<TeamConversationPane conversation={target} accountKey="account" onChanged={() => {}} />); await tick() })
    expect(renderer!.root.findAllByType(ArkmeActionMenu)).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).not.toMatch(/屏蔽此用户|解除屏蔽|对话选项/)
    expect(renderer!.root.findAllByProps({'aria-label':'返回团队对话'}).some(node => node.type === 'button')).toBe(side === 'team')
    expect(mocks.call.mock.calls.some(v => v[0] === 'team.app.block')).toBe(false)
  })

  it('persists the stable request before network I/O, refuses double admission, and reuses it after remount', async () => {
    let release!: (value: unknown) => void
    mocks.call.mockImplementation(async (op: string, payload: { clientUid?: string }) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      if (op === 'team.app.send.enqueue') {
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
    const first = mocks.call.mock.calls.filter(v => v[0] === 'team.app.send.enqueue')
    expect(first).toHaveLength(1)
    await act(async () => { renderer?.unmount(); release({ reason: 'dependency_unavailable' }); await tick() })
    await mount(); await send()
    const sends = mocks.call.mock.calls.filter(v => v[0] === 'team.app.send.enqueue')
    expect(sends[1]?.[1].clientUid).toBe(first[0]?.[1].clientUid)
    await act(async () => { release(accepted()); await tick() })
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt).toBeUndefined()
  })
  it.each(['team-invalid_request', 'team-channel_paused', 'team-conversation_blocked'])('restores both drafts after a pre-admission rejection: %s', async code => {
    let reject!: (error: unknown) => void
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      if (op === 'team.app.send.enqueue') return new Promise((_, fail) => { reject = fail })
      return {}
    })
    await mount(); await send()
    await act(async () => { renderer!.root.findByType(ArkmeRichComposerInput).props.onTextChange('下一条'); await tick() })
    await act(async () => { reject(Object.assign(new Error('发送未接受'), { body: { code } })); await tick() })
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({text: '问题\n\n下一条', assets: []})
    expect(renderer!.root.findAllByType(TeamConversationMessage)).toHaveLength(0)
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.value).toBe('问题\n\n下一条')
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.disabled).toBe(false)
    expect(mocks.call.mock.calls.filter(v => v[0] === 'team.app.send.enqueue')).toHaveLength(1)
  })
  it('keeps a recovering legacy send in its bubble without reply confirmation',async()=>{
    const task={conversationRef:conversation.ref,clientUid:'client',content:{text_content:'原消息',template_kind:1},expectedReplySeq:0,fileRefs:[],files:[],taskRef:'legacy',conversationKey:'key',createdAtMillis:Date.now(),state:'retrying',attempts:1,nextAttemptAt:0,reason:'reply_conflict'}
    mocks.call.mockImplementation(async(op:string)=>{
      if(op==='team.app.timeline')return {conversation,messages:[],hasMore:false,beforeSeq:0}
      if(op==='team.app.send.tasks')return [task]
      if(op==='team.app.send.retry-task')return {...task,state:'queued'}
      throw new Error(op)
    })
    await mount()
    const buttons=renderer!.root.findAllByType('button')
    expect(buttons.some(v=>v.children.join('').includes('仍要发送'))).toBe(false)
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.disabled).toBe(false)
    expect(renderer!.root.findByType(TeamConversationMessage).props.message.content.text_content).toBe('原消息')
    expect(buttons.some(v=>v.children.join('')==='重试')).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('等待发送')
    expect(mocks.call.mock.calls.some(v=>v[0]==='team.app.send.confirm')).toBe(false)
  })

  it('shows durable failed tasks after remount and cancels through the Host owner', async () => {
    const task={conversationRef:conversation.ref,clientUid:'client',content:{text_content:'未发出',template_kind:1},expectedReplySeq:0,fileRefs:[],files:[],taskRef:'failed-task',conversationKey:'key',createdAtMillis:Date.now(),state:'failed',attempts:1,nextAttemptAt:0,error:'无权发送'}
    let tasks=[task]
    mocks.call.mockImplementation(async(op:string)=>{
      if(op==='team.app.timeline')return {conversation,messages:[],hasMore:false,beforeSeq:0}
      if(op==='team.app.send.tasks')return tasks
      if(op==='team.app.send.cancel-task'){tasks=[{...task,state:'cancelled'}];return tasks[0]}
      throw new Error(op)
    })
    await mount()
    expect(renderer!.root.findByType(TeamConversationMessage).props.message.content.text_content).toBe('未发出')
    const cancel=renderer!.root.findAllByType('button').find(v=>v.children.join('')==='取消发送')!
    await act(async()=>{cancel.props.onClick();await tick()})
    expect(mocks.call.mock.calls.find(v=>v[0]==='team.app.send.cancel-task')?.[1]).toEqual({conversationRef:conversation.ref,taskRef:'failed-task'})
    expect(mocks.call.mock.calls.some(v=>v[0]==='team.app.cancel')).toBe(false)
    expect(renderer!.root.findAllByType(TeamConversationMessage)).toHaveLength(0)
  })

  it('keeps a plain draft unsent across remount and reconnect',async()=>{
    await mount();await act(async()=>renderer!.unmount());await mount()
    await act(async()=>{window.dispatchEvent(new Event('online'));await tick()})
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.value).toBe('问题')
    expect(mocks.call.mock.calls.some(v=>v[0]==='team.app.send.enqueue')).toBe(false)
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
    expect(mocks.call.mock.calls.some(v => v[0] === 'team.app.send.enqueue')).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('无法保存发送请求')
  })
  it('keeps Host admission authoritative when browser draft cleanup fails', async () => {
    let task: ReturnType<typeof accepted> | undefined
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return {conversation,messages:[],hasMore:false,beforeSeq:0}
      if (op === 'team.app.send.tasks') return task ? [task] : []
      if (op === 'team.app.send.enqueue') {
        task = accepted()
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        return task
      }
      throw new Error(op)
    })
    await mount(); await send()
    expect(renderer!.root.findAllByType(TeamConversationMessage)).toHaveLength(1)
    expect(renderer!.root.findByType(ArkmeComposerSendButton).props.ariaLabel).toBe('发送')
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.value).toBe('')
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt.uid).toBe(task!.clientUid)
    expect(JSON.stringify(renderer!.toJSON())).toContain('草稿未能')
  })
  it('retains the original request if browser storage also fails during a lost acceptance response', async () => {
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return {conversation,messages:[],hasMore:false,beforeSeq:0}
      if (op === 'team.app.send.enqueue') {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        throw new Error('connection lost')
      }
      return []
    })
    await mount(); await send()
    const request = mocks.call.mock.calls.find(call => call[0] === 'team.app.send.enqueue')![1]
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt.uid).toBe(request.clientUid)
    expect(renderer!.root.findByType(ArkmeComposerSendButton).props.ariaLabel).toBe('重试')
    expect(JSON.stringify(renderer!.toJSON())).toContain('草稿未能保存到本机')
  })
})
