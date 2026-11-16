import { useMemo, useState } from 'react'
import type { ArkmeRecordRevision } from '../record-edit-history.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, arkmeIntlLocale } from './locale.js'
import { historyAttachmentDiff, historyDiffContext, historyTextDiff, type HistoryTextDiff } from './record-history-diff.js'

const hintStyle = { color: arkmeTheme.tertiary, fontSize: 12, lineHeight: 1.6 } as const
const linkStyle = { background: 'none', border: 0, padding: '3px 0', color: arkmeTheme.info, cursor: 'pointer', font: 'inherit', fontSize: 12 } as const

export function historyRevisionKindLabel(kind: ArkmeRecordRevision['kind']): string {
  return tr(({ manual: '手动编辑', original: '原始消息', transcription: '语音转写', polish: 'AI 润色', rewrite: 'AI 改写', other: '其他变更' } as const)[kind])
}

function TextChanges({ label, diff, expanded }: { label?: string; diff: HistoryTextDiff; expanded: boolean }) {
  if (!diff.changes) return null
  const runs = expanded ? diff.runs : historyDiffContext(diff.runs)
  return <div data-arkme-history-text-diff style={{ marginTop: 10 }}>
    {(label || diff.coarse) && <div style={{ ...hintStyle, marginBottom: 4 }}>{label}{diff.coarse ? ` ${tr('改动较多，按整段对比')}` : ''}</div>}
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8, fontSize: 14 }}>
      {runs.map((run, index) => run.kind === 'gap'
        ? <span key={index} title={tr('未改动内容已折叠')} style={{ color: arkmeTheme.tertiary }}> … </span>
        : run.kind === 'same' ? <span key={index}>{run.text}</span>
        : run.kind === 'removed' ? <del key={index} aria-label={`${tr('删除')}：${run.text}`} style={{ color: arkmeTheme.text, background: arkmeTheme.dangerSoft, textDecorationColor: arkmeTheme.danger, borderRadius: 3, padding: '1px 2px' }}><span aria-hidden style={{ color: arkmeTheme.danger, fontSize: 11, userSelect: 'none' }}>− </span>{run.text}</del>
        : <ins key={index} aria-label={`${tr('新增')}：${run.text}`} style={{ color: arkmeTheme.text, background: `color-mix(in srgb, ${arkmeTheme.success} 16%, transparent)`, textDecoration: 'none', borderBottom: `1px solid ${arkmeTheme.success}`, borderRadius: 3, padding: '1px 2px' }}><span aria-hidden style={{ color: arkmeTheme.success, fontSize: 11, userSelect: 'none' }}>＋ </span>{run.text}</ins>)}
    </div>
  </div>
}

