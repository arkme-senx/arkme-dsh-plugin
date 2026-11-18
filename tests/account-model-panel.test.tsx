import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountModelsPanel } from '../src/client/AccountModelsPanel.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
const model = { uid: 'a', route: 'user-api/a', version_route: 'user-api/a/v1', name: 'Own', disabled: false, execution: 'cloud', protocol: 'openai-chat', model_key: 'own', base_url: 'https://example.com', key_configured: true, capabilities: { text: true, tools: true, json: true, images: false, stream: true, context_tokens: 16000, output_tokens: 4000 } }
const saved = (revision = 1) => ({ accountScope: 'prod:11', enabled: true, revision, models: [structuredClone(model)], connectors: [], scenes: [], preferences: { default_route: 'system-default', scenes: {} as Record<string, string>, points_fallback: false } })
const conflict = () => Object.assign(new Error('配置已更新'), { body: { code: 'arkme-code-1201' } })
let tree: ReactTestRenderer
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.call.mockReset() })
afterEach(async () => { if (tree) await act(async () => tree.unmount()); vi.unstubAllGlobals() })
const button = (label: string) => tree.root.findAllByType('button').find(item => item.children.join('') === label)!
const globalSelect = () => tree.root.findAllByType('select')[0]!
async function mount(tab: 'custom' | 'preferences' = 'preferences') { await act(async () => { tree = create(<AccountModelsPanel scope="prod:11" tab={tab}/>) }) }
function fixture(error: Error = conflict(), conflicts = 1, remoteChanged = false) {
  let revision = 1
  const attempts: any[] = []
  mocks.call.mockImplementation(async (operation: string, params: any) => {
    if (operation === 'models.directory') return { accountScope: 'prod:11', models: [], failures: [] }
    if (operation === 'models.preferences.save') {
      attempts.push(params)
      if (attempts.length <= conflicts) { revision++; throw error }
      return { ...saved(revision + 1), preferences: params.preferences }
    }
    const result = saved(revision)
    if (remoteChanged && revision > 1) result.preferences.scenes.arko = 'managed-ai/remote-choice'
    return result
  })
  return attempts
}

it('refreshes and saves once without asking the user to manage revisions when the draft remains safe', async () => {
  const attempts = fixture()
  await mount()
  await act(async () => globalSelect().props.onChange({ target: { value: model.route } }))
  await act(async () => button('保存使用偏好').props.onClick())
  expect(attempts.map(value => value.revision)).toEqual([1, 2])
  expect(attempts[1].preferences.default_route).toBe(model.route)
  expect(button('确认保存我的修改')).toBeUndefined()
  expect(JSON.stringify(tree.toJSON())).toContain('已保存，后续新任务生效')
})

it('preserves a truly conflicting draft and only writes it after a single explicit confirmation', async () => {
  const attempts = fixture(conflict(), 1, true)
  await mount()
  await act(async () => globalSelect().props.onChange({ target: { value: model.route } }))
  await act(async () => button('保存使用偏好').props.onClick())
  expect(globalSelect().props.value).toBe(model.route)
  expect(attempts).toHaveLength(1)
  await act(async () => button('确认保存我的修改').props.onClick())
  expect(attempts.map(value => value.revision)).toEqual([1, 2])
  expect(attempts[1].preferences.default_route).toBe(model.route)
})

it('stops after one automatic retry even when another writer keeps changing settings', async () => {
  const attempts = fixture(conflict(), 100)
  await mount()
  await act(async () => button('保存使用偏好').props.onClick())
  expect(attempts).toHaveLength(2)
  expect(button('确认保存我的修改').props.disabled).toBe(false)
})

it.each(['arkme-timeout', 'model-capability-mismatch', 'model-account-changed'])('does not resubmit a %s failure', async code => {
  const attempts = fixture(Object.assign(new Error('操作未完成'), { body: { code } }))
  await mount()
  await act(async () => button('保存使用偏好').props.onClick())
  expect(attempts).toHaveLength(1)
})

it('keeps normal official preference saves on the original single-write path and suppresses double clicks', async () => {
  const attempts = fixture(conflict(), 0)
  await mount()
  const initialReads = mocks.call.mock.calls.filter(([op]) => op === 'models.account.query').length
  await act(async () => { button('保存使用偏好').props.onClick(); button('保存使用偏好').props.onClick() })
  expect(attempts).toHaveLength(1)
  expect(mocks.call.mock.calls.filter(([op]) => op === 'models.account.query')).toHaveLength(initialReads)
})

it('does not retry after leaving the page while reading refreshed settings', async () => {
  let finish!: (value: ReturnType<typeof saved>) => void
  let reads = 0, writes = 0
  mocks.call.mockImplementation(async (op: string) => {
    if (op === 'models.directory') return { accountScope: 'prod:11', models: [], failures: [] }
    if (op === 'models.preferences.save') { writes++; throw conflict() }
    if (++reads === 1) return saved()
    return new Promise(resolve => { finish = resolve })
  })
  await mount()
  await act(async () => button('保存使用偏好').props.onClick())
  await act(async () => tree.unmount())
  await act(async () => finish(saved(2)))
  expect(writes).toBe(1)
})

it('keeps a disabled saved global binding visible instead of presenting the official default as selected', async () => {
  mocks.call.mockImplementation(async (op: string) => op === 'models.directory' ? { accountScope: 'prod:11', models: [], failures: [] } : { ...saved(), models: [{ ...model, disabled: true }], preferences: { default_route: model.route, scenes: {}, points_fallback: false } })
  await mount()
  expect(globalSelect().props.value).toBe(model.route)
  const option = globalSelect().findAllByType('option').find(item => item.props.value === model.route)!
  expect(option.props.disabled).toBe(true)
  expect(option.children.join('')).toContain('已停用')
})

it('shows the complete owner-generated affected-function list even when it exceeds the generic error length limit', async () => {
  const names = Array.from({ length: 40 }, (_, index) => `受影响的业务功能${index + 1}`)
  const message = `此次能力修改会影响：${names.join('、')}。请保留所需能力，或在「使用偏好」中为这些功能更换模型。`
  expect(message.length).toBeGreaterThan(300)
  const attempts = fixture(Object.assign(new Error(message), { body: { code: 'model-capability-mismatch' } }))
  await mount()
  await act(async () => button('保存使用偏好').props.onClick())
  expect(attempts).toHaveLength(1)
  const notices = tree.root.findAllByProps({ role: 'status' })
  expect(notices.some(node => node.children.join('') === message)).toBe(true)
})

it('retains the generic fallback for unrelated oversized errors', async () => {
  fixture(Object.assign(new Error('opaque '.repeat(100)), { body: { code: 'arkme-http-error' } }))
  await mount()
  await act(async () => button('保存使用偏好').props.onClick())
  expect(tree.root.findAllByProps({ role: 'status' }).some(node => node.children.join('') === '暂时无法完成，请稍后重试')).toBe(true)
})
