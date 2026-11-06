import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import type { ArkmeTimelineItem } from '../types.js'

export interface RunnerCard {
  version: 1
  producer: 'jotmo-agent-runner'
  purpose?: 'requirement' | 'decision'
  kind: 'decision' | 'task'
  taskId: string
  taskTitle?: string
  decisionId?: string
  state: 'waiting' | 'answered' | 'completed' | 'blocked' | 'running'
  title: string
  expert?: string
  domain?: string
  recommendation?: string
  answer?: string
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
/** Presentation only. Bot identity comes from Chat; human text/forwards cannot forge a decision card. */
export function parseRunnerCard(text: string, senderKind?: string): RunnerCard | undefined {
  if (senderKind !== 'bot' || text.length > 30000) return undefined
  const match = /\n\n```jotmo-task\n([^]*?)\n```\s*$/.exec(text)
  if (!match) return undefined
  try {
    const value = JSON.parse(match[1]!) as Record<string, unknown>
    if (value.producer !== 'jotmo-agent-runner' || value.version !== 1 || !['decision', 'task'].includes(String(value.kind))
      || !['waiting', 'answered', 'completed', 'blocked', 'running'].includes(String(value.state))
      || typeof value.taskId !== 'string' || !uuid.test(value.taskId)
      || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 6000) return undefined
    for (const key of ['taskTitle', 'expert', 'domain', 'recommendation', 'answer']) {
      if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > 10000)) return undefined
    }
    if (value.purpose !== undefined && !['requirement', 'decision'].includes(String(value.purpose))) return undefined
    if (value.kind === 'task' && !['completed', 'blocked', 'running'].includes(String(value.state))) return undefined
    if (value.kind === 'decision' && !['waiting', 'answered', 'blocked'].includes(String(value.state))) return undefined
    if (value.kind === 'decision' && (typeof value.decisionId !== 'string' || !uuid.test(value.decisionId) || !value.expert || !value.domain)) return undefined
    return value as unknown as RunnerCard
  } catch { return undefined }
}

/** Text-only quote preview, never grants card actions or trusts the quoted sender. */
export function runnerCardPreviewText(text: string): string {
  const card = parseRunnerCard(text, 'bot')
  return card ? `${card.taskTitle ? `${card.taskTitle} · ` : ''}${card.kind === 'decision' ? (card.purpose === 'requirement' ? '需求澄清' : `研发决策 · ${card.domain}`) : '研发任务'}：${card.title}` : text
}

export function runnerDecisionResolutions(items: readonly ArkmeTimelineItem[]): Map<string, 'answered' | 'blocked'> {
  const states = new Map<string, 'answered' | 'blocked'>()
  for (const item of items) {
    if (item.status !== 1 || item.forwardRecords || item.sharedRecording || !item.senderBotDirectoryKey) continue
    const card = parseRunnerCard(item.textContent, item.senderKind)
    if (card?.decisionId && (card.state === 'answered' || card.state === 'blocked')) {
      states.set(JSON.stringify([item.senderBotDirectoryKey, card.decisionId]), card.state)
    }
  }
  return states
}

