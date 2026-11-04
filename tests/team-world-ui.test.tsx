// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PublishDialog } from '../src/client/ArkmeWorldSurface.js'
import { TeamWorldSurface } from '../src/client/TeamWorldSurface.js'
import { TeamPublicCardDialog } from '../src/client/TeamPublicCardDialog.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeTeam, ArkmeTimelineItem, ArkmeSourceItem } from '../src/types.js'
import { canPublishSelfNote } from '../src/world-publish-source.js'
const mock = vi.hoisted(() => ({ call: vi.fn(), upload: vi.fn(), text: vi.fn(), files: vi.fn(), phone: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => mock.call(...args) }))
vi.mock('../src/sdk/index.js', async original => ({ ...await original<object>(), createArkmeSdk: () => ({ upload: mock.upload, publishWorldText: mock.text, publishWorldFileAssets: mock.files, mediaUrl: (ref: string) => `/media?ref=${ref}` }) }))
vi.mock('../src/client/social-action-guard.js', () => ({ requirePhoneForSocialAction: mock.phone, isSocialBindingRequired: () => false }))
const team: ArkmeTeam = { teamRef: 'sealed-team', name: '即我', jotmoId: 'our_team', currentUserRole: 'member', createdAtMillis: 1, updatedAtMillis: 1 }
let host: HTMLDivElement, root: Root
const published = vi.fn(), close = vi.fn()
const mount = async (ui: React.ReactNode = <PublishDialog actorName="运营小林" onClose={close} onPublished={published} />) => act(async () => root.render(ui))
const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)!
const editor = () => document.querySelector<HTMLElement>('[role="textbox"][aria-label="世界内容"]')!
async function input(text: string) {
  await act(async () => {
    const area = editor(); area.textContent = text
    area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  })
}
async function chooseTeam() {
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="发布身份：我"]')!.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[data-role-action="team:our_team"]')!.click())
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0))
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  mock.call.mockImplementation(async operation => operation === 'team.app.teams' ? [team] : { state: 'backend_pending' })
  mock.phone.mockResolvedValue(undefined); mock.text.mockResolvedValue({ worldPublished: true, visibility: 'visible' })
  mock.files.mockResolvedValue({ worldPublished: true, visibility: 'visible' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('freezes a team command on an uncertain result and retries the exact payload after role loss', async () => {
  let submitted = false
  mock.call.mockImplementation(async (operation, input) => {
    if (operation === 'team.app.teams') return submitted ? [] : [team]
    if (input.action === 'source') return { sourceRef: 'verified-source' }
    if (!submitted) { submitted = true; throw new Error('结果未知') }
    return { pending: false, result: { visibility: 'published' } }
  })
  await mount(); await input('团队稿件'); await chooseTeam()
  expect(document.body.textContent).toContain('由运营小林发布')
  await act(async () => button('发布').click())
  expect(editor().textContent).toBe('团队稿件'); expect(published).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('结果未知')
  await act(async () => window.dispatchEvent(new Event('focus')))
  await act(async () => button('发布').click())
  const writes = mock.call.mock.calls.filter(([op, p]) => op === 'team.world' && p.action === 'submit')
  expect(writes).toHaveLength(2); expect(writes[0]![1]).toEqual(writes[1]![1])
  expect(mock.call.mock.calls.filter(([op, p]) => op === 'team.world' && p.action === 'source')).toHaveLength(1)
  expect(mock.text).not.toHaveBeenCalled(); expect(mock.files).not.toHaveBeenCalled(); expect(published).toHaveBeenCalledOnce()
})
it('starts as a person and keeps normal publication working', async () => {
  await mount(); await input('我的内容')
  expect(document.querySelector('[aria-label="发布身份：我"]')).not.toBeNull()
  await act(async () => button('发布').click())
  expect(mock.text).toHaveBeenCalledWith({ textContent: '我的内容', clientMutationId: expect.any(String) }, expect.any(AbortSignal))
  expect(mock.call.mock.calls.some(([op]) => op === 'team.app.world.prepare')).toBe(false)
  expect(published).toHaveBeenCalledTimes(1)
})

it('keeps a team named personal distinct from the personal identity command', async () => {
  mock.call.mockResolvedValue([{ ...team, name: '个人产品团队', jotmoId: 'personal' }])
  await mount()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="发布身份：我"]')!.click())
  expect(document.querySelectorAll('[data-role-action="personal"]')).toHaveLength(1)
  await act(async () => document.querySelector<HTMLButtonElement>('[data-role-action="team:personal"]')!.click())
  expect(document.querySelector('[aria-label="发布身份：个人产品团队"]')).not.toBeNull()
})

it('keeps a removed team selected and blocked rather than silently falling back to personal publication', async () => {
  await mount(); await input('团队草稿'); await chooseTeam()
  mock.call.mockResolvedValue([])
  await act(async () => window.dispatchEvent(new Event('focus')))
  await act(async () => button('发布').click())
  expect(document.body.textContent).toContain('当前团队身份不可用')
  expect(editor().textContent).toBe('团队草稿')
  expect(mock.text).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled()
  expect(document.querySelector('[aria-label="发布身份：我"]')).toBeNull()
})

it('cancels a pending team check and clears private drafts on account change', async () => {
  let resolve!: (value: unknown) => void
  await mount(); await input('账号42的草稿'); await chooseTeam()
  mock.call.mockImplementation(async operation => operation === 'team.world' ? new Promise(done => { resolve = done }) : [team])
  await act(async () => button('发布').click())
  const signal = mock.call.mock.calls.find(([op]) => op === 'team.world')![2] as AbortSignal
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 99 }))
  expect(signal.aborted).toBe(true); expect(editor().textContent).toBe('')
  await act(async () => resolve({ sourceRef: 'late-source' }))
  expect(published).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled()
})

