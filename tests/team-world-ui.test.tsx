// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PublishDialog, WorldCard } from '../src/client/ArkmeWorldSurface.js'
import { TeamWorldSurface } from '../src/client/TeamWorldSurface.js'
import { TeamWorldActivityContent } from '../src/client/TeamWorldActivity.js'
import { TeamWorldManagement } from '../src/client/TeamWorldManagement.js'
import { TeamPublicCardDialog } from '../src/client/TeamPublicCardDialog.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeTeam, ArkmeTimelineItem, ArkmeSourceItem, ArkmeWorldFeedItem } from '../src/types.js'
import { canPublishSelfNote } from '../src/world-publish-source.js'
const mock = vi.hoisted(() => ({ call: vi.fn(), upload: vi.fn(), text: vi.fn(), files: vi.fn(), phone: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => mock.call(...args) }))
vi.mock('../src/sdk/index.js', async original => ({ ...await original<object>(), createArkmeSdk: () => ({ upload: mock.upload, publishWorldText: mock.text, publishWorldFileAssets: mock.files, mediaUrl: (ref: string) => `/media?ref=${ref}` }) }))
vi.mock('../src/client/social-action-guard.js', () => ({ requirePhoneForSocialAction: mock.phone, isSocialBindingRequired: () => false }))
const team: ArkmeTeam = { teamRef: 'sealed-team', name: '即我', jotmoId: 'our_team', currentUserRole: 'admin', createdAtMillis: 1, updatedAtMillis: 1 }
const comment: ArkmeWorldFeedItem = { recordRef:'comment-public',authorName:'小李',headline:'',textContent:'这是具体的评论内容',imageRefs:[],imageCount:0,tags:[],templateKind:0,createdAtMillis:100,publishedAtMillis:100,videoCount:0,voiceCount:0,extendCount:0 }
let host: HTMLDivElement, root: Root
const published = vi.fn(), close = vi.fn()
const mount = async (ui: React.ReactNode = <PublishDialog actorName="运营小林" onClose={close} onPublished={published} />) => act(async () => root.render(ui))
const button = (label: string) => [...document.querySelectorAll<HTMLElement>('button,[role=button]')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)! as HTMLButtonElement
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
  mock.call.mockImplementation(async (operation, input) => operation === 'team.app.teams' ? [team] : operation === 'team.world' && input.action === 'source' ? { sourceRef: 'verified-source' } : { pending: false, result: { visibility: 'published' } })
  mock.phone.mockResolvedValue(undefined); mock.text.mockResolvedValue({ worldPublished: true, visibility: 'visible' })
  mock.files.mockResolvedValue({ worldPublished: true, visibility: 'visible' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('previews private original images directly and releases bytes when the row unmounts', async () => {
  const createURL = vi.fn(() => 'blob:original'), revokeURL = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createURL; static revokeObjectURL = revokeURL })
  mock.call.mockImplementation(async (operation, input) => {
    if (operation === 'image.read') return { mediaType: 'image/png', bytes: 3, dataBase64: 'cG5n' }
    if (input.action === 'originals') return { items: [{ contentRef: 'content', recordRef: 'public', revision: 2, title: '原稿', text: '正文', format: 'plain', sourceKind: 'local', assets: [{ imageRef: 'sealed-image', mimeType: 'image/png', size: 3 }], deleted: false, publicRequested: false, pending: false, updatedAt: 1 }], hasMore: false }
    throw new Error('unexpected')
  })
  await mount(<TeamWorldManagement accountKey="test:42" context={{ teamRef: team.teamRef, jotmoId: team.jotmoId, name: team.name, capabilities: { publish: true, manage: true, feedback: true, reply: true } }} />)
  expect(document.querySelector('img[alt="图片预览"]')?.getAttribute('src')).toBe('blob:original')
  expect(mock.call).toHaveBeenCalledWith('image.read', { imageRef: 'sealed-image' }, expect.any(AbortSignal))
  await act(async () => root.render(null))
  expect(revokeURL).toHaveBeenCalledWith('blob:original')
})