export function ArkmeRunnerCard({ card, onReply, resolution }: {
  card: RunnerCard
  onReply?: ((text: string) => void) | undefined
  resolution?: 'answered' | 'blocked' | undefined
}) {
  const state = card.state === 'waiting' ? resolution ?? card.state : card.state
  const waiting = card.kind === 'decision' && state === 'waiting'
  const requirement = card.purpose === 'requirement'
  const status = waiting ? (requirement ? '等待需求方补充' : '等待负责人决策') : state === 'blocked' ? '需要处理' : card.kind === 'decision' ? (requirement ? '已收到需求补充' : '已收到负责人回复') : state === 'running' ? '进展更新' : '已交付'
  const color = waiting ? theme.warning : state === 'blocked' ? theme.danger : theme.accent
  const reply = (text: string) => onReply?.(text)
  return <section aria-label={status} data-arkme-runner-card={card.kind} style={{ width: 380, maxWidth: '100%', boxSizing: 'border-box', border: `1px solid ${theme.border}`, borderRadius: 14, background: theme.base, overflow: 'hidden' }}>
    <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${theme.borderSoft}`, fontSize: 12, color: theme.secondary }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      <strong style={{ color }}>{status}</strong><span style={{ marginLeft: 'auto' }}>研发管家</span>
    </div>
    <div style={{ padding: 18, display: 'grid', gap: 14 }}>
      {card.kind === 'decision' && card.taskTitle && <div style={{ color: theme.text, fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>任务：{card.taskTitle}</div>}
      <h3 style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: theme.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{card.kind === 'decision' ? (requirement ? '先确认要解决的问题' : `${card.domain}需要确认`) : card.title}</h3>
      {card.expert && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: theme.secondary }}><span style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: '50%', background: theme.layer2, color: theme.text }} aria-hidden>{Array.from(card.expert)[0]}</span><strong style={{ color: theme.text }}>{card.expert}</strong><span>{requirement ? '需求方' : `负责 ${card.domain}`}</span></div>}
      {card.kind === 'decision' && <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{card.title.length > 220 ? <><p style={{ margin: '0 0 8px' }}>{card.title.slice(0, 140)}…</p><details onClick={event => event.stopPropagation()}><summary style={{ cursor: 'pointer' }}>查看完整问题与背景</summary><p style={{ margin: '8px 0 0' }}>{card.title}</p></details></> : card.title}</div>}
      {(card.answer || card.recommendation) && <div style={{ padding: '12px 14px', background: theme.layer1, borderRadius: 8, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><div style={{ marginBottom: 4, fontSize: 11, color: theme.secondary }}>{card.kind === 'task' ? (state === 'running' ? '当前进展' : state === 'blocked' ? '遇到的问题' : '交付与验证') : card.state === 'blocked' ? '状态说明' : card.answer ? (requirement ? '需求补充' : '负责人回复') : '管家的建议'}</div>{card.kind === 'task' ? <ArkmeMarkdownBody text={card.answer || card.recommendation || ''} highlightMentions={false} /> : card.answer || card.recommendation}</div>}
      {card.kind === 'task' && onReply && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => reply('')} style={{ border: `1px solid ${theme.border}`, borderRadius: 8, padding: '9px 14px', background: theme.base, color: theme.text, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>补充说明</button>
        <button type="button" onClick={() => reply('这项工作现在进展如何？')} style={{ border: `1px solid ${theme.border}`, borderRadius: 8, padding: '9px 14px', background: theme.base, color: theme.text, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>询问进度</button>
      </div>}
      {card.kind === 'task' && onReply && <div style={{ fontSize: 11, color: theme.tertiary }}>将引用这项工作，在原输入框继续沟通，也可以添加图片。</div>}
      {waiting && <div style={{ fontSize: 12, color: theme.secondary }}>相关工作已暂停，收到明确结论后继续。</div>}
      {waiting && onReply && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => reply(requirement ? '我的业务目标是：' : '')} style={{ border: 0, borderRadius: 8, padding: '9px 14px', background: theme.primaryAction, color: theme.onPrimaryAction, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>{requirement ? '补充需求' : '给出决策'}</button>
        {card.recommendation && <button type="button" onClick={() => reply(`${requirement ? '确认业务目标：' : '同意采用以下方案：'}${card.recommendation}`)} style={{ border: `1px solid ${theme.border}`, borderRadius: 8, padding: '9px 14px', background: theme.base, color: theme.text, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>{requirement ? '按建议补充' : '采用建议并回复'}</button>}
      </div>}
      {waiting && onReply && <div style={{ fontSize: 11, color: theme.tertiary }}>点击后在输入框确认并发送；管家会核对{requirement ? '需求方' : '负责人'}身份。</div>}
      {!waiting && card.kind === 'decision' && state !== 'blocked' && <div style={{ fontSize: 12, color: theme.secondary }}>管家将核对回复并继续原任务。后续进展会回到本群。</div>}
      {resolution === 'blocked' && card.state === 'waiting' && <div style={{ fontSize: 12, color: theme.secondary }}>此问题已关闭，请查看管家后续的职责调整或重新询问消息。</div>}
    </div>
  </section>
}
