// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamFeatureLinks } from '../src/client/redesign/contacts/TeamFeatureLinks.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { teamFeatureLinkURL, readTeamFeatureLinks, type TeamFeatureLinks as Snapshot } from '../src/team-feature-links-contract.js'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
const first = { id: '11111111-1111-4111-8111-111111111111', name: '总后台', url: 'https://admin.example.com/' }
let host: HTMLDivElement, root: Root, saved: Snapshot
function button(label: string) { const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(row => row.getAttribute('aria-label') === label || row.textContent === label); if (!b) throw new Error(`Missing button: ${label}`); return b }
const click = (label: string) => act(async () => button(label).click())
const input = (label: string, value: string) => act(async () => { const node = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })) })
const signIn = (userId = 11) => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId } as never)
const render = async () => act(async () => root.render(<TeamFeatureLinks accountKey="test:11" teamRef="sealed-team"><button>现有团队功能</button></TeamFeatureLinks>))
const deferred = () => { let resolve!: (v: Snapshot) => void; const promise = new Promise<Snapshot>(done => { resolve = done }); return { resolve, promise } }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); signIn(); saved = { schemaVersion: 1, revision: 0, maxItems: 20, canManage: true, items: [] }
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  mock.call.mockImplementation(async (operation, p) => operation.endsWith('.get') ? structuredClone(saved) : (saved = { ...saved, revision: p.expectedRevision + 1, items: p.items }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); mock.call.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps built-in entries visible while loading and saves a named shared link through the account-scoped Host', async () => {
  const pending = deferred(); mock.call.mockReturnValueOnce(pending.promise)
  await render(); expect(button('现有团队功能')).toBeDefined(); expect(document.body.textContent).toContain('正在读取自定义入口')
  await act(async () => pending.resolve(saved)); await click('＋ 添加入口')
  await input('入口名称', '总后台'); await input('入口网址', 'https://admin.example.com')
  await click('保存')
  const link = host.querySelector<HTMLAnchorElement>('a')!
  expect(link.href).toBe(first.url); expect(link.target).toBe('_blank'); expect(link.rel).toContain('noopener'); expect(link.rel).toContain('noreferrer')
  expect(document.querySelector('dialog')).toBeNull()
  expect(mock.call.mock.calls.at(-1)).toEqual(['team.app.feature-links.save', expect.objectContaining({ teamRef: 'sealed-team', expectedAccountKey: 'test:11', expectedRevision: 0, requestUid: expect.any(String), items: [expect.objectContaining({ name: first.name, url: first.url })] }), expect.any(AbortSignal)])
})

it('members see shared entries without management controls and repeated team opens read the shared configuration', async () => {
  saved = { ...saved, canManage: false, revision: 3, items: [first] }; await render()
  expect(host.querySelector('a')?.textContent).toContain('总后台'); expect(document.querySelector('[aria-label="管理 总后台"]')).toBeNull()
  expect([...document.querySelectorAll('button')].some(b => b.textContent === '＋ 添加入口')).toBe(false)
  await act(async () => root.render(null)); await render()
  expect(host.querySelector('a')?.href).toBe(first.url)
  expect(mock.call.mock.calls.map(c => c[0])).toEqual(['team.app.feature-links.get', 'team.app.feature-links.get'])
})

it('edits the same link identity, then confirms deletion without changing built-in features', async () => {
  saved.items = [first]; await render(); await click('管理 总后台'); await click('编辑')
  await input('入口名称', '运营后台'); await click('保存')
  expect(saved.items[0]).toMatchObject({ id: first.id, name: '运营后台' })
  await click('管理 运营后台'); await click('删除')
  expect(host.querySelector('a')).not.toBeNull(); expect(document.querySelector('dialog')?.textContent).toContain('团队成员将不再看到此入口')
  await click('确认删除'); expect(saved.items).toEqual([]); expect(host.querySelector('a')).toBeNull(); expect(button('现有团队功能')).toBeDefined()
})

it('keeps input and reuses the frozen operation on response loss', async () => {
  await render(); await click('＋ 添加入口'); await input('入口名称', '总后台'); await input('入口网址', first.url)
  mock.call.mockRejectedValueOnce(new Error('offline')); await click('保存')
  expect(document.querySelector<HTMLInputElement>('[aria-label="入口名称"]')?.value).toBe('总后台')
  await click('保存')
  const saves = mock.call.mock.calls.filter(c => c[0].endsWith('.save'))
  expect(saves[1]![1]).toEqual(saves[0]![1]); expect(host.querySelectorAll('a')).toHaveLength(1)
})

it('requires explicit reload after a conflict, retaining input while preserving another manager’s new entry', async () => {
  await render(); await click('＋ 添加入口'); await input('入口名称', '总后台'); await input('入口网址', first.url)
  mock.call.mockRejectedValueOnce(Object.assign(new Error('版本冲突'), { body: { code: 'team-feature_links_version_conflict' } })); await click('保存')
  expect(document.querySelector<HTMLInputElement>('[aria-label="入口名称"]')?.value).toBe('总后台')
  saved = { ...saved, revision: 3, items: [{ ...first, id: '22222222-2222-4222-8222-222222222222', name: '其他人的入口' }] }
  await click('重新加载'); await click('保存')
  expect(saved.items.map(row => row.name)).toEqual(['其他人的入口', '总后台'])
  const saves = mock.call.mock.calls.filter(c => c[0].endsWith('.save'))
  expect(saves[1]![1].expectedRevision).toBe(3); expect(saves[1]![1].requestUid).not.toBe(saves[0]![1].requestUid)
})

it('an older focus refresh cannot erase a successful save', async () => {
  await render(); await click('＋ 添加入口'); await input('入口名称', '总后台'); await input('入口网址', first.url)
  const pending = deferred(); mock.call.mockReturnValueOnce(pending.promise)
  await act(async () => window.dispatchEvent(new Event('focus')))
  await click('保存'); await act(async () => pending.resolve({ ...saved, revision: 0, items: [] }))
  expect(host.querySelectorAll('a')).toHaveLength(1)
})

it('account ABA cancels a pending write and prevents a late response from repopulating the view', async () => {
  await render(); await click('＋ 添加入口'); await input('入口名称', '总后台'); await input('入口网址', first.url)
  const pending = deferred(); mock.call.mockReturnValueOnce(pending.promise); await click('保存')
  const signal = mock.call.mock.calls.at(-1)![2]
  await act(async () => { signIn(12); signIn(); pending.resolve({ ...saved, revision: 1, items: [first] }) })
  expect(signal.aborted).toBe(true)
  await act(async () => pending.resolve({ ...saved, revision: 1, items: [first] }))
  expect(host.querySelector('a')).toBeNull(); expect(document.querySelector('dialog')).toBeNull()
})

it('service failure keeps built-in actions usable and allows a later retry', async () => {
  mock.call.mockRejectedValueOnce(new Error('not deployed')); await render()
  expect(button('现有团队功能').disabled).toBe(false); expect(document.body.textContent).toContain('团队入口暂时无法加载')
  await click('重试'); expect(button('＋ 添加入口')).toBeDefined()
})

it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/x', '//example.com', 'https://user:pass@example.com', 'https://example.com:65536', 'https://trusted.com\\@evil.com'])('rejects unsafe navigation data: %s', url => {
  expect(teamFeatureLinkURL(url)).toBeUndefined(); expect(readTeamFeatureLinks([{ ...first, url }])).toBeUndefined()
})
