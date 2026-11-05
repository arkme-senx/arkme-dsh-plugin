import { arkmeTheme as theme } from './arkme-theme.js'

export interface RunnerCard {
  version: 1
  kind: 'decision' | 'task'
  taskId: string
  decisionId?: string
  state: 'waiting' | 'answered' | 'completed' | 'blocked'
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
    if (value.version !== 1 || !['decision', 'task'].includes(String(value.kind))
      || !['waiting', 'answered', 'completed', 'blocked'].includes(String(value.state))
      || typeof value.taskId !== 'string' || !uuid.test(value.taskId)
      || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 6000) return undefined
    for (const key of ['expert', 'domain', 'recommendation', 'answer']) {
      if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > 10000)) return undefined
    }
    if (value.kind === 'decision' && (typeof value.decisionId !== 'string' || !uuid.test(value.decisionId) || !value.expert || !value.domain)) return undefined
    return value as unknown as RunnerCard
  } catch { return undefined }
}

export function ArkmeRunnerCard({ card, onReply, answered = false }: {
  card: RunnerCard
  onReply?: ((text: string) => void) | undefined
  answered?: boolean | undefined
}) {
  const waiting = card.kind === 'decision' && card.state === 'waiting' && !answered
  const status = waiting ? '等待负责人决策' : card.state === 'blocked' ? '需要处理' : card.kind === 'decision' ? '已收到负责人回复' : '已交付'
  const color = waiting ? theme.warning : card.state === 'blocked' ? theme.danger : theme.accent
  const reply = (text: string) => onReply?.(`【研发决策:${card.decisionId}】\n${text}`)
  return <section aria-label={status} data-arkme-runner-card={card.kind} style={{ width: 380, maxWidth: '100%', boxSizing: 'border-box', border: `1px solid ${theme.border}`, borderRadius: 14, background: theme.base, overflow: 'hidden' }}>
    <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${theme.borderSoft}`, fontSize: 12, color: theme.secondary }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      <strong style={{ color }}>{status}</strong><span style={{ marginLeft: 'auto' }}>研发管家</span>
    </div>
    <div style={{ padding: 18, display: 'grid', gap: 14 }}>
      <h3 style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: theme.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{card.title}</h3>
      {card.expert && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: theme.secondary }}><span style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: '50%', background: theme.layer2, color: theme.text }} aria-hidden>{Array.from(card.expert)[0]}</span><strong style={{ color: theme.text }}>{card.expert}</strong><span>负责 {card.domain}</span></div>}
      {(card.answer || card.recommendation) && <div style={{ padding: '12px 14px', background: theme.layer1, borderRadius: 8, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><div style={{ marginBottom: 4, fontSize: 11, color: theme.secondary }}>{card.kind === 'task' ? '交付与验证' : card.state === 'blocked' ? '状态说明' : card.answer ? '负责人回复' : '管家的建议'}</div>{card.answer || card.recommendation}</div>}
      {waiting && <div style={{ fontSize: 12, color: theme.secondary }}>相关工作已暂停，收到明确结论后继续。</div>}
      {waiting && onReply && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => reply('')} style={{ border: 0, borderRadius: 8, padding: '9px 14px', background: theme.primaryAction, color: theme.onPrimaryAction, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>给出决策</button>
        {card.recommendation && <button type="button" onClick={() => reply(`同意采用以下方案：${card.recommendation}`)} style={{ border: `1px solid ${theme.border}`, borderRadius: 8, padding: '9px 14px', background: theme.base, color: theme.text, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>采用建议并回复</button>}
      </div>}
      {waiting && onReply && <div style={{ fontSize: 11, color: theme.tertiary }}>点击后在输入框确认并发送；管家会核对负责人身份。</div>}
      {!waiting && card.kind === 'decision' && card.state !== 'blocked' && <div style={{ fontSize: 12, color: theme.secondary }}>管家将核对回复并继续原任务。后续进展会回到本群。</div>}
    </div>
  </section>
}