it('uses a separate team page and guides members to their existing content when publishing from it', async () => {
  mock.call.mockImplementation(async operation => operation === 'team.app.world.view' ? { state: 'ready', team, memberTeam: team, context: { teamRef: team.teamRef, jotmoId: team.jotmoId, name: team.name, capabilities: { publish: true, manage: true, feedback: true, reply: true } }, feed: { items: [], hasMore: false } } : [team])
  await mount(<TeamWorldSurface accountKey="test:42" target={team} actorName="小林" onBack={close} />)
  expect(document.body.textContent).toContain('即我的世界')
  expect(document.body.textContent).toContain('这个团队还没有公开内容')
  expect(document.body.textContent).not.toContain('团队内容页面将在后续版本提供。')
  expect(mock.call.mock.calls.some(([op]) => ['world.user', 'world.mine', 'world.feed'].includes(op))).toBe(false)
  await act(async () => button('发布').click())
  expect(document.getElementById('world-publish-guide-title')?.textContent).toBe('把你发过的内容分享给世界')
  expect(editor()).toBeNull()
})

it('shows public team content before optional member presentation resolves', async () => {
  const post = { recordRef: 'public-team-post', authorName: team.name, teamAuthor: { jotmoId: team.jotmoId, name: team.name }, headline: '', textContent: '团队公开正文', tags: [], templateKind: 0, createdAtMillis: 1, publishedAtMillis: 1, imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, extendCount: 0 }
  mock.call.mockImplementation(async operation => operation === 'team.app.world.view' ? { state: 'ready', team, context: { teamRef: team.teamRef, jotmoId: team.jotmoId, name: team.name, capabilities: { publish: true, manage: false, feedback: false, reply: true } }, feed: { items: [post], hasMore: false } } : operation === 'team.app.teams' ? new Promise(() => {}) : { items: [], unavailableRecordRefs: [] })
  await mount(<TeamWorldSurface accountKey="test:42" target={team} onBack={close} />)
  expect(document.body.textContent).toContain('团队公开正文')
  expect(document.querySelector('[data-world-team-badge]')?.textContent).toContain('团队')
  expect(document.body.textContent).not.toContain('正在加载团队世界')
  expect(mock.call).toHaveBeenCalledWith('team.app.world.view', { expectedAccountKey: 'test:42', jotmoId: team.jotmoId, includeMemberTeam: false }, expect.any(AbortSignal))
})

it('offers the same team World navigation from public cards including the current team conversation', async () => {
  const navigate = vi.spyOn(arkmeUi, 'showTeamWorld')
  await mount(<TeamPublicCardDialog accountKey="test:42" jotmoId="our_team" onClose={close}
    currentChannel={{ name: '即我', jotmoId: 'our_team', enabled: false } as never} />)
  await act(async () => button('团队的世界').click())
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: '即我', jotmoId: 'our_team' }))
  expect(close).toHaveBeenCalledTimes(1)
})

