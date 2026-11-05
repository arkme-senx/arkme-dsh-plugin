// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
let root: Root | undefined
let host: HTMLDivElement
const render = async (node: React.ReactNode) => { host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(node));return {container:host} }
afterEach(async()=>{ if(root) await act(async()=>root!.unmount());host?.remove();root=undefined })
import { ArkmeRunnerCard, parseRunnerCard, type RunnerCard } from '../src/client/ArkmeRunnerCard.js'
const card: RunnerCard = { version: 1, kind: 'decision', taskId: '11111111-1111-1111-1111-111111111111', decisionId: '22222222-2222-2222-2222-222222222222', state: 'waiting', title: '订单归属应由哪个服务维护？', expert: '李工', domain: '后端架构', recommendation: '沿用订单服务，通过接口访问' }
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
  expect(reply).toHaveBeenCalledWith(`【研发决策:${card.decisionId}】\n同意采用以下方案：${card.recommendation}`)
  expect(host.textContent).toContain('点击后在输入框确认并发送；管家会核对负责人身份。')
 })
 it('answered historical cards offer no decision action', async () => {
  const view=await render(<ArkmeRunnerCard card={card} answered onReply={vi.fn()} />)
  expect(view.container.querySelector('button')).toBeNull()
 })
})
