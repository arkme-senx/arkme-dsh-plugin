// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamPublicCardDialog } from '../src/client/TeamPublicCardDialog.js'
import { arkmeContactsTab } from '../src/client/redesign/contacts/contacts-tab-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
const { call, open, changed } = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn(), changed: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/team-messaging-events.js', () => ({ openTeamMessages: open, invalidateTeamMessages: changed, subscribeTeamMessageChanges: () => () => {} }))
let host: HTMLDivElement, root: Root
const close = vi.fn()
const card = { name: '即我', jotmoId: 'our_team', contact: { state: 'available', publicRef: 'public-link' } }
const mount = async (accountKey = 'prod:90') => act(async () => root.render(<TeamPublicCardDialog accountKey={accountKey} jotmoId="our_team" onClose={close} />))
function button(label: string) { return [...document.querySelectorAll('button')].find(node => node.textContent === label)! }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); call.mockReset().mockResolvedValue(card); open.mockReset(); close.mockReset(); changed.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('only opens the existing team-link flow on explicit contact, without sending or auto-opening while reading', async () => {
  await mount()
  expect(document.body.textContent).toContain('@our_team')
  expect(open).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  await act(async () => button('联系团队').click())
  expect(close).toHaveBeenCalledTimes(1)
  expect(open).toHaveBeenCalledExactlyOnceWith({ kind: 'link', publicRef: 'public-link' })
  expect(call.mock.calls.map(([op]) => op)).toEqual(['team.app.public-card'])
})

it('keeps public contact disabled but allows current members to enter inbox',async()=>{
 call.mockResolvedValue({...card,contact:{state:'disabled'},navigation:{kind:'none'}})
 await mount();expect(button('联系团队').disabled).toBe(true)
 call.mockResolvedValue({...card,contact:{state:'disabled'},navigation:{kind:'inbox',teamRef:'opaque'}})
 await mount('prod:91');await act(async()=>button('进入团队收件箱').click())
 expect(open).toHaveBeenCalledExactlyOnceWith({kind:'team',teamRef:'opaque'})
})

it.each([
  { ...card, jotmoId: 'other-team' },
  { ...card, contact: { state: 'available' } },
])('rejects mismatched or incomplete public cards and offers retry: %j', async result => {
  call.mockResolvedValueOnce(result)
  await mount(); expect(button('联系团队').disabled).toBe(true)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('资料返回异常')
  await act(async () => button('重试').click())
  expect(button('联系团队').disabled).toBe(false)
})

it('ignores an old account response and cancels it on navigation', async () => {
  let resolve!: (value: unknown) => void
  call.mockReturnValueOnce(new Promise(done => { resolve = done }))
  await mount(); const signal = call.mock.calls[0]![2] as AbortSignal
  await mount('prod:91'); expect(signal.aborted).toBe(true)
  await act(async () => resolve({ ...card, name: '旧账号资料' }))
  expect(document.body.textContent).not.toContain('旧账号资料')
  expect(call.mock.calls.at(-1)![1]).toMatchObject({ expectedAccountKey: 'prod:91' })
})

it('explains team features in the current external conversation without re-opening or needing discovery', async () => {
  await act(async () => root.render(<TeamPublicCardDialog accountKey="prod:90" jotmoId="our_team" onClose={close}
    currentChannel={{ teamRef: 'team', name: '即我', jotmoId: 'our_team', publicRef: 'link', link: '', enabled: true, revision: 1, canManage: false }} />))
  expect(call).not.toHaveBeenCalled()
  expect(document.querySelector('[aria-label="团队功能介绍"]')?.textContent).toContain('同事共同查看、接续回复')
  expect(button('联系团队')).toBeUndefined()
  expect(button('我也要创建团队')).toBeDefined()
  expect(open).not.toHaveBeenCalled()
})

it('opens one empty create form and returns to the same card without touching the conversation draft', async () => {
  await act(async () => root.render(<><textarea defaultValue="原对话草稿" /><TeamPublicCardDialog accountKey="prod:90" jotmoId="our_team" onClose={close} /></>))
  await act(async () => button('我也要创建团队').click())
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect([...document.querySelectorAll('input')].map(input => input.value)).toEqual(['', ''])
  expect(document.querySelector('textarea')?.value).toBe('原对话草稿')
  await act(async () => button('取消').click())
  expect(document.querySelector('[aria-label="团队功能介绍"]')).not.toBeNull()
  expect(document.body.textContent).toContain('@our_team')
  expect(document.querySelector('textarea')?.value).toBe('原对话草稿')
  expect(call.mock.calls.map(([op]) => op)).toEqual(['team.app.public-card'])
  expect(close).not.toHaveBeenCalled()
})

async function fill(label: string, value: string) {
  const node = [...document.querySelectorAll('label')].find(node => node.textContent === label)!
  const input = document.getElementById(node.htmlFor) as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function prepareCreate() {
  vi.useFakeTimers()
  await mount(); await act(async () => button('我也要创建团队').click())
  await fill('团队名称', '新团队'); await fill('团队即我号', 'my_new_team')
  await act(async () => vi.advanceTimersByTimeAsync(600))
}

it('uses the existing checked creation API only on submit, then selects the new team in Contacts', async () => {
  const navigate = vi.spyOn(arkmeUi, 'showContacts').mockImplementation(() => {})
  call.mockImplementation(async op => op === 'team.app.public-card' ? card : op === 'team.app.create.check' ? { available: true }
    : { teamRef: 'new-team', name: '新团队', jotmoId: 'my_new_team' })
  await prepareCreate()
  expect(call.mock.calls.some(([op]) => op === 'team.app.create')).toBe(false)
  await act(async () => { button('创建团队').click(); button('创建团队').click() })
  const creates = call.mock.calls.filter(([op]) => op === 'team.app.create')
  expect(creates).toHaveLength(1)
  expect(creates[0]![1]).toMatchObject({ expectedAccountKey: 'prod:90', name: '新团队', jotmoId: 'my_new_team', requestUid: expect.any(String) })
  expect(arkmeContactsTab.getSnapshot().selection).toEqual({ kind: 'team', teamRef: 'new-team' })
  expect(arkmeContactsTab.getSnapshot().expandedSections.teams).toBe(true)
  expect(changed).toHaveBeenCalledWith('prod:90'); expect(navigate).toHaveBeenCalledOnce()
  expect(open).not.toHaveBeenCalled()
})

it('keeps the form after creation failure and ignores a late creation response after an account change', async () => {
  const navigate = vi.spyOn(arkmeUi, 'showContacts').mockImplementation(() => {})
  call.mockImplementation(async op => op === 'team.app.public-card' ? card : op === 'team.app.create.check' ? { available: true } : Promise.reject(new Error('网络断开')))
  await prepareCreate(); await act(async () => button('创建团队').click())
  expect(document.querySelector('[role="alert"]')).not.toBeNull()
  expect(document.querySelector('input')?.value).toBe('新团队')
  expect(navigate).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(600))
  let resolve!: (value: unknown) => void
  call.mockImplementation(op => op === 'team.app.create' ? new Promise(done => { resolve = done }) : Promise.resolve(card))
  await act(async () => button('创建团队').click())
  const signal = call.mock.calls.at(-1)![2] as AbortSignal
  await mount('prod:91'); expect(signal.aborted).toBe(true)
  await act(async () => resolve({ teamRef: 'stale-team' }))
  expect(navigate).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled()
})
