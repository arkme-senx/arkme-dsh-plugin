// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TeamMessageDetail } from '../src/client/TeamMessageDetail.js'
import type { TeamConversation, TeamMessage } from '../src/team-app-contract.js'
import { act as rendererAct, create as createRenderer } from 'react-test-renderer'
import { TeamConversationPane } from '../src/client/TeamMessagingPanel.js'
import { TeamConversationMessage } from '../src/client/TeamConversationMessage.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), extensions: vi.fn() }))
vi.mock('react-dom', async original => ({...await original<typeof import('react-dom')>(),createPortal:(children:unknown)=>children}))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({
  readTeamExtensions: mocks.extensions,
  fileCapabilities: async () => ({version:1,maxAttachments:9,maxFileBytes:1024,maxImageBytes:1024}),
  localFileUrl: (ref: string) => `/local/${ref}`,
}) }))

it('parity: whole-message parent text remains visible in Team reading details', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const message: TeamMessage = {
    ref:'reply-ref',key:'reply',seq:2,revision:1,side:'team',sender:{nickname:'回复作者'},own:false,
    state:'published',createdAt:1792400000000,canEdit:false,canDelete:false,version:1,
    contentStatus:'available',media:[],content:{text_content:'回复正文',template_kind:1},
    reply:{ref:'parent-ref',key:'parent',seq:1,version:1,state:'available',text:'这是一条需要完整显示的原消息',sender:{nickname:'原作者'}},
  }
  mocks.extensions.mockResolvedValue({message,items:[],totalCount:0,hasMore:false,nextSeq:0,throughSeq:2})
  const conversation = {ref:'conversation',key:'key',side:'team',channel:{name:'测试团队'},visitor:{nickname:'访客'}} as TeamConversation
  try {
    await act(async () => root.render(<TeamMessageDetail message={message} conversation={conversation} avatar={null}
      onClose={() => {}} onLocate={() => {}} onLocateReply={() => {}} />))
    expect(host.querySelector('[data-arkme-quote-preview], [data-arkme-extension-parent-preview]')?.textContent).toContain(message.reply!.text)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})

it('parity: a retained Team reply keeps its parent on its local failure bubble', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  localStorage.clear()
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:11})
  const conversation: TeamConversation = {ref:'conv',key:'key',side:'external',
    channel:{teamRef:'team',name:'团队',jotmoId:'arkme_cn',publicRef:'a'.repeat(32),link:'',enabled:true,revision:1,canManage:false},
    lastSeq:0,latestTeamReplySeq:0,myReadSeq:0,unread:0,needsReply:false,blocked:false,revision:1,updatedAt:1}
  const reply = {messageRef:'parent-ref',messageKey:'parent',version:1,text:'原消息',senderName:'原作者'}
  mocks.call.mockImplementation(async (op: string) => op === 'team.app.timeline'
    ? {conversation,messages:[],hasMore:false,beforeSeq:0}
    : op === 'team.app.send.tasks' ? [{conversationRef:'conv',conversationKey:'key',clientUid:'failed-reply',taskRef:'task',
      content:{text_content:'回复正文',template_kind:1},reply,expectedReplySeq:0,fileRefs:[],files:[],createdAtMillis:1,
      state:'failed',attempts:1,nextAttemptAt:0,error:'网络失败'}] : [])
  let renderer: ReturnType<typeof createRenderer> | undefined
  try {
    await rendererAct(async () => {
      renderer = createRenderer(<TeamConversationPane conversation={conversation} accountKey="test:11" onChanged={() => {}} />,
        {createNodeMock: node => typeof node.type === 'string' ? document.createElement(node.type) : null})
      await Promise.resolve(); await Promise.resolve()
    })
    const row = renderer!.root.findAllByType(TeamConversationMessage).find(row => row.props.message.key === 'failed-reply')!
    expect(row).toBeDefined()
    expect(row.props.message.reply?.text).toBe(reply.text)
  } finally {
    await rendererAct(async () => renderer?.unmount())
    vi.unstubAllGlobals()
  }
})
