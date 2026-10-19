import { useMemo, useRef, useState } from 'react'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import type { OfflineContextActions, OfflineContextEntry, OfflineContextMessage } from '../../offline-context.js'
import { confirmedOfflineContexts } from '../../offline-context.js'
import { OfflineContextCard, offlineClock } from './OfflineContextCard.js'
import { ArkmeConfirmDialog } from '../ArkmeConfirmDialog.js'
import css from './offline-context-preview.css?inline'

const stamp = (clock: string) => Date.parse(`2026-10-14T${clock}:00+08:00`)
const directMessage: OfflineContextMessage = { messageRef: 'demo-question', label: '同事 · 18:24 的问题',
  excerpt: '每次发送消息前都查询手机号绑定状态，网络慢时容易超时。这个检查要怎么优化？', occurredAtMillis: stamp('18:24') }
const groupMessage: OfflineContextMessage = { messageRef: 'demo-cost', label: '17:43 补充的存储成本测算图',
  excerpt: '这是之前的测算结果，图中比较了录音原文件与人声切片的存储成本。', occurredAtMillis: stamp('17:43') }
const earlierMessage: OfflineContextMessage = { messageRef: 'demo-earlier', label: '同事 · 18:20 的补充问题',
  excerpt: '如果校验结果没有变化，可以先缓存下来吗？', occurredAtMillis: stamp('18:20') }

/** Synthetic examples only. This module has no API imports and never reads account data. */
function exampleEntries(): OfflineContextEntry[] {
  return [{ id: 'demo-direct', revision: '1', conversationKey: 'demo-private', conversationName: '同事', conversationKind: 'private_chat',
    startAtMillis: stamp('18:30'), endAtMillis: stamp('18:32'), title: '关于发送前手机号检查的口头回复',
    summary: ['未绑定手机号不应直接隐藏功能。', '需要时再检查，并考虑缓存可发送状态。'], participants: ['你'],
    reason: '这段录音回应了稍早消息里的手机号校验与发送超时问题。对方是否在场尚未单独确认。', state: 'linked', visibility: 'private', sourceState: 'available',
    messages: [directMessage], selectedEvidenceIds: ['demo-e1', 'demo-e2'], evidence: [
      { id: 'demo-e1', startAtMillis: stamp('18:30'), endAtMillis: stamp('18:31'), speaker: '你', soundSource: 'in_person', transcriptRef: 'demo-e1',
        text: '不能因为没有绑定手机号，就把功能隐藏。应该在具体需要的时候检查。' },
      { id: 'demo-e2', startAtMillis: stamp('18:31'), endAtMillis: stamp('18:32'), speaker: '你', soundSource: 'in_person', transcriptRef: 'demo-e2',
        text: '可以考虑保存一个能否发送消息的状态，不要每次发送都重新查询。' },
    ] },
    { id: 'demo-group', revision: '1', conversationKey: 'demo-group', conversationName: '产品讨论群', conversationKind: 'group_chat',
      startAtMillis: stamp('17:30'), endAtMillis: stamp('17:38'), title: '录音存储成本与人声切片的讨论',
      summary: ['比较保留原录音与仅保留人声切片的存储占用。', '讨论后，同事在群内补充了一份成本测算图。'], participants: ['你', '其他参与者待确认'],
      reason: '录音讨论的存储口径，与随后群里图片中的容量和费用主题一致；图片作为后续补充资料关联。',
      state: 'linked', visibility: 'private', sourceState: 'available', messages: [groupMessage], selectedEvidenceIds: ['demo-g1'], evidence: [
        { id: 'demo-g1', startAtMillis: stamp('17:30'), endAtMillis: stamp('17:38'), speaker: '你', soundSource: 'in_person', transcriptRef: 'demo-g1',
          text: '我们先确认云端实际保存的是哪些文件，再比较整段录音和人声切片的存储成本，测算要使用同一个口径。' },
      ] },
    { id: 'demo-candidate', revision: '1', conversationKey: 'demo-private', conversationName: '同事', conversationKind: 'private_chat',
      startAtMillis: stamp('18:40'), endAtMillis: stamp('18:42'), title: '一段可能有关的后续讨论', summary: ['提到了缓存，但尚不能判断是否延续同一个问题。'], participants: [],
      reason: '时间接近、出现“缓存”一词，但缺少明确的问答对应，需要你确认。', state: 'suggested', visibility: 'private', sourceState: 'available',
      messages: [directMessage], selectedEvidenceIds: ['demo-p1'], evidence: [
        { id: 'demo-p1', startAtMillis: stamp('18:40'), endAtMillis: stamp('18:42'), speaker: '说话人未确认', soundSource: 'unknown', transcriptRef: 'demo-p1', text: '这个缓存要再看一下，看什么时候更新合适。' },
      ] },
  ]
}

