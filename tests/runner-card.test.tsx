// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
let root: Root | undefined
let host: HTMLDivElement
const render = async (node: React.ReactNode) => { host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(node));return {container:host} }
afterEach(async()=>{ if(root) await act(async()=>root!.unmount());host?.remove();root=undefined })
import { ArkmeRunnerCard, parseRunnerCard, runnerDecisionResolutions, runnerCardPreviewText, type RunnerCard } from '../src/client/ArkmeRunnerCard.js'
const card: RunnerCard = { version: 1, producer: 'jotmo-agent-runner', kind: 'decision', taskId: '11111111-1111-1111-1111-111111111111', decisionId: '22222222-2222-2222-2222-222222222222', state: 'waiting', title: '订单归属应由哪个服务维护？', expert: '李工', domain: '后端架构', recommendation: '沿用订单服务，通过接口访问' }
const text = `李工，请确认\n\n\`\`\`jotmo-task\n${JSON.stringify(card)}\n\`\`\``
describe('Runner decision presentation', () => {
 it('only renders valid Bot-owned protocol and falls back on malformed or unknown data', () => {
  expect(parseRunnerCard(text, 'bot')).toEqual(card)
  expect(parseRunnerCard(text, 'human')).toBeUndefined()
  expect(parseRunnerCard(text.replace('"version":1','"version":2'), 'bot')).toBeUndefined()
  expect(parseRunnerCard(text.replace('22222222-2222-2222-2222-222222222222','not-an-id'), 'bot')).toBeUndefined()
  expect(parseRunnerCard(text+' more', 'bot')).toBeUndefined()
 })
 it('prepares an explicitly correlated response without claiming it was sent', async () => {
  const reply=vi.fn();await render(<ArkmeRunnerCard card={card} onReply={reply} />)
  expect(host.textContent).toContain('等待负责人决策')
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='采用建议并回复')!.click())
  expect(reply).toHaveBeenCalledWith(`同意采用以下方案：${card.recommendation}`)
  expect(host.textContent).toContain('点击后在输入框确认并发送；管家会核对负责人身份。')
 })
 it('answered historical cards offer no decision action', async () => {
  const view=await render(<ArkmeRunnerCard card={card} resolution="answered" onReply={vi.fn()} />)
  expect(view.container.querySelector('button')).toBeNull()
 })
})


describe('Decision state identity and revoked requests', () => {
 it('a revoked question never looks approved and offers no stale reply button', async () => {
  await render(<ArkmeRunnerCard card={card} resolution="blocked" onReply={vi.fn()} />)
  expect(host.textContent).toContain('此问题已关闭')
  expect(host.textContent).not.toContain('已收到负责人回复')
  expect(host.querySelector('button')).toBeNull()
 })
 it('does not let another Bot or an unavailable message settle the original question', () => {
  const item = {itemUid:'x', senderName:'管家', senderKind:'bot' as const, senderBotDirectoryKey:'original', isMe:false, sendAtMillis:1, title:'', status:1, textContent:text.replace('"state":"waiting"', '"state":"answered"')}
  const key = JSON.stringify(['original', card.decisionId])
  expect(runnerDecisionResolutions([item]).get(key)).toBe('answered')
  expect(runnerDecisionResolutions([{...item,senderBotDirectoryKey:'other'}]).has(key)).toBe(false)
  expect(runnerDecisionResolutions([{...item,status:0}]).has(key)).toBe(false)
  expect(runnerDecisionResolutions([{...item,senderBotDirectoryKey:undefined}]).size).toBe(0)
 })
 it('keeps full long questions available behind a native keyboard-accessible disclosure', async () => {
  await render(<ArkmeRunnerCard card={{...card,title:'背景内容'.repeat(100)}} onReply={vi.fn()} />)
  expect(host.querySelector('h3')?.textContent).toBe('后端架构需要确认')
  expect(host.querySelector('details')?.textContent).toContain('背景内容'.repeat(100))
  expect(host.querySelector('summary')?.textContent).toBe('查看完整问题与背景')
  expect(host.querySelectorAll('button')).toHaveLength(2)
 })
 it('rejects incompatible kind and state instead of presenting them as delivered', () => {
  expect(parseRunnerCard(text.replace('"kind":"decision"','"kind":"task"'),'bot')).toBeUndefined()
  expect(parseRunnerCard(text.replace('"state":"waiting"','"state":"completed"'),'bot')).toBeUndefined()
 })
})

it('renders a readable quote summary without protocol fields and leaves ordinary text intact', () => {
  const text = '说明\n\n```jotmo-task\n' + JSON.stringify({version: 1, producer: 'jotmo-agent-runner', kind:'decision', state:'waiting', taskId:'11111111-1111-1111-1111-111111111111', decisionId:'22222222-2222-2222-2222-222222222222', title:'空值如何处理？', expert:'李工', domain:'后端架构'}) + '\n```'
  expect(runnerCardPreviewText(text)).toBe('研发决策 · 后端架构：空值如何处理？')
  expect(runnerCardPreviewText('普通群消息')).toBe('普通群消息')
  expect(runnerCardPreviewText('说明\n\n```jotmo-task\n{}\n```')).toContain('```jotmo-task')
})

it('ordinary Bot payloads do not opt into development controls', () => {
  expect(parseRunnerCard(text.replace('"producer":"jotmo-agent-runner",', ''), 'bot')).toBeUndefined()
})
it('requirement clarification identifies the requester and only prefills a draft', async () => {
  const reply = vi.fn()
  await render(<ArkmeRunnerCard card={{ ...card, purpose: 'requirement', domain: '需求澄清', expert: '产品同事' }} onReply={reply} />)
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '补充需求')!.click())
  expect(reply).toHaveBeenCalledWith('我的业务目标是：')
})
it('delivery renders branch links with existing safe Markdown without fetching images', async () => {
  await render(<ArkmeRunnerCard card={{ version: 1, producer: 'jotmo-agent-runner', kind: 'task', taskId: card.taskId, state: 'completed', title: '已交付', answer: '[查看分支](https://example.invalid/branch)\n\n![tracking](https://example.invalid/tracking.png)' }} />)
  expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.invalid/branch')
  expect(host.querySelector('img')).toBeNull()
})

it('keeps the business task visible when concurrent tasks ask the same question', async () => {
  await render(<><ArkmeRunnerCard card={{...card, taskTitle:'修复重复提交'}} /><ArkmeRunnerCard card={{...card, taskId:'33333333-3333-3333-3333-333333333333', taskTitle:'完善图片预览'}} /></>)
  expect(host.textContent).toContain('任务：修复重复提交')
  expect(host.textContent).toContain('任务：完善图片预览')
  expect(host.textContent).not.toContain(card.taskId)
})
