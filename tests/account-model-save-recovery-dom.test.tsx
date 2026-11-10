// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountModelsPanel } from '../src/client/AccountModelsPanel.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
const model = { uid: 'a', route: 'user-api/a', version_route: 'user-api/a/v1', name: 'Own model', disabled: false, execution: 'cloud', protocol: 'openai-chat', model_key: 'own', base_url: 'https://example.com/v1', key_configured: true, capabilities: { text: true, tools: true, json: true, images: false, stream: true, context_tokens: 16000, output_tokens: 4000 } }
let root: Root, container: HTMLDivElement
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.call.mockReset(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
function button(label: string) { return [...container.querySelectorAll('button')].find(value => value.textContent === label)! }
function fixture(targetChanged = false) {
  let revision = 1
  const attempts: any[] = []
  const data = () => ({ accountScope: 'prod:11', enabled: true, revision, models: [{ ...model, version_route: targetChanged && revision > 1 ? 'user-api/a/v2' : model.version_route }], connectors: [], scenes: [], preferences: { default_route: 'system-default', scenes: {}, points_fallback: false } })
  mocks.call.mockImplementation(async (op: string, params: any) => {
    if (op === 'models.directory') return { accountScope: 'prod:11', models: [], failures: [] }
    if (op === 'models.account.save') {
      attempts.push(params.input)
      revision++
      if (attempts.length === 1) throw Object.assign(new Error('配置已更新'), { body: { code: 'arkme-code-1201' } })
    }
    return data()
  })
  return attempts
}
async function edit() {
  await act(async () => root.render(<AccountModelsPanel scope="prod:11" tab="custom"/>))
  await act(async () => button('编辑').click())
}
function consent() { return container.querySelector<HTMLInputElement>('.arkme-model-cloud-consent input')! }

it('automatically saves an unchanged model once after rejection, preserving credentials and explicit token limits', async () => {
  const attempts = fixture()
  await edit()
  expect(button('保存模型').disabled).toBe(true)
  await act(async () => consent().click())
  await act(async () => button('保存模型').click())
  expect(attempts.map(value => value.expected_revision)).toEqual([1, 2])
  expect(attempts[1]).toEqual({ ...attempts[0], expected_revision: 2 })
  expect(attempts[1].api_key).toBe('')
  expect(attempts[1].capabilities.output_tokens).toBe(4000)
  expect(container.querySelector('form')).toBeNull()
  expect(container.textContent).toContain('已保存，后续新任务生效')
})

it('requires consent and native field validation when confirming a genuine conflict, then saves with one click', async () => {
  const attempts = fixture(true)
  await edit()
  await act(async () => consent().click())
  await act(async () => button('保存模型').click())
  expect(attempts).toHaveLength(1)
  expect(container.querySelector('form [role="status"]')?.textContent).toContain('你的修改已保留')
  const confirm = button('确认保存我的修改')
  expect(confirm.type).toBe('submit')
  await act(async () => consent().click())
  expect(confirm.disabled).toBe(true)
  await act(async () => confirm.click())
  expect(attempts).toHaveLength(1)
  await act(async () => consent().click())
  const name = container.querySelector<HTMLInputElement>('input[maxlength="160"]')!
  name.value = ''
  await act(async () => confirm.click())
  expect(attempts).toHaveLength(1)
  name.value = model.name
  await act(async () => confirm.click())
  expect(attempts.map(value => value.expected_revision)).toEqual([1, 2])
  expect(container.querySelector('form')).toBeNull()
})
