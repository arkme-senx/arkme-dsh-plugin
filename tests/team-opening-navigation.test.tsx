// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TeamConversation, TeamMessage, TeamOpen } from '../src/team-app-contract.js'
import { TeamConversationDirectory } from '../src/client/TeamConversationDirectory.js'
import { TeamMessagingMount, TeamMessagingPanel } from '../src/client/TeamMessagingPanel.js'
import { refreshTeamDirectory } from '../src/client/team-conversation-directory.js'
import { openTeamMessages } from '../src/client/team-messaging-events.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { teamDirectoryPreferences } from '../src/client/team-directory-preferences.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
let root: Root, host: HTMLDivElement
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
function Workspace() {
  const state = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  return <><TeamMessagingMount accountKey="navigation-test" active />
    {state.mode === 'team' && state.teamDirectory && <TeamConversationDirectory accountKey="navigation-test" folder={state.teamDirectory}
      {...(state.teamIntent?.kind==='conversation'?{selectedKey:state.teamIntent.conversation.key}:{})} onBack={()=>arkmeUi.closeTeamDirectory()} />}
    {state.mode === 'team' && state.teamIntent && <TeamMessagingPanel accountKey="navigation-test" intent={state.teamIntent} />}</>
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  mocks.call.mockReset(); arkmeUi.authChanged(true, true); arkmeUi.showHarness()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it.each([false, true])('opens immediately and never restores from mounting/navigation effects (account switch: %s)', async switchAccount => {
  const channel = { teamRef: 'save-race', name: '测试团队', jotmoId: 'save_race', publicRef: 'a'.repeat(32), link: '', enabled: true, revision: 1, canManage: true }
  const first: TeamConversation = { key: 'old-visitor', ref: 'old-visitor', side: 'external', channel, lastSeq: 0, latestTeamReplySeq: 0, myReadSeq: 0, unread: 0, needsReply: false, blocked: false, revision: 1, updatedAt: 1 }
  const second = { ...first, key: 'current-visitor', ref: 'current-visitor' }
  const restore = vi.spyOn(teamDirectoryPreferences, 'restoreTarget').mockRejectedValue(new Error('offline'))
  mocks.call.mockImplementation(async (op: string, input: { conversationRef?: string }) => {
    if (op === 'team.app.timeline') return { conversation: input.conversationRef === first.ref ? first : second, messages: [], hasMore: false, beforeSeq: 0 }
    return {}
  })
  try {
    await act(async () => { root.render(<TeamMessagingPanel accountKey="prod:save-race" intent={{ kind: 'conversation', conversation: first }} />); await tick() })
    await act(async () => { root.render(<TeamMessagingPanel accountKey={switchAccount ? 'prod:another-account' : 'prod:save-race'} intent={{ kind: 'conversation', conversation: second }} />); await tick() })
    expect(mocks.call.mock.calls.some(([op, input]) => op === 'team.app.timeline' && input.conversationRef === second.ref)).toBe(true)
    expect(restore).not.toHaveBeenCalled()
    expect(host.querySelector('.team-conversation-pane')).not.toBeNull()
  } finally { restore.mockRestore() }
})

it.each(['success', 'failure'])('leaving Team for a normal conversation cancels late opening %s', async outcome => {
  let resolve!: (value: TeamOpen) => void, reject!: (error: Error) => void
  const pending = new Promise<TeamOpen>((ok, no) => { resolve = ok; reject = no })
  mocks.call.mockImplementation(async (op: string) => {
    if (op === 'team.app.attention') return {team:false, external:false, applications:false}
    if (op === 'team.app.conversations') return {items:[], hasMore:false}
    if (op === 'team.app.open') return pending
    throw new Error(op)
  })
  await act(async () => { root.render(<Workspace />); await tick() })
  await act(async () => { openTeamMessages({kind:'link', publicRef:'a'.repeat(32)}); await tick() })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.textContent).toContain('正在打开对话…')
  await act(async () => { arkmeUi.focusSendToSelf(); await tick() })
  await act(async () => {
    if(outcome === 'failure') reject(new Error('old opening failed'))
    else resolve({channel:{teamRef:'old-team', name:'旧入口', jotmoId:'old_team', publicRef:'a'.repeat(32),link:'',enabled:true,revision:1,canManage:false},openInbox:true})
    await tick()
  })
  expect(arkmeUi.getSnapshot().mode).toBe('source')
  expect(document.body.textContent).not.toContain('old opening failed')
  expect(mocks.call.mock.calls.some(([op]) => op === 'team.app.timeline')).toBe(false)
})