it('prefills committed source text and existing assets without uploading or changing the source', async () => {
  mock.call.mockImplementation(async operation => operation === 'team.app.teams' ? [team] : {
    sourceRef: 'self', itemUid: 'note', version: 7, title: '产品更新', textContent: '完整正文', sendAtMillis: 1,
    attachments: [{ asset: { fileAssetUid: 'existing-image', fileName: 'existing.png', mimeType: 'image/png', fileKind: 1, size: 12 }, block: { kind: 'image', mediaRef: 'image-ref' } }],
  })
  await mount(<PublishDialog origin={{ sourceRef: 'self', itemUid: 'note' }} onClose={close} onPublished={published} />)
  expect(editor().textContent).toBe('产品更新\n\n完整正文')
  expect(document.activeElement).toBe(editor())
  expect(document.querySelectorAll('[data-arkme-attachment-tile]')).toHaveLength(1)
  await act(async () => button('发布').click())
  expect(mock.files).toHaveBeenCalledWith(expect.objectContaining({ textContent: '产品更新\n\n完整正文', fileAssets: [expect.objectContaining({ fileAssetUid: 'existing-image' })] }), expect.any(AbortSignal))
  expect(mock.upload).not.toHaveBeenCalled()
  expect(mock.call.mock.calls.every(([op]) => ['team.app.teams', 'world.source-draft'].includes(op))).toBe(true)
})

it('only offers World publication for actionable owned personal records', () => {
  const note = { isMe: true, itemUid: 'note', messageActionRef: 'action' } as ArkmeTimelineItem
  const self = { kind: 'send_to_self' } as ArkmeSourceItem
  expect(canPublishSelfNote(self, note)).toBe(true)
  expect(canPublishSelfNote({ kind: 'private_chat' } as never, note)).toBe(true)
  expect(canPublishSelfNote({ kind: 'group_chat' } as never, note)).toBe(true)
  expect(canPublishSelfNote(self, { ...note, messageActionRef: '', itemUid: 'home-operation:event' })).toBe(false)
  expect(canPublishSelfNote(self, { ...note, isMe: false })).toBe(false)
})

it('blocks unsupported source media until explicitly removed from the publication copy', async () => {
  mock.call.mockImplementation(async operation => operation === 'team.app.teams' ? [team] : {
    sourceRef: 'self', itemUid: 'note', version: 7, title: '', textContent: '语音转写', sendAtMillis: 1,
    attachments: [{ asset: { fileAssetUid: 'voice-asset', fileName: 'voice.mp3', mimeType: 'audio/mpeg', fileKind: 2, size: 12 } }],
  })
  await mount(<PublishDialog origin={{ sourceRef: 'self', itemUid: 'note' }} onClose={close} onPublished={published} />)
  expect(button('发布').disabled).toBe(true)
  expect(document.body.textContent).toContain('原快记不受影响')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="移除voice.mp3"]')!.click())
  expect(button('发布').disabled).toBe(false)
  expect(mock.text).not.toHaveBeenCalled()
})

