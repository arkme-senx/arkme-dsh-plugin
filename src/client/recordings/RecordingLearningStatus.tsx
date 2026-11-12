import { useEffect, useRef, useState } from 'react'
import type { LearningStatus, RecordingLearning } from '../../recording-learning-contract.js'
import { callArkme } from '../api.js'
import { arkmeTheme as color } from '../arkme-theme.js'
import { tr } from '../locale.js'

const labels: Record<LearningStatus, string> = { pending: '等待处理', processing: '处理中', ready: '已生效', skipped: '已跳过', failed: '处理失败', revoked: '已撤回' }
const button = { border: `1px solid ${color.border}`, borderRadius: 6, padding: '6px 9px', background: color.base, color: color.text, font: 'inherit', cursor: 'pointer' }
const errorMessage = (e: unknown) => e instanceof Error ? e.message : tr('学习状态读取失败')
const reasons: Record<string, string> = {
  awaiting_evidence: '等待提取声音证据', queued: '已进入处理队列', extracting: '正在提取声音证据',
  reference_ready: '有效声音参考已生效', confirmation_withdrawn: '这次确认已撤销或被后续纠错替代',
  assignment_not_eligible: '尚未明确关联人物，暂不用于学习', sound_source_unknown: '声音来源不确定，暂不用于学习',
  sound_source_playback: '播放内容不会用于现场声音学习', quality_not_eligible: '声音质量不足，已跳过',
  reference_not_qualified: '声音证据未满足学习条件，已跳过', speech_too_short: '有效说话时长不足',
  extraction_not_scheduled: '此片段尚无可处理的声音提取任务，暂不用于学习',
  short_speech: '有效说话时长不足', uncertain_speech: '无法确认有效说话内容', multiple_speakers: '片段包含多个人的声音',
  overlapping_speech: '片段中有重叠说话，无法作为独立声音参考',
}
function reasonText(reason: string, status: LearningStatus) {
  if (reasons[reason]) return tr(reasons[reason])
  if (/timeout|timed out|lease expired/i.test(reason)) return tr('声音提取超时')
  if (/unavailable|connection|temporar|resource exhausted/i.test(reason)) return tr('声音处理服务暂不可用')
  return tr(status === 'failed' ? '声音证据提取失败' : status === 'skipped' ? '声音证据不满足学习条件，已跳过' : labels[status])
}

/** This is a current server read, independent of the immutable correction receipt. */
export function RecordingLearningStatus({ learningRef, refreshKey = 0 }: { learningRef: string; refreshKey?: number }) {
  const [result, setResult] = useState<RecordingLearning>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0), [expanded, setExpanded] = useState(false)
  const controller = useRef<AbortController>()
  useEffect(() => {
    const c = new AbortController(); controller.current = c
    let timer: ReturnType<typeof setTimeout> | undefined
    setResult(undefined); setError(''); setBusy(true)
    const read = async () => {
      try {
        const next = await callArkme<RecordingLearning>('recordings.speaker.correction.learning', { learningRef }, c.signal)
        if (c.signal.aborted) return
        setResult(next); setError('')
        if (next.counts.pending + next.counts.processing > 0) timer = setTimeout(() => { void read() }, 5000)
      } catch (e) { if (!c.signal.aborted) setError(errorMessage(e)) }
      finally { if (!c.signal.aborted) setBusy(false) }
    }
    void read()
    return () => { c.abort(); controller.current?.abort(); clearTimeout(timer) }
  }, [learningRef, revision, refreshKey])
  useEffect(() => () => { controller.current?.abort() }, [])
  const summary = !result ? tr('状态暂不可用')
    : result.counts.failed > 0 ? tr('部分未生效')
    : result.counts.pending + result.counts.processing > 0 ? tr('处理中')
    : result.counts.ready > 0 ? tr('已生效')
    : result.counts.revoked > 0 ? tr('已撤回') : tr('未用于学习')
  return <section aria-label={tr('声音参考学习状态')} style={{ borderTop: `1px solid ${color.border}`, paddingTop: 10, fontSize: 12, lineHeight: 1.6 }}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}><span role="status">{tr('声音参考')}：{busy && !result ? tr('正在读取…') : summary}</span>
      {result && <button style={{...button,border:0,color:color.secondary,padding:'4px 0'}} onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>{tr(expanded ? '收起详情' : '查看详情')}</button>}
    </div>
    {result && expanded && <>
      <p style={{color:color.secondary}}>{tr('声音参考处理不影响已保存的标记。')}</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>{result.items.map((row, index) => <li key={index} style={{ padding: '7px 0', borderTop: `1px solid ${color.border}` }}>
        <span>{tr('片段')} {index + 1} · {tr(labels[row.status])}</span>
        {row.reason && <div style={{ color: color.secondary }}>{reasonText(row.reason, row.status)}</div>}
        {row.sampleCount > 0 && <div style={{ color: color.secondary }}>{tr('有效声音样本')} {row.sampleCount}</div>}
      </li>)}</ul>
    </>}
    {error && <p role="alert" style={{ color: color.danger }}>{tr('暂时无法读取状态，已保存的标记不受影响。')} <button style={button} disabled={busy} onClick={() => setRevision(v => v + 1)}>{tr('重新读取状态')}</button></p>}
  </section>
}