it('official setup failure has a local retry and no unrelated membership UI', async () => {
  mocks.call.mockImplementation(async (op: string) => {
    if (op === 'team.app.official') throw new Error('暂时无法联系作者，请稍后重试')
    if (op === 'team.app.conversations') return { items: [], hasMore: false }
    return { team: false, external: false, applications: false }
  })
  await act(async () => { root.render(<Workspace />); openTeamMessages({kind:'official'}); await tick() })
  expect(host.textContent).toContain('联系作者')
  expect(host.textContent).toContain('暂时无法联系作者')
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(host.textContent).not.toMatch(/无权访问|创建团队|加入团队|收件箱/)
  await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); await tick() })
  expect(mocks.call.mock.calls.filter(([op]) => op === 'team.app.official')).toHaveLength(2)
})

it('keeps an opened empty member inbox stable while focus refresh waits for the other side', async () => {
  const channel = { teamRef: 'official', name: '即我', jotmoId: 'arkme_cn', publicRef: 'a'.repeat(32), link: '', enabled: true, revision: 1, canManage: false }
  let finishInitial!: (value: unknown) => void
  const initial = new Promise(resolve => { finishInitial = resolve })
  let finishRefresh!: (value: unknown) => void
  const refresh = new Promise(resolve => { finishRefresh = resolve })
  let phase: 'initial' | 'refresh' | 'ready' = 'initial'
  mocks.call.mockImplementation(async (op: string, params: { side?: string }) => {
    if (op === 'team.app.official') return channel
    if (op === 'team.app.open') return { channel, openInbox: true }
    if (op === 'team.app.attention') return { team: false, external: false, applications: false }
    if (op === 'team.app.conversations') {
      if (params.side === 'external' && phase === 'initial') return initial
      if (params.side === 'external' && phase === 'refresh') return refresh
      return { items: [], hasMore: false }
    }
    throw new Error(op)
  })
  await act(async () => { root.render(<Workspace />); openTeamMessages({ kind: 'official' }); await tick() })
  expect(host.textContent).toContain('正在加载团队对话…')
  expect(host.textContent).not.toContain('正在打开对话…')
  await act(async () => { phase = 'ready'; finishInitial({ items: [], hasMore: false }); await tick() })
  expect(host.textContent).toContain('还没有团队对话')
  await act(async () => { phase = 'refresh'; window.dispatchEvent(new Event('focus')); await tick() })
  expect(host.textContent).toContain('还没有团队对话')
  expect(host.textContent).not.toMatch(/正在打开对话|正在加载团队对话/)
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(mocks.call.mock.calls.filter(([op]) => op === 'team.app.open')).toHaveLength(1)
  await act(async () => { phase = 'ready'; finishRefresh({ items: [], hasMore: false }); await tick() })
  expect(host.textContent).toContain('还没有团队对话')
})

