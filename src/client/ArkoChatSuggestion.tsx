import { useId, useState, type ReactNode, type CSSProperties } from 'react'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import type { ArkmeRecordThought } from '../record-thought-contract.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeArkoAvatar } from './ArkmeArkoAvatar.js'
import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { tr } from './locale.js'

/** Candidate switching is presentation only; it never starts another AI request. */
export function chatSuggestionQueue(thought: ArkmeRecordThought): string[] {
  const candidates = thought.display?.suggestions.flatMap(group => group.items) ?? []
  const unique = new Map<string, string>()
  for (const raw of candidates.length ? candidates : [thought.content]) {
    const text = raw.trim(), key = text.replace(/\s+/g, ' ')
    if (text && !unique.has(key)) unique.set(key, text)
  }
  if (!unique.size && thought.content.trim()) unique.set(thought.content.trim().replace(/\s+/g, ' '), thought.content.trim())
  return [...unique.values()]
}
const ellipsis: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const action: CSSProperties = { border: `1px solid ${theme.border}`, background: theme.elevated, color: theme.text,
  borderRadius: 8, padding: '7px 12px', font: 'inherit', fontSize: 12, cursor: 'pointer' }

export function ArkoChatSuggestionEntry({ thought, onOpen }: { thought: ArkmeRecordThought; onOpen(): void }) {
  const headline = thought.display?.headline.trim(), suggestion = chatSuggestionQueue(thought)[0]
  const pending = thought.status === 'generating', failed = thought.status === 'failed'
  return <button type="button" data-arkme-chat-suggestion-entry aria-label={tr('查看 Arko 回复建议')}
    onClick={event => { event.stopPropagation(); onOpen() }}
    style={{ display: 'block', width: 'min(420px, 100%)', maxWidth: '100%', margin: '6px auto 2px', padding: '4px 12px 6px',
      border: 0, background: 'transparent', color: theme.secondary, textAlign: 'left', font: 'inherit', cursor: 'pointer', lineHeight: 1.65 }}>
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 4, color: theme.tertiary, fontSize: 12 }}>
      <span aria-hidden style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${theme.border})` }}/>
      <Sparkle size={12} aria-hidden/><span>{tr(pending ? 'Arko 正在思考…' : 'Arko有想法')}</span>
      <span aria-hidden style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${theme.border})` }}/>
    </span>
    {!pending && headline && <span data-arkme-chat-suggestion-headline style={{ ...ellipsis, fontSize: 12 }}>{headline}</span>}
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12 }}>
      <span data-arkme-chat-suggestion-preview style={{ ...ellipsis, flex: 1 }}>
        {pending ? tr('正在帮你想一句更合适的话…') : failed ? tr('暂未获得回复建议') : suggestion ? `“${suggestion}”` : tr('查看建议')}
      </span>
      <span style={{ flex: 'none', color: theme.tertiary }}>{tr('展开查看')} ›</span>
    </span>
  </button>
}

export function ArkoChatSuggestionDialog({ thought, scopeKey, loading, error, analysis, onRetry, onFill, onClose }: {
  thought: ArkmeRecordThought; scopeKey: string; loading: boolean; error: string; analysis?: ReactNode
  onRetry(): void; onFill?: ((text: string) => void) | undefined; onClose(): void
}) {
  const titleId = useId(), queue = chatSuggestionQueue(thought)
  const key = JSON.stringify([scopeKey, thought.id, thought.generation, queue])
  const [selection, setSelection] = useState({ key, index: 0 })
  const index = selection.key === key ? selection.index : 0, current = queue[index % Math.max(1, queue.length)]
  const pending = thought.status === 'generating', failed = thought.status === 'failed'
  return <ArkmeConfirmDialog layout="picker" titleId={titleId} title={tr('Arko 回复建议')} busy={false} onClose={onClose}
    dialogStyle={{ width: 'min(450px, 100%)', maxHeight: 'min(600px, calc(100vh - 32px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 16 }}>
    <div data-arkme-chat-suggestion-dialog style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '17px 20px 14px' }}>
        <ArkmeArkoAvatar size={24}/><strong style={{ flex: 1, fontSize: 14 }}>{tr('Arko有想法')}</strong>
        <button type="button" aria-label={tr('关闭建议')} onClick={onClose}
          style={{ ...action, border: 0, background: 'transparent', color: theme.tertiary, padding: '2px 5px', fontSize: 20, lineHeight: 1 }}>×</button>
      </header>
      <div style={{ overflowY: 'auto', minHeight: 0, padding: '0 20px 18px' }}>
        {thought.display?.headline && <p style={{ margin: '0 0 12px', fontSize: 13, color: theme.secondary, lineHeight: 1.7 }}>{thought.display.headline}</p>}
        {pending || failed ? <div role="status" style={{ minHeight: 70, padding: '12px 0', fontSize: 13, color: theme.tertiary }}>
          {tr(pending ? '正在帮你想一句更合适的话…' : '暂未获得回复建议')}
          {failed && <button type="button" disabled={loading} onClick={onRetry} style={{ ...action, marginLeft: 10 }}>{tr('重新读取')}</button>}
        </div> : current && <div data-arkme-chat-suggestion-card style={{ padding: 13, borderRadius: 12, background: theme.layer1 }}>
          <div style={{ maxHeight: 'min(260px, 36vh)', overflowY: 'auto', minWidth: 0 }}>
            <ArkmeMarkdownBody text={current} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.75 }}/>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            {queue.length > 1 && <button type="button" onClick={() => setSelection({ key, index: (index + 1) % queue.length })} style={action}>{tr('换一句')}</button>}
            <button type="button" disabled={!onFill} title={onFill ? undefined : tr('当前输入框暂不可用')}
              onClick={() => onFill?.(current)} style={{ ...action, borderColor: 'transparent', color: theme.onPrimaryAction,
                background: theme.primaryAction, ...(!onFill ? { opacity: .45, cursor: 'not-allowed' } : {}) }}>{tr('填入输入框')}</button>
          </div>
        </div>}
        {!!thought.display?.warnings.length && <div style={{ marginTop: 12, color: theme.secondary, fontSize: 12, lineHeight: 1.65 }}>{thought.display.warnings.join('；')}</div>}
        {analysis && <details style={{ marginTop: 14 }}>
          <summary style={{ color: theme.tertiary, cursor: 'pointer', fontSize: 12 }}>{tr('为什么这样建议')}</summary>
          <div style={{ marginTop: 10 }}>{analysis}</div>
        </details>}
        {error && <div role="status" style={{ marginTop: 12, color: theme.tertiary, fontSize: 12 }}>{tr('建议暂时无法更新')}
          <button type="button" disabled={loading} onClick={onRetry} style={{ ...action, marginLeft: 8 }}>{tr('重试')}</button>
        </div>}
        <div style={{ marginTop: 14, textAlign: 'right', color: theme.caption, fontSize: 11 }}>{tr('仅你可见')}</div>
      </div>
    </div>
  </ArkmeConfirmDialog>
}
