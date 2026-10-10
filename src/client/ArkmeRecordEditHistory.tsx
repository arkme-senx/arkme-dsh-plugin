import { tr, useArkmeLocale } from './locale.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeRecordEditHistoryPage, ArkmeRecordEditHistoryReader } from '../record-edit-history.js'
import type { ArkmeTimelineItem } from '../types.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

const historyReader: ArkmeRecordEditHistoryReader = {
  page: (sourceRef, messageActionRef, cursorEditAt, signal) => callArkme<ArkmeRecordEditHistoryPage>(
    'source.record-edit-history', { sourceRef, messageActionRef, cursorEditAt }, signal,
  ),
}
const actionStyle = { border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 6, padding: '6px 12px', background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer' } as const
const emptyPage: ArkmeRecordEditHistoryPage = { items: [], hasMore: false }

/** Local read lifecycle only: no draft, mutation, timeline cache or persistent state. */
export function ArkmeRecordEditHistory({ sourceRef, messageActionRef, reader = historyReader, author }: {
  author?: Pick<ArkmeTimelineItem, 'isMe' | 'senderName' | 'senderKind' | 'avatarRef'>
  sourceRef: string
  messageActionRef: string
  reader?: ArkmeRecordEditHistoryReader
}) {
  useArkmeLocale()
  const [page, setPage] = useState(emptyPage)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController>()
  const busyRef = useRef(false)
  const cursorRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    clearTimeout(timerRef.current)
    busyRef.current = false
  }, [])
  const load = useCallback((cursor: number) => {
    if (busyRef.current) return
    busyRef.current = true
    cursorRef.current = cursor
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError('')
    const read = async (emptyRetries: number): Promise<void> => {
      try {
        const result = await reader.page(sourceRef, messageActionRef, cursor, controller.signal)
        if (controller.signal.aborted) return
        // Only retry an actually empty first page. An all-filtered page with a
        // continuation must retain the owner's cursor, not restart at page one.
        if (cursor === 0 && result.items.length === 0 && !result.hasMore && emptyRetries < 2) {
          timerRef.current = setTimeout(() => { void read(emptyRetries + 1) }, 500)
          return
        }
        setPage(previous => {
          const items = cursor === 0 ? result.items : [...new Map([...previous.items, ...result.items].map(item => [item.revisionUid, item])).values()]
          return { ...result, items }
        })
        cursorRef.current = result.hasMore ? result.nextCursorEditAt ?? 0 : 0
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : '编辑记录暂不可用')
      }
      if (!controller.signal.aborted) {
        busyRef.current = false
        setLoading(false)
      }
    }
    void read(0)
  }, [sourceRef, messageActionRef, reader])
  useEffect(() => {
    cancel()
    cursorRef.current = 0
    setPage(emptyPage)
    load(0)
    return cancel
  }, [load, cancel])
  const mine = author?.isMe === true
  return <div aria-busy={loading} data-arkme-edit-history="true" style={{ margin: '-24px -10px 0', paddingBottom: 16 }}>
      {page.items.map((revision, index) => <section key={revision.revisionUid} style={{ marginBottom: 15 }}>
        <div data-arkme-history-time style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', marginTop: 20, marginBottom: 15, color: arkmeTheme.caption, fontSize: 12, lineHeight: '18px' }}>
          <span />
          <time style={{ padding: '4px 6px' }} dateTime={new Date(revision.editAtMillis).toISOString()}>{historyTimeLabel(revision.editAtMillis)}</time>
          <div>{index === 0 && <span data-arkme-history-latest style={{ display: 'inline-block', marginLeft: 10, padding: '1px 4px', borderRadius: 4, border: `0.5px solid color-mix(in srgb, ${arkmeTheme.recordHistoryLatest} 30%, transparent)`, color: arkmeTheme.recordHistoryLatest, fontSize: 10, fontWeight: 700, lineHeight: '14px' }}>{tr("最新")}</span>}</div>
        </div>
        <div data-arkme-history-row style={{ display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: 10 }}>
          <ArkmeUserAvatar {...(author?.avatarRef === undefined ? {} : { avatarRef: author.avatarRef })} {...(author?.senderKind === undefined ? {} : { senderKind: author.senderKind })} size={32} label={author?.senderName || tr("作者头像")} />
          <div data-arkme-history-bubble style={{ minWidth: 0, maxWidth: 'calc(100% - 84px)', minHeight: 42, boxSizing: 'border-box', padding: 10, borderRadius: mine ? '12px 4px 12px 12px' : '4px 12px 12px 12px', border: `1px solid ${arkmeTheme.borderSoft}`, background: mine ? arkmeTheme.messageOwn : arkmeTheme.messageOther, overflowWrap: 'anywhere' }}>
            {revision.content.title && <h3 style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.7 }}><ArkmeRichText text={revision.content.title} presentation="preview" /></h3>}
            {(revision.content.textContent || revision.content.contentBlocks.length > 0 || (!revision.content.title && !revision.content.mediaUnavailable)) && <ArkmeMessageContent presentation="detail" item={{
              ...revision.content, mediaUnavailable: false, itemUid: revision.revisionUid, senderName: author?.senderName ?? '', isMe: mine,
              sendAtMillis: revision.editAtMillis, status: 1,
            }} />}
            {revision.content.mediaUnavailable === true && <p style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{tr("部分历史附件暂不可用")}</p>}
          </div>
        </div>
      </section>)}
      {loading && <p role="status" style={{ color: arkmeTheme.tertiary }}>{tr("正在加载编辑记录…")}</p>}
      {error !== '' && <div role="alert"><p>{error}</p><button data-arkme-feedback="neutral" type="button" style={actionStyle} onClick={() => { load(cursorRef.current) }}>{tr("重试")}</button></div>}
      {!loading && error === '' && page.items.length === 0 && !page.hasMore && <p style={{ color: arkmeTheme.tertiary }}>{tr("暂无编辑记录")}</p>}
      {!loading && error === '' && page.items.some(item => item.content.mediaUnavailable === true) && <button data-arkme-feedback="neutral" type="button" style={actionStyle} onClick={() => { load(0) }}>{tr("重新加载历史附件")}</button>}
      {!loading && error === '' && page.hasMore && <button data-arkme-feedback="neutral" type="button" style={actionStyle} onClick={() => { load(cursorRef.current) }}>{tr("加载更多")}</button>}
    </div>
}

function historyTimeLabel(value: number): string {
  const date = new Date(value)
  const now = new Date()
  const pad = (part: number) => String(part).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const offset = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000)
  if (offset === 0) return time
  if (offset === 1) return tr("昨天 {v0}", { v0: time })
  if (offset === 2) return tr("前天 {v0}", { v0: time })
  return `${date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}-`}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}