it('returns to the same team after replying, switches visitors and keeps each draft', async () => {
  const channel = { teamRef: 'studio', name: '设计工作室', jotmoId: 'studio', publicRef: 'a'.repeat(32), link: '', enabled: true, revision: 1, canManage: true }
  const first: TeamConversation = { key: 'visitor-a', ref: 'visitor-a', side: 'team', channel, visitor: { nickname: '来访者甲' }, lastSeq: 0, latestTeamReplySeq: 0, myReadSeq: 0, unread: 1, needsReply: true, blocked: false, revision: 1, updatedAt: Date.now() }
  const second = { ...first, key: 'visitor-b', ref: 'visitor-b', visitor: { nickname: '来访者乙' }, unread: 0 }
  const elsewhere = { ...first, key: 'other-team', ref: 'other-team', channel: { ...channel, teamRef: 'another-studio', jotmoId: 'another_studio', name: '其他团队' }, visitor: { nickname: '其他团队来访者' } }
  const messages: TeamMessage[] = []
  mocks.call.mockImplementation(async (op: string, params: { side?: string; conversationRef?: string; clientUid?: string; content?: { text_content: string } }) => {
    if (op === 'team.app.attention') return {team: false, external: false, applications: false}
    if (op === 'team.app.channel') return {...channel, teamRef:'fresh-encrypted-channel-reference'}
    if (op === 'team.app.conversations') return {items: params.side === 'team' ? [first, second, elsewhere] : [], hasMore: false}
    if (op === 'team.app.timeline') return {conversation: params.conversationRef === first.ref ? first : second, messages: params.conversationRef === first.ref ? messages : [], hasMore: false, beforeSeq: 0}
    if (op === 'team.app.send.enqueue') {
      const message: TeamMessage = {key:'sent', ref:'sent', seq:1, revision:1, side:'team', sender:{nickname:'我'}, own:true, state:'published', createdAt:Date.now(), canEdit:true, canDelete:true, media:[], version:1, contentStatus:'available', content:params.content!}
      messages.push(message)
      first.preview = {status:'available', text: params.content!.text_content, hasMedia:false}
      return {...params,taskRef:'task',conversationKey:first.key,createdAtMillis:Date.now(),state:'sent',files:[],fileRefs:[],attempts:0,nextAttemptAt:0,message}
    }
    if (op === 'team.app.read') return {}
    throw new Error(op)
  })
  const click = async (label: string) => {
    const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.includes(label))
    expect(target, label).toBeDefined()
    await act(async () => { target!.click(); await tick() })
  }
  const type = async (value: string) => {
    await act(async () => {
      const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')!
      editor.textContent = value
      editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:value}))
      await tick()
    })
  }
  await act(async () => { root.render(<Workspace />); openTeamMessages({kind:'team', teamRef:channel.teamRef}); await tick() })
  expect(host.querySelectorAll('.team-conversation-row')).toHaveLength(2)
  expect(host.querySelector('[aria-label="团队会话分类"]')).toBeNull()
  expect(host.querySelector('[aria-label="联系用户"]')).not.toBeNull()
  expect(mocks.call.mock.calls.some(([op]) => op === 'team.app.group.directory')).toBe(false)
  expect(host.textContent).not.toContain('其他团队来访者')
  expect(mocks.call.mock.calls.some(([op]) => op === 'team.app.read')).toBe(false)
  await click('来访者甲')
  await type('回复甲')
  await click('发送')
  expect(messages[0]?.content?.text_content).toBe('回复甲')
  await type('甲的未发草稿')
  await click('返回 Arkme 会话列表')
  expect(arkmeUi.getSnapshot().teamDirectory).toBeUndefined()
  expect(arkmeUi.getSnapshot().teamIntent).toMatchObject({kind:'conversation',conversation:{key:first.key}})
  expect(host.querySelector('[contenteditable="true"]')?.textContent).toBe('甲的未发草稿')
  await act(async () => { openTeamMessages({kind:'team',teamRef:channel.teamRef,channel}); await tick() })
  expect(host.querySelectorAll('.team-conversation-row')).toHaveLength(2)
  expect(host.textContent).toContain('回复甲')
  await click('来访者乙')
  expect(host.querySelector('[contenteditable="true"]')?.textContent).toBe('')
  await type('乙的未发草稿')
  await click('来访者甲')
  expect(host.querySelector('[contenteditable="true"]')?.textContent).toBe('甲的未发草稿')
  expect(mocks.call.mock.calls.some(([op]) => op === 'team.app.block')).toBe(false)
})

