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

const scenes = [
  { key: 'dsh', name: 'DSH 对话', group: 'chat', biz_code: 0, tools: true, stream: true, images: false, json: false },
  { key: 'arko', name: 'Arko 对话', group: 'chat', biz_code: 1, tools: true, images: false, json: false },
  { key: 'arrangement', name: '安排识别', group: 'recognition', biz_code: 2, tools: false, images: false, json: true },
  { key: 'profile', name: '个人档案识别', group: 'recognition', biz_code: 3, tools: false, images: false, json: true },
  { key: 'goals', name: '目标识别', group: 'recognition', biz_code: 4, tools: false, images: false, json: true },
  { key: 'intelligent.calendar.day-review', name: '日程复盘', group: 'calendar', biz_code: 5, tools: false, images: false, json: true },
  { key: 'recording-summary', name: '录音日总结', group: 'recording', biz_code: 6, tools: false, images: false, json: false, min_output_tokens: 512, min_input_tokens: 513 },
  { key: 'recording-timeline', name: '录音时间轴', group: 'recording', biz_code: 7, tools: false, images: false, json: false, min_output_tokens: 512, min_input_tokens: 513 },
  { key: 'other-summary', name: '普通文本总结', group: 'summary', biz_code: 8, tools: false, images: false, json: false },
]
function capabilityFixture() {
  let data = { accountScope: 'prod:11', enabled: true, revision: 1, models: [structuredClone(model)], connectors: [], scenes, preferences: { default_route: model.route, scenes: {}, points_fallback: false } }
  mocks.call.mockImplementation(async (op: string, params: any) => {
    if (op === 'models.directory') return { accountScope: 'prod:11', models: [], failures: [] }
    if (op === 'models.account.save') data = { ...data, revision: 2, models: [{ ...model, capabilities: params.input.capabilities }] }
    return data
  })
}
function capability(label: string) {
  return [...container.querySelectorAll('fieldset label')].find(item => item.textContent === label)!.querySelector<HTMLInputElement>('input')!
}

it('warns with the actual missing capabilities, saves the model and keeps affected bindings visible', async () => {
  capabilityFixture()
  await edit()
  await act(async () => capability('工具调用').click())
  const warning = container.querySelector('.arkme-model-capability-hints [role="status"]')!
  expect(warning.textContent).toContain('可以保存模型')
  expect(warning.textContent).toContain('DSH 对话（正在使用）、Arko 对话（正在使用）：缺少工具调用')
  expect(warning.textContent).not.toContain('安排识别')
  await act(async () => consent().click())
  expect(button('保存模型').disabled).toBe(false)
  await act(async () => button('保存模型').click())
  expect(container.querySelector('form')).toBeNull()
  expect(container.textContent).toContain('DSH 对话：缺少工具调用')
  expect(container.textContent).toContain('Arko 对话：缺少工具调用')
  await act(async () => root.render(<AccountModelsPanel scope="prod:11" tab="preferences"/>))
  const dsh = container.querySelector<HTMLSelectElement>('select[aria-label="DSH 对话"]')!
  expect([...dsh.options].find(option => option.value === model.route)!.disabled).toBe(true)
  expect(dsh.closest('label')!.textContent).toContain('需要：文本、工具调用、流式输出')
  const summary = container.querySelector<HTMLSelectElement>('select[aria-label="普通文本总结"]')!
  expect([...summary.options].find(option => option.value === model.route)!.disabled).toBe(false)
})

it('explains every JSON business and recording budget without treating images as a blanket requirement', async () => {
  capabilityFixture()
  await edit()
  await act(async () => capability('JSON 输出').click())
  const hints = container.querySelector('.arkme-model-capability-hints')!
  expect(hints.querySelector('[role="status"]')!.textContent).toContain('安排识别（正在使用）、个人档案识别（正在使用）、目标识别（正在使用）、日程复盘（正在使用）：缺少JSON 输出')
  expect(hints.querySelector('[role="status"]')!.textContent).not.toContain('缺少图片')
  expect(hints.querySelector('details')!.textContent).toContain('录音日总结、录音时间轴：文本、输出上限至少 512 Token、上下文上限减去输出上限至少 513 Token')
  expect(hints.textContent).toContain('发送或分析图片时，还需要图片能力')
})

it('shows first-time requirements without implying a new model is already in use', async () => {
  capabilityFixture()
  await act(async () => root.render(<AccountModelsPanel scope="prod:11" tab="custom"/>))
  await act(async () => button('添加模型').click())
  await act(async () => capability('工具调用').click())
  const hints = container.querySelector('.arkme-model-capability-hints')!
  expect(hints.textContent).toContain('DSH 对话、Arko 对话：缺少工具调用')
  expect(hints.textContent).not.toContain('正在使用')
  expect(hints.textContent).toContain('一个模型可以用于多个功能')
})