export function ArkmeRecordRevisionDiff({ revision, previous, orderUncertain = false, hasMore, senderName, mine }: {
  revision: ArkmeRecordRevision
  previous?: ArkmeRecordRevision | undefined
  orderUncertain?: boolean
  hasMore: boolean
  senderName: string
  mine: boolean
}) {
  const [context, setContext] = useState(false)
  const original = revision.kind === 'original'
  // Equal timestamps do not establish a causal order. Never guess which edit
  // came first, or treat the oldest loaded item as the original.
  const comparable = !orderUncertain && revision.kind !== 'original' && previous !== undefined && previous.editAtMillis < revision.editAtMillis
  const diff = useMemo(() => comparable && previous ? {
    title: historyTextDiff(previous.content.title ?? '', revision.content.title ?? ''),
    text: historyTextDiff(previous.content.textContent, revision.content.textContent),
    files: historyAttachmentDiff(previous.content, revision.content),
    formatChanged: (previous.content.textFormat ?? 'plain') !== (revision.content.textFormat ?? 'plain'),
  } : undefined, [comparable, previous, revision])
  const pendingAttachments = revision.content.contentBlocks.filter(block => block.attachmentState)
  const contentBlocks = revision.content.contentBlocks.filter(block => !block.attachmentState)
  const showFullText = original || !diff
  const hasContext = diff && [diff.title, diff.text].some(part => part.changes > 0 && historyDiffContext(part.runs).some(run => run.kind === 'gap'))
  const summary = diff ? [
    diff.title.changes ? tr('标题有修改') : '',
    diff.text.changes ? tr('正文修改 {v0} 处', { v0: String(diff.text.changes) }) : '',
    diff.formatChanged ? tr('文字格式已调整') : '',
    diff.files.added.length ? tr('新增 {v0} 个附件', { v0: String(diff.files.added.length) }) : '',
    diff.files.removed.length ? tr('移除 {v0} 个附件', { v0: String(diff.files.removed.length) }) : '',
    diff.files.renamed.length ? tr('附件名称已修改') : '',
    diff.files.reordered ? tr('附件顺序已调整') : '',
  ].filter(Boolean).join(' · ') : ''
  return <div data-arkme-history-revision={revision.revisionUid}>
    {!original && <div data-arkme-history-summary style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 12px', fontSize: 12, fontWeight: 500, lineHeight: 1.7 }}>
      <span>{diff ? summary || tr('文字、标题和可比较附件未变化')
        : orderUncertain || previous ? tr('版本先后顺序不明确，暂不对比')
        : hasMore ? tr('上一版本加载后显示差异') : tr('缺少上一版本，无法完整对比')}</span>
      {diff && previous && <span style={hintStyle}>{tr('对比基准：{v0}', { v0: new Date(previous.editAtMillis).toLocaleTimeString(arkmeIntlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })
        + (previous.kind !== 'manual' && previous.kind !== 'original' ? ` · ${historyRevisionKindLabel(previous.kind)}` : '') })}</span>}
    </div>}
    {diff && <>
      <TextChanges label={tr('标题')} diff={diff.title} expanded={context} />
      <TextChanges diff={diff.text} expanded={context} />
      {diff.files.added.map((file, index) => <div key={`add:${index}`} style={{ marginTop: 8, overflowWrap: 'anywhere', fontSize: 13 }}><span style={{ color: arkmeTheme.success }}>＋ {tr('新增附件')}</span> · {file.fileName || tr('未命名附件')}</div>)}
      {diff.files.removed.map((file, index) => <div key={`remove:${index}`} style={{ marginTop: 8, overflowWrap: 'anywhere', fontSize: 13 }}><span style={{ color: arkmeTheme.danger }}>− {tr('移除附件')}</span> · {file.fileName || tr('未命名附件')}</div>)}
      {diff.files.renamed.map((file, index) => <div key={`rename:${index}`} style={{ marginTop: 8, overflowWrap: 'anywhere', fontSize: 13 }}>{tr('附件改名')} · {file.before} → {file.after}</div>)}
      {!diff.files.available && <p style={hintStyle}>{tr('部分历史附件信息不完整，附件变化暂无法完整对比')}</p>}
    </>}
    {!original && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 10 }}>
      {hasContext && <button type="button" style={linkStyle} aria-expanded={context} onClick={() => setContext(value => !value)}>{context ? tr('收起上下文') : tr('展开上下文')}</button>}
    </div>}
    {(showFullText || contentBlocks.length > 0) && <div data-arkme-history-full style={original ? {} : { marginTop: 8 }}>
      {showFullText && revision.content.title && <h3 style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.7 }}><ArkmeRichText text={revision.content.title} presentation="preview" /></h3>}
      {(contentBlocks.length > 0 || showFullText && (revision.content.textContent || (!revision.content.title && !revision.content.mediaUnavailable && pendingAttachments.length === 0))) && <ArkmeMessageContent presentation="detail" item={{
        ...revision.content, title: showFullText ? revision.content.title ?? '' : '', textContent: showFullText ? revision.content.textContent ?? '' : '', contentBlocks,
        mediaUnavailable: false, itemUid: revision.revisionUid, senderName, isMe: mine,
        sendAtMillis: revision.editAtMillis, status: 1,
      }} />}
    </div>}
    {pendingAttachments.map((block, index) => <p key={block.attachmentUid ?? index} style={hintStyle}>
      {block.fileName} · {tr(block.attachmentState === 'failed' ? '此版本保存时附件上传失败' : '此版本保存时附件尚未上传完成')}
    </p>)}
    {revision.content.mediaUnavailable && <p style={hintStyle}>{tr('部分历史附件暂不可用')}</p>}
  </div>
}