it('defaults replies to the person and freezes an explicitly selected team reply across an unknown result', async () => {
  let writes = 0
  mock.call.mockImplementation(async (operation, input) => {
    if (operation === 'team.app.teams') return writes ? [] : [team]
    if (operation === 'world.replies') return { items: [], hasMore: false }
    if (operation === 'team.world' && input.action === 'source') return { sourceRef: 'reply-source' }
    if (operation === 'team.world' && input.action === 'submit') {
      if (++writes === 1) throw new Error('网络结果未知')
      return { pending: false, result: { visibility: 'published' } }
    }
    return { items: [], unavailableRecordRefs: [] }
  })
  await mount(<WorldCard item={{ recordRef: 'root', teamAuthor: { jotmoId: team.jotmoId, name: team.name }, authorName: team.name, headline: '', textContent: '团队帖子', tags: [], templateKind: 0, createdAtMillis: 1, publishedAtMillis: 1, imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, extendCount: 0 }} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen onOpenInteractions={() => {}} onInteractionCreated={published} onToggleVoiceprint={() => {}} />)
  expect(document.querySelector('[aria-label="发布身份：我"]')).not.toBeNull()
  await chooseTeam()
  await act(async () => {
    const input = document.querySelector<HTMLTextAreaElement>('[aria-label="评论内容"]')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '以团队身份回复')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('发送').click())
  expect(document.body.textContent).toContain('发送结果待确认')
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
  await act(async () => button('发送').click())
  const submissions = mock.call.mock.calls.filter(([op, input]) => op === 'team.world' && input.action === 'submit')
  expect(submissions).toHaveLength(2)
  expect(submissions[0]![1]).toEqual(submissions[1]![1])
  expect(submissions[0]![1]).toMatchObject({ teamRef: team.teamRef, draft: { text: '以团队身份回复', parentRef: 'root', sourceRef: 'reply-source' } })
  expect(mock.call.mock.calls.some(([op]) => op === 'world.interactions.create-text')).toBe(false)
  expect(published).toHaveBeenCalledWith('root')
})

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
  expect(document.body.textContent).toContain('发布结果待确认')
  await act(async () => window.dispatchEvent(new Event('focus')))
  await act(async () => button('确认原发布结果').click())
  const writes = mock.call.mock.calls.filter(([op, p]) => op === 'team.world' && p.action === 'submit')
  expect(writes).toHaveLength(2); expect(writes[0]![1]).toEqual(writes[1]![1])
  expect(mock.call.mock.calls.filter(([op, p]) => op === 'team.world' && p.action === 'source')).toHaveLength(1)
  expect(mock.text).not.toHaveBeenCalled(); expect(mock.files).not.toHaveBeenCalled(); expect(published).toHaveBeenCalledOnce()
})
it('does not offer ordinary members the team publishing identity', async () => {
  mock.call.mockResolvedValue([{ ...team, currentUserRole: 'member' }])
  await mount(); await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="发布身份：我"]')!.click())
  expect(document.querySelector('[data-role-action="team:our_team"]')).toBeNull()
})

