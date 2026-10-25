// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PublishDialog } from '../src/client/ArkmeWorldSurface.js'
import { TeamWorldSurface } from '../src/client/TeamWorldSurface.js'
import { TeamPublicCardDialog } from '../src/client/TeamPublicCardDialog.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeTeam } from '../src/types.js'
const mock = vi.hoisted(() => ({ call: vi.fn(), upload: vi.fn(), text: vi.fn(), files: vi.fn(), phone: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => mock.call(...args) }))
vi.mock('../src/sdk/index.js', async original => ({ ...await original<object>(), createArkmeSdk: () => ({ upload: mock.upload, publishWorldText: mock.text, publishWorldFileAssets: mock.files }) }))
vi.mock('../src/client/social-action-guard.js', () => ({ requirePhoneForSocialAction: mock.phone, isSocialBindingRequired: () => false }))
const team: ArkmeTeam = { teamRef: 'sealed-team', name: '即我', jotmoId: 'our_team', currentUserRole: 'member', createdAtMillis: 1, updatedAtMillis: 1 }
let host: HTMLDivElement, root: Root
const published = vi.fn(), close = vi.fn()
const mount = async (ui: React.ReactNode = <PublishDialog actorName="运营小林" onClose={close} onPublished={published} />) => act(async () => root.render(ui))
const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent === label)!
async function input(text: string) {
  await act(async () => {
    const area = document.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function chooseTeam() {
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="发布身份：我"]')!.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[data-role-action="team:our_team"]')!.click())
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks()
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  mock.call.mockImplementation(async operation => operation === 'team.app.teams' ? [team] : { state: 'backend_pending' })
  mock.phone.mockResolvedValue(undefined); mock.text.mockResolvedValue({ worldPublished: true, visibility: 'visible' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('shows team ownership and actual operator, preserves draft and files, and does not upload or publish as a person', async () => {
  await mount(); await input('版本更新说明'); await chooseTeam()
  expect(document.body.textContent).toContain('由运营小林发布')
  expect(document.body.textContent).toContain('内容归团队所有')
  await act(async () => {
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(picker, 'files', { configurable: true, value: [new File(['png'], 'update.png', { type: 'image/png' })] })
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => button('发布').click())
  expect(mock.call).toHaveBeenCalledWith('team.app.world.prepare', { expectedAccountKey: 'test:42', teamRef: 'sealed-team', requestUid: expect.any(String) }, expect.any(AbortSignal))
  expect(document.querySelector('textarea')!.value).toBe('版本更新说明')
  expect(document.body.textContent).toContain('1 / 27')
  expect(document.body.textContent).toContain('草稿已保留，尚未发布。')
  expect(mock.upload).not.toHaveBeenCalled(); expect(mock.text).not.toHaveBeenCalled(); expect(mock.files).not.toHaveBeenCalled()
  expect(published).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
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
  expect(document.querySelector('textarea')!.value).toBe('团队草稿')
  expect(mock.text).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled()
  expect(document.querySelector('[aria-label="发布身份：我"]')).toBeNull()
})

it('cancels a pending team check and clears private drafts on account change', async () => {
  let resolve!: (value: unknown) => void
  await mount(); await input('账号42的草稿'); await chooseTeam()
  mock.call.mockImplementation(async operation => operation === 'team.app.world.prepare' ? new Promise(done => { resolve = done }) : [team])
  await act(async () => button('发布').click())
  const signal = mock.call.mock.calls.find(([op]) => op === 'team.app.world.prepare')![2] as AbortSignal
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 99 }))
  expect(signal.aborted).toBe(true); expect(document.querySelector('textarea')!.value).toBe('')
  await act(async () => resolve({ state: 'backend_pending' }))
  expect(published).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled()
})

it('uses a separate team page and preselects the verified member team when publishing from it', async () => {
  mock.call.mockImplementation(async operation => operation === 'team.app.world.view' ? { state: 'backend_pending', team, memberTeam: team } : [team])
  await mount(<TeamWorldSurface accountKey="test:42" target={team} actorName="小林" onBack={close} />)
  expect(document.body.textContent).toContain('即我的世界')
  expect(document.body.textContent).toContain('接口接通后，这里统一展示该团队发布的公开内容。')
  expect(mock.call.mock.calls.some(([op]) => ['world.user', 'world.mine', 'world.feed'].includes(op))).toBe(false)
  await act(async () => button('发布').click())
  expect(document.querySelector('[aria-label="发布身份：即我"]')).not.toBeNull()
})

it('offers the same team World navigation from public cards including the current team conversation', async () => {
  const navigate = vi.spyOn(arkmeUi, 'showTeamWorld')
  await mount(<TeamPublicCardDialog accountKey="test:42" jotmoId="our_team" onClose={close}
    currentChannel={{ name: '即我', jotmoId: 'our_team', enabled: false } as never} />)
  await act(async () => button('团队的世界').click())
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: '即我', jotmoId: 'our_team' }))
  expect(close).toHaveBeenCalledTimes(1)
})
