import { useEffect, useRef, type CSSProperties } from 'react'
import type { ArkmeContentBlock, ArkmeLongArticleDraft } from '../types.js'
import { createArkmeSdk } from '../sdk/index.js'
import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import { articleImageUrl } from './ArkmeLongArticleBody.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'

const sdk = createArkmeSdk()
const button: CSSProperties = { border: 0, borderRadius: 8, padding: '8px 12px', background: 'transparent', color: theme.text, cursor: 'pointer', font: 'inherit', fontSize: 14 }

export function ArkmeLongArticleDraftDialog({ draft, blocks = [], preview, onPreview, onClose, onOriginal, onRestore }: {
  draft: ArkmeLongArticleDraft
  blocks?: ArkmeContentBlock[] | undefined
  preview: boolean
  onPreview(value: boolean): void
  onClose(): void
  onOriginal(): void
  onRestore(): void
}) {
  useArkmeLocale()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => { previous?.focus?.() }
  }, [preview])
  const date = new Date(draft.updatedAtMillis)
  const validDate = draft.updatedAtMillis > 0 && Number.isFinite(date.getTime())
  const two = (value: number) => String(value).padStart(2, '0')
  const savedTime = validDate ? `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}` : tr('保存时间未知')
  return <div style={{ position: 'fixed', inset: 0, zIndex: 1300, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(0,0,0,.52)' }}>
    <section role="dialog" aria-modal="true" aria-label={tr(preview ? '草稿预览' : '发现未发布的草稿')} onKeyDown={event => {
      if (event.key !== 'Tab') return
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')]
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }} style={{ position: 'relative', width: preview ? 'min(760px, 90vw)' : 'min(440px, 90vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 24, boxSizing: 'border-box', borderRadius: 16, background: theme.base, color: theme.text, boxShadow: theme.shadow }}>
      <h3 style={{ margin: '0 32px 16px 0', fontSize: 18 }}>{tr(preview ? '草稿预览' : '发现未发布的草稿')}</h3>
      <button ref={closeRef} autoFocus type="button" aria-label={tr(preview ? '关闭草稿预览' : '关闭草稿恢复弹窗')} style={{ ...button, position: 'absolute', top: 12, right: 12, fontSize: 26 }} onClick={() => preview ? onPreview(false) : onClose()}>×</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 14 }}>
        <span style={{ color: theme.secondary }}>{tr('保存时间：')}</span>
        <time dateTime={validDate ? date.toISOString() : undefined} style={{ color: theme.info }}>{savedTime}</time>
        {!preview && <button type="button" aria-label={tr('预览草稿')} title={tr('预览草稿')} style={{ ...button, display: 'inline-flex', padding: 4, color: theme.info }} onClick={() => onPreview(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>}
      </div>
      {preview && <div style={{ minHeight: 0, overflowY: 'auto', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${theme.border}` }}>
        <h2 style={{ margin: '0 0 16px', overflowWrap: 'anywhere' }}><ArkmeRichText text={draft.title || tr('无标题长文')} presentation="preview" /></h2>
        {draft.textFormat === 'markdown' || draft.document
          ? <ArkmeMarkdownBody text={draft.textContent} localArticleImages renderImage={(ref, alt) => {
            const block = blocks.find(value => value.kind === 'image' && `arkme-asset:${value.fileAssetUid}` === ref)
            let url = block ? articleImageUrl(block) : undefined
            if (ref.startsWith('arkme-local:')) { try { url = sdk.localFileUrl(ref.slice('arkme-local:'.length)) } catch { /* Invalid stored reference is shown as unavailable. */ } }
            return url ? <img src={url} alt={alt} style={{ maxWidth: '100%', height: 'auto' }} /> : undefined
          }} />
          : <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7 }}><ArkmeRichText text={draft.textContent} linkLabelMode="raw" /></p>}
      </div>}
      <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
        <button type="button" style={button} onClick={() => preview ? onPreview(false) : onOriginal()}>{tr(preview ? '返回' : '编辑原文')}</button>
        <button type="button" style={{ ...button, background: theme.primaryAction, color: theme.onPrimaryAction }} onClick={onRestore}>{tr('恢复草稿')}</button>
      </div>
    </section>
  </div>
}
