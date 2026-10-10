import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, isValidElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeBotAvatarActionMenu, ArkmeBotAvatarProfileCard } from '../src/client/ArkmeBotAvatarActions.js'
import { ArkmeActionMenu, type ArkmeMenuAction } from '../src/client/ArkmeDshMenu.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeGroupBotItem } from '../src/tools/ports/bots.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
vi.mock('../src/client/ArkmeDshMenu.js', () => ({ ArkmeActionMenu: () => null }))
let renderer: ReactTestRenderer | undefined
beforeEach(() => { vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.resetAllMocks(); vi.unstubAllGlobals() })
const bot: ArkmeGroupBotItem = { botRef: 'bot-ref', directoryKey: 'bot-key', name: '通知助手',
  description: '', status: 'online', provider: 'webhook', installed: true }
const identity = { itemUid: 'message', name: bot.name, directoryKey: bot.directoryKey }
function mockBot(value = bot) {
  vi.mocked(callArkme).mockImplementation(async operation => operation === 'group.bots'
    ? { items: [value] } : { items: [{ ...value, directChatAvailable: true }] } as never)
}
const defaults = { sourceRef: 'group-ref', identity, position: { left: 20, top: 20 },
  canRemove: true, onMention: vi.fn(), onRecords: vi.fn(), onRemove: vi.fn(), onClose: vi.fn() }
type Action = Exclude<ArkmeMenuAction, { type: string }>
function actions(): Action[] {
  return renderer!.root.findByType(ArkmeActionMenu).props.actions.filter((entry: ArkmeMenuAction | false) => entry && !('type' in entry))
}

it.each(['openclaw', 'webhook'] as const)('%s matches member menu rows and keeps profile/chat out of hover', async provider => {
  mockBot({ ...bot, provider })
  await act(async () => { renderer = create(<ArkmeBotAvatarActionMenu {...defaults} accountKey={`parity-${provider}`} />) })
  const rows = actions()
  expect(rows.map(row => row.id)).toEqual(['mention', 'mentioned-records', 'owner-records', 'remove'])
  expect(rows[0]!.disabled).toBe(provider === 'webhook')
  const markup = renderToStaticMarkup(createElement('div', {}, rows.map(row => isValidElement(row.label) ? row.label : String(row.label))))
  expect(markup).toContain('@通知助手')
  expect(markup).toContain('@TA的快记')
  expect(markup).toContain('看TA的快记')
  expect(markup).toContain('font-variant-numeric:tabular-nums')
  expect(markup).not.toContain('查看 Bot 资料')
  expect(rows[3]!.danger).toBe(true)
  act(() => rows[3]!.onSelect())
  expect(defaults.onRemove).toHaveBeenCalledWith(expect.objectContaining({ provider, installed: true }))
  expect(vi.mocked(callArkme).mock.calls.map(call => call[0])).not.toContain('group.bot.remove')
})

it.each([false, true])('does not allow ordinary users or removed Bots to be removed (owner=%s)', async canRemove => {
  mockBot({ ...bot, installed: !canRemove })
  await act(async () => { renderer = create(<ArkmeBotAvatarActionMenu {...defaults} canRemove={canRemove} accountKey={`permission-${canRemove}`} />) })
  expect(actions().map(row => row.id)).not.toContain('remove')
})

it('loads Bot details on direct avatar click and offers only verified personal chat', async () => {
  mockBot()
  const onChat = vi.fn()
  await act(async () => { renderer = create(<ArkmeBotAvatarProfileCard accountKey="profile" sourceRef="group-ref"
    identity={identity} onChat={onChat} onClose={() => {}} />) })
  expect(JSON.stringify(renderer!.toJSON())).toContain('Webhook Bot')
  act(() => renderer!.root.findByType('button').props.onClick())
  expect(onChat).toHaveBeenCalledWith(expect.objectContaining({ directoryKey: 'bot-key', directChatAvailable: true }))
})

it('does not cache failed membership lookup as an absent Bot', async () => {
  vi.mocked(callArkme).mockImplementation(async operation => {
    if (operation === 'group.bots') throw new Error('offline')
    return { items: [] } as never
  })
  await act(async () => { renderer = create(<ArkmeBotAvatarActionMenu {...defaults} accountKey="retry" />) })
  expect(actions().map(row => row.id)).not.toContain('remove')
  act(() => renderer!.unmount())
  mockBot()
  await act(async () => { renderer = create(<ArkmeBotAvatarActionMenu {...defaults} accountKey="retry" />) })
  expect(actions().map(row => row.id)).toContain('remove')
})