it('retains successful uploads and the publication mutation identity across retries', async () => {
  mock.upload.mockResolvedValue({ fileAssetUid: 'uploaded-image', fileName: 'new.png', mimeType: 'image/png', fileKind: 1, size: 3 })
  mock.files.mockRejectedValueOnce(new Error('发布结果未知')).mockResolvedValueOnce({ worldPublished: true, visibility: 'visible' })
  await mount(); await input('新图')
  await act(async () => {
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(picker, 'files', { configurable: true, value: [new File(['png'], 'new.png', { type: 'image/png' })] })
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(document.querySelectorAll('[data-arkme-attachment-tile]')).toHaveLength(1)
  await act(async () => button('发布').click())
  expect(editor().textContent).toBe('新图'); expect(mock.files).toHaveBeenCalledTimes(1)
  await act(async () => button('发布').click())
  expect(mock.upload).toHaveBeenCalledTimes(1)
  expect(mock.files.mock.calls[0]![0].clientMutationId).toBe(mock.files.mock.calls[1]![0].clientMutationId)
})

it('loads the canonical Arko user message and its image through the separate owner read', async () => {
  mock.call.mockImplementation(async op => op === 'team.app.teams' ? [team] : { textContent: '我的提问', sendAtMillis: 1,
    attachments: [{ selection: { fileAssetUid: 'image' }, asset: { fileAssetUid: 'image', fileName: 'image.png', mimeType: 'image/png', size: 10, fileKind: 1 } }] })
  await mount(<PublishDialog origin={{ kind: 'arko', sourceRef: 'arko:88', itemUid: 'history:101', sessionId: 88, messageId: 101 }} onClose={close} onPublished={published}/>)
  expect(mock.call).toHaveBeenCalledWith('world.arko-source-draft', { sessionId: 88, messageId: 101 }, expect.any(AbortSignal))
  expect(editor().textContent).toBe('我的提问')
  await act(async () => button('发布').click())
  expect(mock.files).toHaveBeenCalledWith(expect.objectContaining({ textContent: '我的提问', fileAssets: [expect.objectContaining({ fileAssetUid: 'image' })] }), expect.any(AbortSignal))
})
it('keeps native attachments explicit instead of silently publishing only text', async () => {
  await mount(<PublishDialog origin={{ kind: 'local', sourceRef: 'dsh:s1', itemUid: 'input', sourceLabel: 'DSH', textContent: '我的提问', sendAtMillis: 1, hasAttachments: true }} onClose={close} onPublished={published}/>)
  expect(editor().textContent).toBe('我的提问')
  expect(document.body.textContent).toContain('原消息附件')
  await act(async () => button('发布').click())
  expect(mock.text).not.toHaveBeenCalled(); expect(mock.files).not.toHaveBeenCalled()
})

it('offers every member team and submits the chosen team identity', async () => {
  mock.call.mockImplementation(async (operation, input) => {
    if (operation === 'team.app.teams') return [team, { ...team, teamRef: 'member-team', jotmoId: 'member_team', name: '成员团队', currentUserRole: 'member' }]
    if (input.action === 'source') return { sourceRef: 'verified-source' }
    return { pending: false, result: { visibility: 'published' } }
  })
  await mount(); await input('普通成员的团队内容')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="发布身份：我"]')!.click())
  expect(document.querySelector('[data-role-action="team:our_team"]')).not.toBeNull()
  await act(async () => document.querySelector<HTMLButtonElement>('[data-role-action="team:member_team"]')!.click())
  await act(async () => button('发布').click())
  expect(mock.call.mock.calls.find(([op, p]) => op === 'team.world' && p.action === 'submit')?.[1]).toMatchObject({ teamRef: 'member-team', change: 'publish', expectedRevision: 0 })
  expect(mock.text).not.toHaveBeenCalled(); expect(published).toHaveBeenCalledOnce()
})
it('revalidates loaded team pages on focus without losing pagination or issuing personal feed reads', async () => {
  let pagingCallback: IntersectionObserverCallback | undefined
  vi.stubGlobal('IntersectionObserver',class {
    constructor(private callback: IntersectionObserverCallback){}
    observe(el:Element){if(el.hasAttribute('data-world-load-more-sentinel'))pagingCallback=this.callback}
    disconnect(){}
  })
  const first = { recordRef:'one',authorName:'即我',textContent:'第一页正文',headline:'',tags:[],templateKind:0,imageRefs:[],imageCount:0,videoCount:0,voiceCount:0,extendCount:0,createdAtMillis:1,publishedAtMillis:1 }
  const second = {...first,recordRef:'two',textContent:'第二页正文'}
  mock.call.mockImplementation(async (op,input)=>op==='team.app.world.view'?{state:'ready',team,context:{teamRef:team.teamRef,jotmoId:team.jotmoId,name:team.name,capabilities:{}},feed:{items:[first],hasMore:true,nextCursor:'next'}}:op==='team.world'?{items:[second],hasMore:false}:op==='world.reactions.prepare'?{items:[],unavailableRecordRefs:[]}:{})
  await mount(<TeamWorldSurface accountKey="test:42" target={team} onBack={close}/>)
  await act(async()=>pagingCallback!([{isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver))
  await act(async()=>window.dispatchEvent(new Event('focus')))
  expect(document.body.textContent).toContain('第一页正文');expect(document.body.textContent).toContain('第二页正文')
  expect(mock.call.mock.calls.filter(([op,input])=>op==='team.world'&&input.action==='feed')).toHaveLength(2)
  expect(mock.call.mock.calls.some(([op])=>['world.feed','world.mine','world.user'].includes(op))).toBe(false)
})