export function offlineContextPreviewRequested(location: Pick<Location, 'hostname' | 'search'> | undefined = window.location): boolean {
  return location !== undefined && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
    && new URLSearchParams(location.search).get('arkme-offline-context-preview') === '1'
}

export function OfflineContextPreview() {
  const [entries, setEntries] = useState(exampleEntries)
  const [resetVersion, setResetVersion] = useState(0)
  const [conversation, setConversation] = useState('demo-private')
  const [showPending, setShowPending] = useState(false)
  const [detail, setDetail] = useState<{ title: string; text: string }>()
  const [highlight, setHighlight] = useState('')
  const [uncertainNext, setUncertainNext] = useState(false)
  const [sourceState, setSourceState] = useState<OfflineContextEntry['sourceState']>('available')
  const pendingWrites = useRef(new Map<string, () => void>())
  const message = conversation === 'demo-private' ? directMessage : groupMessage
  const messages = useMemo(() => conversation === 'demo-private' ? [earlierMessage, directMessage] : [groupMessage], [conversation])
  const pending = entries.filter(item => item.conversationKey === conversation && item.state === 'suggested')
  const linked = confirmedOfflineContexts(entries, conversation)
  const removed = entries.filter(item => item.conversationKey === conversation && item.state === 'dismissed')
  const actions = useMemo<OfflineContextActions>(() => ({
    async change(action) {
      if (action.conversationKey !== conversation) throw new Error('conversation changed')
      const change = action.change
      const apply = () => setEntries(current => current.map(item => {
        if (item.id !== action.entryId || item.revision !== action.expectedRevision) return item
        const next = { ...item, revision: String(Number(item.revision) + 1) }
        if (change.kind === 'dismiss') return { ...next, state: 'dismissed' }
        if (change.kind === 'restore') return { ...next, state: item.id === 'demo-candidate' ? 'suggested' : 'linked' }
        if (change.kind === 'confirm') return { ...next, state: 'linked' }
        if (change.kind === 'withdraw') return { ...next, visibility: 'private', hasSharedSnapshot: false }
        if (change.kind === 'share') return { ...next, visibility: 'shared' }
        if (change.kind === 'relink') {
          const target = messages.find(message => message.messageRef === change.messageRef)
          return target ? { ...next, messages: [target], state: 'suggested', reason: '你更换了关联消息，请核对这段录音是否回应了新问题。' } : item
        }
        const selected = item.evidence.filter(line => change.evidenceIds.includes(line.id))
        return { ...next, selectedEvidenceIds: change.evidenceIds, summary: selected.map(line => line.text), state: 'suggested',
          startAtMillis: selected[0]?.startAtMillis ?? item.startAtMillis, endAtMillis: selected.at(-1)?.endAtMillis ?? item.endAtMillis,
          reason: '范围已调整，以上直接展示所选原文。正式服务需要重新核对摘要与关联。' }
      }))
      if (uncertainNext) { pendingWrites.current.set(action.entryId, apply); setUncertainNext(false); return { status: 'unknown' } }
      apply()
      return { status: 'applied' }
    },
    async reconcile(action) {
      const apply = pendingWrites.current.get(action.entryId)
      if (!apply) return 'not_applied'
      apply(); pendingWrites.current.delete(action.entryId); return 'applied'
    },
    openMessage(ref) {
      setHighlight(ref)
      document.getElementById(`offline-preview-${ref}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    openTranscript(ref) {
      const evidence = entries.flatMap(entry => entry.evidence).find(item => item.transcriptRef === ref)
      if (evidence) setDetail({ title: '原文定位演示', text: `${evidence.speaker} · ${offlineClock(evidence.startAtMillis)}\n\n${evidence.text}\n\n这是示例片段。正式接入后，此操作会定位录音板块的对应原文。` })
    },
    play() { throw new Error('The preview contains no audio') },
  }), [conversation, entries, messages, uncertainNext])
  const card = (entry: OfflineContextEntry) => <OfflineContextCard key={`${entry.id}:${resetVersion}`} entry={{ ...entry, sourceState }} actions={actions} preview
    relinkOptions={messages.filter(message => !entry.messages.some(linked => linked.messageRef === message.messageRef))} />
  return <main className="arkme-offline-preview">
    <style>{css}</style>
    <div className="arkme-offline-preview-banner"><span><strong>线下交流 · 交互预览</strong> 示例内容，自动识别与真实分享待后端接入</span>
      <a href="/"><ArrowLeft size={14} />返回 Arkme</a></div>
    <div className="arkme-offline-preview-layout">
      <aside><div className="arkme-offline-preview-brand"><ChatsCircle size={24} /><strong>对话</strong></div>
        {[['demo-private', '同事', '线上提问 → 线下回复'], ['demo-group', '产品讨论群', '线下讨论 → 群内补充']].map(([key, name, hint]) => <button type="button" key={key}
          aria-pressed={conversation === key} onClick={() => { setConversation(key!); setShowPending(false); setHighlight('') }}>
          <span className="arkme-offline-preview-avatar">{name!.slice(0, 1)}</span><span><strong>{name}</strong><small>{hint}</small></span></button>)}
        <div className="arkme-offline-preview-tools"><p>预览检查</p>
          <label>原文状态<select aria-label="原文状态" value={sourceState} onChange={event => setSourceState(event.target.value as typeof sourceState)}>
            <option value="available">正常</option><option value="changed">已更新，待核对</option><option value="unavailable">暂不可用</option></select></label>
          <label><input type="checkbox" checked={uncertainNext} onChange={event => setUncertainNext(event.target.checked)} />下次操作模拟结果不明</label>
          <button type="button" onClick={() => { pendingWrites.current.clear(); setResetVersion(value => value + 1); setEntries(exampleEntries()); setSourceState('available'); setUncertainNext(false); setShowPending(false) }}><ArrowCounterClockwise size={15} />重置示例</button>
        </div>
      </aside>
      <section className="arkme-offline-preview-conversation" aria-label="示例聊天">
        <header><strong>{conversation === 'demo-private' ? '同事' : '产品讨论群'}</strong><span>线下交流补全上下文</span></header>
        <div className="arkme-offline-preview-scroll">
          {pending.length > 0 && <div className="arkme-offline-preview-pending"><button type="button" aria-expanded={showPending} onClick={() => setShowPending(!showPending)}>
            <Waveform size={15} />{pending.length} 段线下交流待确认 <span>{showPending ? '收起' : '查看'}</span></button>
            {showPending && pending.map(card)}</div>}
          <p className="arkme-offline-preview-date">2026 年 10 月 14 日 · 示例</p>
          {[...linked.map(entry => ({ at: entry.startAtMillis, key: entry.id, node: card(entry) })),
            ...messages.map(message => ({ at: message.occurredAtMillis, key: message.messageRef, node: <div id={`offline-preview-${message.messageRef}`} className={`arkme-offline-preview-message ${highlight === message.messageRef ? 'is-highlighted' : ''}`}>
              <small>{conversation === 'demo-private' ? '同事' : '群成员'}</small><p>{message.excerpt}</p>
              {conversation === 'demo-group' && <div className="arkme-offline-preview-attachment">测算图片 · 示例占位<br /><small>完整录音 / 人声切片 / 存储成本</small></div>}
              <div className="arkme-offline-preview-message-footer">{linked.some(entry => entry.messages.some(link => link.messageRef === message.messageRef)) && <button type="button" onClick={() => {
                const entry = linked.find(entry => entry.messages.some(link => link.messageRef === message.messageRef))
                if (entry) document.querySelector(`[data-offline-context-id="${entry.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}>线下已讨论 ↗</button>}<time>{offlineClock(message.occurredAtMillis)}</time></div>
            </div> })),
          ].sort((a, b) => a.at - b.at).map(row => <div className="arkme-offline-preview-row" key={row.key}>{row.node}</div>)}
          {removed.map(card)}
          <p className="arkme-offline-preview-note">按交流发生时间呈现；只有确认分享后，其他人才会看到相应内容。</p>
        </div>
      </section>
    </div>
    {detail && <ArkmeConfirmDialog titleId="offline-preview-source" title={detail.title} description={<span style={{ whiteSpace: 'pre-wrap' }}>{detail.text}</span>}
      busy={false} confirmLabel="知道了" busyLabel="" onClose={() => setDetail(undefined)} onConfirm={() => setDetail(undefined)} />}
  </main>
}