it('finds a selected team on later pages without marking it read or opening a visitor', async () => {
  const channel={teamRef:'late',name:'分页团队',jotmoId:'late',publicRef:'',link:'',enabled:true,revision:1,canManage:false}
  const target: TeamConversation={key:'late-visitor',ref:'late-visitor',side:'team',channel,visitor:{nickname:'后页访客'},lastSeq:3,latestTeamReplySeq:0,myReadSeq:0,unread:3,needsReply:true,blocked:false,revision:1,updatedAt:10}
  mocks.call.mockImplementation(async (op:string,params:{side?:string;cursor?:string})=>{
    if(op==='team.app.attention') return {team:false,external:false,applications:false}
    if(op==='team.app.conversations') return params.side==='external'?{items:[],hasMore:false}:params.cursor?{items:[target],hasMore:false}:{items:[],hasMore:true,nextCursor:'page2'}
    throw new Error(op)
  })
  await act(async()=>{root.render(<Workspace/>);openTeamMessages({kind:'team',teamRef:channel.teamRef,channel});await tick()})
  expect(host.textContent).toContain('后页访客')
  expect(host.textContent).toContain('选择一个对话')
  expect(mocks.call.mock.calls.some(([op,p])=>op==='team.app.conversations'&&p.cursor==='page2')).toBe(true)
  expect(mocks.call.mock.calls.some(([op])=>op==='team.app.read'||op==='team.app.timeline')).toBe(false)
})
it('background list reorder and failure retain selection, scroll and readable cached rows', async () => {
  const channel={teamRef:'stable',name:'稳定团队',jotmoId:'stable',publicRef:'',link:'',enabled:true,revision:1,canManage:false}
  const first: TeamConversation={key:'a',ref:'a',side:'team',channel,visitor:{nickname:'甲'},lastSeq:0,latestTeamReplySeq:0,myReadSeq:0,unread:0,needsReply:false,blocked:false,revision:1,updatedAt:10}
  let rows=[first,{...first,key:'b',ref:'b',visitor:{nickname:'乙'},updatedAt:5}], failed=false
  mocks.call.mockImplementation(async(op:string,params:{side?:string})=>{
    if(op==='team.app.attention')return {team:false,external:false,applications:false}
    if(op==='team.app.conversations') {if(failed)throw new Error('暂时离线');return {items:params.side==='team'?rows:[],hasMore:false}}
    if(op==='team.app.timeline')return {conversation:first,messages:[],hasMore:false,beforeSeq:0}
    return []
  })
  await act(async()=>{root.render(<Workspace/>);openTeamMessages({kind:'conversation',conversation:first});await tick()})
  const viewport=host.querySelector<HTMLDivElement>('[data-arkme-overlay-scroll-viewport]')!
  await act(async()=>{viewport.scrollTop=120;viewport.dispatchEvent(new Event('scroll'));await tick()})
  rows=[first,{...rows[1]!,updatedAt:30}]
  await act(async()=>{await refreshTeamDirectory('navigation-test');await tick()})
  expect([...host.querySelectorAll('[role="treeitem"]')].map(node=>node.textContent?.startsWith('乙'))).toEqual([true,false])
  expect(host.querySelector('[role="treeitem"][aria-selected="true"]')?.textContent).toContain('甲')
  expect(viewport.scrollTop).toBe(120)
  failed=true
  await act(async()=>{await refreshTeamDirectory('navigation-test');await tick()})
  expect(host.textContent).toContain('暂时离线')
  expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(2)
  await act(async()=>{arkmeUi.closeTeamDirectory();await tick()})
  await act(async()=>{openTeamMessages({kind:'team',teamRef:channel.teamRef,channel});await tick()})
  expect(host.querySelector<HTMLDivElement>('[data-arkme-overlay-scroll-viewport]')?.scrollTop).toBe(120)
  expect(arkmeUi.getSnapshot().teamIntent).toMatchObject({kind:'conversation',conversation:{key:'a'}})
})
