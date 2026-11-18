import {useLayoutEffect,useId,useRef,useState,useSyncExternalStore,type ReactNode} from 'react'
import type {RecordExcerptOriginal} from '../record-excerpt.js'
import {ArkmeClientError} from '../sdk/index.js'
import {tr,useArkmeLocale} from './locale.js'
import {callArkme} from './api.js'
import {arkmeAuthStore} from './auth-store.js'
import {arkmeTheme} from './arkme-theme.js'
import {ArkmeCloseButton} from './ArkmeCloseButton.js'
import {quoteCanonicalText} from '../message-quote.js'
import {ArkmeRichText} from './ArkmeRichText.js'
import {ArkmeMarkdownBody} from './ArkmeMarkdownBody.js'
import {quoteDomProjection,quoteDomRange} from './message-quote-selection.js'
import {isArkmeTransientReadFailure} from './read-retry.js'

type OriginalState =
  | { kind: 'loading' }
  | { kind: 'ready'; original: RecordExcerptOriginal }
  | { kind: 'error'; retryable: boolean; code?: string }

const actionStyle = { padding: '4px 0', border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit' }

function firstSelectionLine(range: Range) {
  const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
  const first = rects[0]
  if (!first) return undefined

  let { left, right, top, bottom } = first
  for (const rect of rects) {
    if (rect.top >= first.bottom || rect.bottom <= first.top) continue
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function ExcerptOriginalBody({ original }: { original: RecordExcerptOriginal }) {
  const viewport = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const name = `arkme-excerpt-original-${useId().replace(/[^a-z0-9]/gi, '')}`
  useLayoutEffect(() => {
    const scroller = viewport.current
    const element = body.current
    const selection = original.selection
    if (!scroller || !element || !selection) return
    const projection = quoteDomProjection(element)
    const expected = quoteCanonicalText({ textContent: original.text, textFormat: original.textFormat ?? 'plain' })
    if (projection.text !== expected) return
    const range = quoteDomRange(element, projection, selection.start, selection.end)
    if (!range) return

    // The same verified range owns both the highlight and the opening scroll.
    const view = element.ownerDocument.defaultView
    const start = range.startContainer
    const parent = start.nodeType === 1 ? start as Element : start.parentElement
    // Markdown code and tables may have their own horizontal viewport.
    for (let ancestor = parent; ancestor && ancestor !== scroller; ancestor = ancestor.parentElement) {
      const viewportWidth = ancestor.clientWidth
      if (viewportWidth === 0 || ancestor.scrollWidth <= viewportWidth) continue
      const style = view?.getComputedStyle(ancestor)
      if (style?.overflowX !== 'auto' && style?.overflowX !== 'scroll') continue

      // A range can extend beyond this scrollport into another block.
      const localRange = range.cloneRange()
      if (!ancestor.contains(range.endContainer)) localRange.setEnd(ancestor, ancestor.childNodes.length)
      const firstLine = firstSelectionLine(localRange)
      if (!firstLine) continue
      const left = ancestor.getBoundingClientRect().left + ancestor.clientLeft
      const right = left + viewportWidth
      const revealWidth = Math.min(firstLine.width, viewportWidth)
      let revealLeft = firstLine.left
      if (firstLine.width > viewportWidth) {
        // The selection can start anywhere within the visual line in bidirectional text.
        const scalarWidth = (projection.text.codePointAt(selection.start) ?? 0) > 0xffff ? 2 : 1
        const startRange = quoteDomRange(element, projection, selection.start, Math.min(selection.end, selection.start + scalarWidth))
        const startRect = startRange && firstSelectionLine(startRange)
        const maxLeft = firstLine.right - revealWidth
        revealLeft = startRect
          ? Math.max(firstLine.left, Math.min(maxLeft, (startRect.left + startRect.right - revealWidth) / 2))
          : style.direction === 'rtl' ? maxLeft : firstLine.left
      }
      const revealRight = revealLeft + revealWidth
      if (revealLeft < left || revealRight > right) {
        ancestor.scrollLeft += revealLeft - left - (viewportWidth - revealWidth) / 2
      }
    }
    const firstLine = firstSelectionLine(range)
    if (firstLine && scroller.clientHeight > 0) {
      const top = scroller.getBoundingClientRect().top + scroller.clientTop
      if (firstLine.top < top || firstLine.bottom > top + scroller.clientHeight) {
        scroller.scrollTop += firstLine.top - top - (scroller.clientHeight - firstLine.height) / 2
      }
      scroller.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }

    const { Highlight, CSS } = element.ownerDocument.defaultView ?? {}
    if (!Highlight || !CSS?.highlights) return
    CSS.highlights.set(name, new Highlight(range))
    return () => { CSS.highlights.delete(name) }
  }, [name, original])
  return <div ref={viewport} tabIndex={0} style={{ maxHeight: 'min(45vh, 360px)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
    {original.selection && <style>{`::highlight(${name}) { background: ${arkmeTheme.warningSoft}; color: inherit; }`}</style>}
    <div ref={body} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {original.textFormat === 'markdown'
        ? <ArkmeMarkdownBody text={original.text} highlightMentions={false} />
        : <ArkmeRichText text={original.text} linkLabelMode="raw" />}
    </div>
  </div>
}

/** Each open reads the saved locator and source ACL again. No offline fallback. */
export function ExcerptOriginal({ recordUid, sourceRef, messageActionRef, renderExcerpt }: {
  recordUid: string
  sourceRef?: string
  messageActionRef?: string
  renderExcerpt?: (opener: ReactNode) => ReactNode
}) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const account = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const [state, setState] = useState<OriginalState>()
  const request = useRef<AbortController>()
  const panel = useRef<HTMLElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const id = useId()
  const open = state !== undefined

  useLayoutEffect(() => {
    setState(undefined)
    return () => request.current?.abort()
  }, [account, recordUid, sourceRef, messageActionRef])
  useLayoutEffect(() => {
    if (!open) return
    panel.current?.focus({ preventScroll: true })
    panel.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [open])

  const close = () => {
    request.current?.abort()
    setState(undefined)
    opener.current?.focus()
  }
  const load = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setState({ kind: 'loading' })
    try {
      const original = await callArkme<RecordExcerptOriginal>('excerpt.original', {
        recordUid,
        ...(sourceRef && messageActionRef ? { sourceRef, messageActionRef } : {}),
      }, controller.signal)
      if (!controller.signal.aborted) setState({ kind: 'ready', original })
    } catch (error) {
      if (controller.signal.aborted) return
      const detail = error instanceof ArkmeClientError ? error.body : undefined
      setState({
        kind: 'error',
        retryable: detail?.retryable ?? isArkmeTransientReadFailure(error),
        ...(detail ? { code: detail.code } : {}),
      })
    }
  }

  const action = <button ref={opener} type="button" data-arkme-feedback="neutral" aria-expanded={open}
      aria-controls={open ? id : undefined} style={actionStyle} onClick={event => {
        event.stopPropagation()
        if (open) close()
        else void load()
      }}>{tr('查看原文')}</button>
  return <>
    {renderExcerpt ? renderExcerpt(action) : action}
    {state && <section ref={panel} id={id} data-arkme-excerpt-original aria-labelledby={`${id}-title`} tabIndex={-1}
      onClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) event.stopPropagation()
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        close()
      }}
      style={{ minWidth: 0, boxSizing: 'border-box', marginTop: 8, padding: '0 10px 10px', fontSize: 12, lineHeight: '18px',
        border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 8, background: arkmeTheme.base, color: arkmeTheme.text }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong id={`${id}-title`} style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {state.kind === 'ready' ? state.original.title || tr('引用原文') : tr('引用原文')}
        </strong>
        <ArkmeCloseButton aria-label={tr('关闭原文')} onClick={close} />
      </header>
      {state.kind === 'loading' && <div role="status" style={{ color: arkmeTheme.secondary }}>{tr('正在打开原文…')}</div>}
      {state.kind === 'error' && <>
        <div role="alert" style={{ color: arkmeTheme.secondary }}>
          {state.code === 'excerpt-source-changed' ? tr('原文或引用已变化，无法查看。')
            : state.code === 'excerpt-source-too-large' ? tr('原文过长，无法在此展开。')
              : state.retryable ? tr('暂时无法打开原文，请稍后重试。') : tr('原文暂不可查看。')}
        </div>
        {state.retryable && <button type="button" data-arkme-feedback="neutral" style={actionStyle} onClick={() => {
          panel.current?.focus({ preventScroll: true })
          void load()
        }}>{tr('重试')}</button>}
      </>}
      {state.kind === 'ready' && <ExcerptOriginalBody original={state.original} />}
    </section>}
  </>
}