it('starts as a person and keeps normal publication working', async () => {
  await mount(); await input('我的内容')
  expect(document.querySelector('[aria-label="发布身份：我"]')).not.toBeNull()
  await act(async () => button('发布').click())
  expect(mock.text).toHaveBeenCalledWith({ textContent: '我的内容', clientMutationId: expect.any(String) }, expect.any(AbortSignal))
  expect(mock.call.mock.calls.some(([op]) => op === 'team.world')).toBe(false)
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
  expect(mock.call.mock.calls.some(([op]) => ['world.user', 'world.mine', 'world.feed'].includes(op))).toBe(false)
  await act(async () => button('发布').click())
  expect(document.getElementById('world-publish-guide-title')?.textContent).toBe('把你发过的内容分享给世界')
  expect(editor()).toBeNull()
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

it('retains my team operation receipt after role loss without exposing the current original', async () => {
  mock.call.mockImplementation(async (_operation, input) => {
    if (input.action === 'activity') return { items: [{ requestUid: 'done', contentRef: 'content', action: 'publish', acceptedAt: 100, pending: false, revision: 1, result: { visibility: 'published' } }], hasMore: false }
    if (input.action === 'original') throw new Error('当前没有团队原稿权限')
    throw new Error('unexpected')
  })
  await mount(<TeamWorldActivityContent accountKey="test:42" />)
  expect(document.body.textContent).toContain('当时结果：已公开')
  expect(mock.call).toHaveBeenCalledTimes(1)
  await act(async () => button('查看当前原稿').click())
  expect(document.body.textContent).toContain('当前没有团队原稿权限')
  expect(document.body.textContent).toContain('当时结果：已公开')
  expect(document.querySelector('[aria-label="当前团队原稿"]')).toBeNull()
})

it('opens only the selected feedback and marks only the server-offered sequence as read', async () => {
  mock.call.mockImplementation(async (op, input) => {
    if (input.action === 'originals') return { items: [], hasMore: false }
    if (input.action === 'feedback') return { items: [
      { key:'a', sequence:9, contentRef:'content-a', kind:'comment', isMe:false, at:100, eventRef:'event-a', preview:{teamName:'团队',text:'另一条快记',title:'',imageCount:0,publicRequested:true,deleted:false} },
      { key:'b', sequence:10, contentRef:'content-b', kind:'reaction', isMe:false, actorName:'小李', reaction:{active:false, expression:{text:'收到'}}, preview:{teamName:'团队',text:'项目周报',title:'',imageCount:1}, at:101, eventRef:'event-b' },
    ], hasMore:false, afterSequence:10, offeredThrough:10, seenThrough:9 }
    if (input.action === 'feedback-target') return { original: { contentRef:'content-b', title:'', text:'仅选中的团队原稿', publicRequested:false, assets:[{imageRef:'feedback-image',mimeType:'image/png',size:3}] }, target: { id:'archive', worldRecordRef:'exact-version' } }
    if (input.action === 'feedback-read') return { ok:true }
    if (op === 'world.reactions.archive') return { items: [] }
    throw Error('Unexpected request')
  })
  await mount(<TeamWorldManagement accountKey="test:42" context={{ teamRef: team.teamRef, jotmoId:team.jotmoId, name:team.name, capabilities:{publish:true,manage:true,feedback:true,reply:true} }} />)
  await act(async () => button('共同反馈').click())
  expect(mock.call.mock.calls.filter(([,x]) => x.action === 'feedback-target')).toHaveLength(0)
  expect(document.querySelectorAll('[aria-label="未读"]')).toHaveLength(1)
  expect(document.body.textContent).toContain('小李 取消了表态')
  expect(document.body.textContent).toContain('收到')
  expect(document.body.textContent).toContain('项目周报')
  expect(document.body.textContent).not.toContain('表态变化')
  await act(async () => document.querySelectorAll<HTMLButtonElement>('[aria-label="查看反馈详情"]')[1]!.click())
  expect(mock.call.mock.calls.filter(([,x]) => x.action === 'feedback-target')).toHaveLength(1)
  expect(mock.call).toHaveBeenCalledWith('team.world', { action:'feedback-target', accountKey:'test:42', eventRef:'event-b' }, expect.any(AbortSignal))
  expect(document.querySelector('[aria-label="团队反馈详情"]')?.textContent).toContain('项目周报')
  expect(document.querySelector('.wm-feedback-list')).not.toBeNull()
  expect(document.body.textContent).not.toContain('仅选中的团队原稿')
  expect(mock.call.mock.calls.some(([op]) => op === 'image.read')).toBe(false)
  await act(async () => button('关闭反馈详情').click())
  expect(document.querySelector('[aria-label="团队反馈详情"]')).toBeNull()
  await act(async () => button('将已展示反馈标为已读').click())
  expect(mock.call).toHaveBeenCalledWith('team.world', { action:'feedback-read', accountKey:'test:42', teamRef:team.teamRef, throughSequence:10 }, expect.any(AbortSignal))
})

it('places archive and deletion in the shared action menu without accepting a write on menu open', async () => {
  mock.call.mockImplementation(async (_op,input) => {
    if (input.action==='originals') return { items:[{contentRef:'original',recordRef:'public',revision:4,title:'团队稿件',text:'正文',format:'plain',assets:[],deleted:false,publicRequested:false,pending:false,updatedAt:100}],hasMore:false }
    if (input.action==='submit') return {pending:false,result:{visibility:'deleted'}}
    throw Error('Unexpected request')
  })
  await mount(<TeamWorldManagement accountKey="test:42" context={{teamRef:team.teamRef,jotmoId:team.jotmoId,name:team.name,capabilities:{publish:true,manage:true,feedback:true,reply:true}}} />)
  expect([...document.querySelectorAll('button')].some(b=>b.textContent==='删除')).toBe(false)
  await act(async () => button('更多原件操作').click())
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  expect(mock.call.mock.calls.some(([,input])=>input.action==='submit')).toBe(false)
  await act(async () => (document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="删除"]') ?? button('删除')).click())
  expect(mock.call.mock.calls.find(([,input])=>input.action==='submit')?.[1]).toMatchObject({change:'delete',expectedRevision:4,contentRef:'original'})
})

it('previews the comment itself and its pictures, never the original body as the comment',async()=>{
 vi.stubGlobal('URL',class extends URL {static createObjectURL=()=> 'blob:comment';static revokeObjectURL=vi.fn()})
 mock.call.mockImplementation(async(op,input)=>{
  if(op==='world.image.read')return {mediaType:'image/png',dataBase64:'cG5n'}
  if(input.action==='originals')return {items:[],hasMore:false}
  if(input.action==='feedback')return {items:[{key:'a',sequence:1,kind:'comment',isMe:false,actorName:'小李',at:100,eventRef:'event',preview:{teamName:'团队',title:'项目周报',text:'原稿正文',imageCount:1},comment:{...comment,imageRefs:['comment-image']}}],hasMore:false,afterSequence:1,offeredThrough:1,seenThrough:0}
  throw Error('unexpected')
 })
 await mount(<TeamWorldManagement accountKey="test:42" context={{teamRef:team.teamRef,jotmoId:team.jotmoId,name:team.name,capabilities:{publish:true,manage:true,feedback:true,reply:true}}} />)
 await act(async()=>button('共同反馈').click())
 expect(document.querySelector('[data-world-record-ref="comment-public"]')?.textContent).toContain('这是具体的评论内容')
 expect(document.querySelector('.wm-feedback-original')?.textContent).toContain('项目周报')
 expect(document.querySelector('.wm-feedback-original')?.textContent).toContain('原稿正文')
 expect(document.querySelector('[data-world-record-ref="comment-public"]')?.textContent).not.toContain('原稿正文')
 expect(document.querySelector('img[alt="小李发布的图片 1"]')?.getAttribute('src')).toBe('data:image/png;base64,cG5n')
 expect(document.body.textContent).not.toContain('评论了这条内容')
 await act(async()=>button('预览小李发布的图片 1').click())
 expect(mock.call.mock.calls.some(([,input])=>input.action==='feedback-target')).toBe(false)
 await act(async()=>button('关闭图片预览').click())
 expect(mock.call.mock.calls.some(([,input])=>input.action==='feedback-target')).toBe(false)
})

it('rechecks feedback on focus without discarding a reply draft, and clears it when authorization is lost',async()=>{
 let reads=0, denied=false
 mock.call.mockImplementation(async(op,input)=>{
  if(op==='team.app.teams')return [team]
  if(op==='world.replies')return {items:[],hasMore:false}
  if(op!=='team.world')return {items:[],unavailableRecordRefs:[]}
  if(input.action==='originals')return {items:[],hasMore:false}
  if(input.action==='feedback')return {items:[{key:'a',sequence:1,kind:'comment',isMe:false,actorName:'小李',at:100,eventRef:'event',preview:{teamName:'团队',text:'原稿',title:'',imageCount:0}}],hasMore:false,afterSequence:1,offeredThrough:1,seenThrough:0}
  if(input.action==='feedback-target'){
   if(denied)throw Error('当前没有权限')
   reads++
   return {original:{title:'原稿',text:'原稿正文',assets:[]},target:{id:'archive',worldRecordRef:'version'},comment:{recordRef:'comment-'+reads,authorName:'小李',headline:'',textContent:'评论正文',imageRefs:[],imageCount:0,tags:[],templateKind:0,createdAtMillis:100,publishedAtMillis:100,videoCount:0,voiceCount:0,extendCount:0}}
  }
  throw Error('unexpected')
 })
 await mount(<TeamWorldManagement accountKey="test:42" context={{teamRef:team.teamRef,jotmoId:team.jotmoId,name:team.name,capabilities:{publish:true,manage:true,feedback:true,reply:true}}} />)
 await act(async()=>button('共同反馈').click())
 await act(async()=>button('查看反馈详情').click())
 await act(async()=>{
  const area=document.querySelector<HTMLTextAreaElement>('[aria-label="评论内容"]')!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'未发送的回复')
  area.dispatchEvent(new Event('input',{bubbles:true}))
 })
 await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(reads).toBe(2)
 expect(document.querySelector<HTMLTextAreaElement>('[aria-label="评论内容"]')!.value).toBe('未发送的回复')
 denied=true
 await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(document.querySelector('[aria-label="评论内容"]')).toBeNull()
 expect(document.body.textContent).not.toContain('评论正文')
})

it('confirms withdrawal with the authoritative number of people, without sending before confirmation', async () => {
  const original={contentRef:'content',recordRef:'public',revision:2,title:'原稿',text:'正文',format:'plain',sourceKind:'local',assets:[],deleted:false,publicRequested:true,pending:false,updatedAt:1}
  mock.call.mockImplementation(async (operation,input)=>{
    if(operation==='world.reactions.prepare')return {items:[{recordRef:'public',target:{id:'version',worldRecordRef:'sealed'},visibility:'published'}],unavailableRecordRefs:[]}
    if(operation==='world.reactions.archive')return {items:[{target_id:'version',actor_count:2,groups:[{count:100},{count:100}]}]}
    if(input.action==='originals')return {items:[original],hasMore:false}
    if(input.action==='submit')return {pending:false,result:{visibility:'unpublished'}}
    throw new Error('unexpected')
  })
  await mount(<TeamWorldManagement accountKey="test:42" context={{ teamRef:team.teamRef,jotmoId:team.jotmoId,name:team.name,capabilities:{publish:true,manage:true,feedback:true,reply:true} }}/>)
  await act(async()=>button('更多原件操作').click())
  await act(async()=>button('撤回公开').click())
  expect(document.body.textContent).toContain('当前版本有 2 人表态')
  expect(mock.call.mock.calls.filter(([,input])=>input?.action==='submit')).toHaveLength(0)
  await act(async()=>button('撤回公开').click())
  expect(mock.call.mock.calls.filter(([,input])=>input?.action==='submit')).toHaveLength(1)
})
