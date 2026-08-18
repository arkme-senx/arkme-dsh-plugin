import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { JotmoCallDetail, JotmoCallList, JotmoCallListItem } from '../types.js'
import { callJotmo } from './api.js'
import {
  callDirectionLabel,
  callMediaLabel,
  formatCallDuration,
  formatCallTime,
  formatTranscriptTime,
  isCurrentCallRequest,
  mergeCallListItems,
  nextSelectedCallRef,
  sectionStatusMessage,
  transcriptRowGap,
} from './call-presentation.js'
import { loadJotmoImageDataUrl } from './JotmoVirtualWorkspace.js'

const colors = {
  panel: 'var(--dsw-alias-bg-base, #ffffff)',
  subtle: 'var(--dsw-alias-bg-subtle, #f5f6f8)',
  text: 'var(--dsw-alias-label-primary, #17191c)',
  secondary: 'var(--dsw-alias-label-secondary, #68707c)',
  border: 'var(--dsw-alias-border-l2, #e2e5e9)',
  accent: '#20a866',
  active: '#e6f6ed',
  danger: '#c2413b',
}

const styles: Record<string, CSSProperties> = {
  shell: {
    display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)',
    width: '100%', height: '100%', minWidth: 0, overflow: 'hidden', background: colors.panel, color: colors.text,
  },
  listPane: { minWidth: 0, overflowY: 'auto', borderRight: `1px solid ${colors.border}`, background: colors.subtle },
  listHeader: {
    position: 'sticky', top: 0, zIndex: 1, padding: '18px 18px 12px',
    background: colors.subtle, borderBottom: `1px solid ${colors.border}`,
  },
  listTitle: { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 650 },
  list: { display: 'flex', flexDirection: 'column', padding: '6px 0 18px' },
  row: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', boxSizing: 'border-box',
    border: 0, borderBottom: `1px solid ${colors.border}`, background: 'transparent', color: 'inherit',
    textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  rowActive: { background: colors.active, boxShadow: `inset 3px 0 ${colors.accent}` },
  rowBody: { flex: 1, minWidth: 0, display: 'grid', gap: 6 },
  rowTitle: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 },
  time: { flex: 'none', color: colors.secondary, fontSize: 11 },
  rowMeta: { color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  preview: {
    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
    color: colors.secondary, fontSize: 12, lineHeight: '18px',
  },
  detailPane: { minWidth: 0, overflowY: 'auto', background: colors.panel },
  detail: { width: 'min(860px, 100%)', margin: '0 auto', padding: '28px clamp(22px, 5vw, 56px) 56px', boxSizing: 'border-box' },
  detailHeader: { display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 20, borderBottom: `1px solid ${colors.border}` },
  detailHeaderBody: { minWidth: 0 },
  detailTitle: { margin: 0, fontSize: 24, lineHeight: '32px', fontWeight: 700 },
  detailMeta: { display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 10, color: colors.secondary, fontSize: 13 },
  section: { paddingTop: 24 },
  sectionTitle: { margin: '0 0 12px', fontSize: 15, lineHeight: '22px', fontWeight: 650 },
  card: { padding: '16px 18px', border: `1px solid ${colors.border}`, borderRadius: 14, background: colors.subtle },
  participants: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px' },
  participant: { display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 },
  participantName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  plainText: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: '23px' },
  status: { padding: '28px 20px', color: colors.secondary, fontSize: 13, textAlign: 'center' },
  error: { margin: 12, padding: 12, borderRadius: 10, background: 'rgba(194,65,59,.09)', color: colors.danger, fontSize: 13 },
  button: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 10,
    border: `1px solid ${colors.border}`, borderRadius: 9, padding: '7px 12px', background: colors.panel,
    color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 12,
  },
  loadMore: { alignSelf: 'center', margin: '14px auto 0' },
  transcriptCard: { background: colors.panel },
  transcript: { display: 'flex', flexDirection: 'column' },
  transcriptProgress: {
    marginBottom: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(32,168,102,.08)',
    color: colors.secondary, fontSize: 12, lineHeight: '18px',
  },
  transcriptRow: { width: '100%', display: 'flex', alignItems: 'center', gap: 8 },
  transcriptRowSelf: { flexDirection: 'row-reverse' },
  speaker: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
    width: 48, flex: 'none', minWidth: 0, color: colors.secondary, fontSize: 11, lineHeight: '16px', textAlign: 'center',
  },
  speakerName: { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  transcriptBubble: {
    position: 'relative', minWidth: 0, maxWidth: '68%', padding: '6px 10px', boxSizing: 'border-box',
  },
  transcriptBubbleSelf: {
    borderRadius: '16px 5px 16px 16px', background: 'var(--dsw-specific-bubble, #eef3ff)',
  },
  transcriptBubbleOther: {
    borderRadius: '5px 16px 16px 16px', background: 'var(--dsw-alias-bg-subtle, #f0f2f5)',
  },
  transcriptText: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: '22px' },
  transcriptTimeReserve: { display: 'inline-block', width: 58, height: 0 },
  transcriptTime: {
    position: 'absolute', right: 10, bottom: 6, color: colors.secondary, fontSize: 11,
    lineHeight: '22px', whiteSpace: 'nowrap', pointerEvents: 'none',
  },
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '通话记录加载失败'
}

function callMeta(item: JotmoCallListItem): string {
  return [
    callMediaLabel(item.mediaType),
    callDirectionLabel(item.direction),
    item.connected ? '已接通' : '未接通',
    formatCallDuration(item.durationMillis),
  ].join(' · ')
}

function avatarInitial(label: string): string {
  return [...label.trim()][0] ?? '即'
}

function CallAvatar({ avatarRef, label, size }: {
  avatarRef: string | undefined
  label: string
  size: number
}) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    setSrc('')
    if (avatarRef === undefined || avatarRef.trim() === '') return () => { active = false }
    void loadJotmoImageDataUrl(avatarRef)
      .then(value => { if (active) setSrc(value) })
      .catch(() => undefined)
    return () => { active = false }
  }, [avatarRef])

  const frame: CSSProperties = {
    width: size,
    height: size,
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: '50%',
    background: '#dcefe5',
    color: '#176d3d',
    fontSize: Math.max(11, Math.round(size * 0.4)),
    lineHeight: 1,
    fontWeight: 650,
  }
  return <span style={frame} aria-hidden>
    {src === ''
      ? avatarInitial(label)
      : <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
  </span>
}

export function JotmoCallHistorySurface() {
  const [items, setItems] = useState<JotmoCallListItem[]>([])
  const itemsRef = useRef<JotmoCallListItem[]>([])
  const [selectedCallRef, setSelectedCallRef] = useState<string>()
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string>()
  const [listLoading, setListLoading] = useState(true)
  const [paging, setPaging] = useState(false)
  const [listError, setListError] = useState('')
  const [detail, setDetail] = useState<JotmoCallDetail>()
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const listGeneration = useRef(0)
  const detailGeneration = useRef(0)

  const loadList = useCallback(async (cursor?: string, append = false) => {
    const generation = ++listGeneration.current
    if (append) setPaging(true)
    else setListLoading(true)
    setListError('')
    try {
      let currentCursor = cursor
      let page: JotmoCallList
      let incoming: JotmoCallListItem[] = []
      const seenCursors = new Set<string>()
      do {
        page = await callJotmo<JotmoCallList>('calls.list', {
          limit: 20,
          ...(currentCursor === undefined ? {} : { cursor: currentCursor }),
        })
        incoming = mergeCallListItems(incoming, page.items)
        if (page.items.length > 0 || !page.hasMore || page.nextCursor === undefined
          || seenCursors.has(page.nextCursor)) break
        seenCursors.add(page.nextCursor)
        currentCursor = page.nextCursor
      } while (true)
      if (!isCurrentCallRequest(generation, listGeneration.current)) return
      const nextItems = append ? mergeCallListItems(itemsRef.current, incoming) : incoming
      itemsRef.current = nextItems
      setItems(nextItems)
      setSelectedCallRef(current => nextSelectedCallRef(current, nextItems))
      setHasMore(page.hasMore)
      setNextCursor(page.nextCursor)
    } catch (error) {
      if (isCurrentCallRequest(generation, listGeneration.current)) setListError(errorMessage(error))
    } finally {
      if (isCurrentCallRequest(generation, listGeneration.current)) {
        setListLoading(false)
        setPaging(false)
      }
    }
  }, [])

  const loadDetail = useCallback(async (callRef: string) => {
    const generation = ++detailGeneration.current
    setDetail(undefined)
    setDetailLoading(true)
    setDetailError('')
    try {
      const loaded = await callJotmo<JotmoCallDetail>('calls.detail', { callRef })
      if (isCurrentCallRequest(generation, detailGeneration.current)) setDetail(loaded)
    } catch (error) {
      if (isCurrentCallRequest(generation, detailGeneration.current)) setDetailError(errorMessage(error))
    } finally {
      if (isCurrentCallRequest(generation, detailGeneration.current)) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
    return () => {
      listGeneration.current += 1
      detailGeneration.current += 1
      itemsRef.current = []
    }
  }, [loadList])

  useEffect(() => {
    detailGeneration.current += 1
    setDetail(undefined)
    setDetailError('')
    if (selectedCallRef !== undefined) void loadDetail(selectedCallRef)
  }, [loadDetail, selectedCallRef])

  const selectedItem = items.find(item => item.callRef === selectedCallRef)

  return <section style={styles.shell} aria-label="通话记录">
    <aside style={styles.listPane} aria-label="通话记录列表">
      <header style={styles.listHeader}><h2 style={styles.listTitle}>通话记录</h2></header>
      {listError !== '' && <div style={styles.error} role="alert">
        <div>{listError}</div>
        <button type="button" style={styles.button} onClick={() => { void loadList() }}>重试列表</button>
      </div>}
      {listLoading ? <div style={styles.status}>正在加载通话记录…</div>
        : items.length === 0 && listError === '' ? <div style={styles.status}>暂无通话记录</div>
          : <div style={styles.list}>
            {items.map(item => {
              const selected = item.callRef === selectedCallRef
              return <button
                key={item.callRef}
                type="button"
                aria-pressed={selected}
                style={{ ...styles.row, ...(selected ? styles.rowActive : {}) }}
                onClick={() => { setSelectedCallRef(item.callRef) }}
              >
                <CallAvatar avatarRef={item.avatarRef} label={item.displayName} size={32} />
                <span style={styles.rowBody}>
                  <span style={styles.rowTitle}>
                    <span style={styles.name}>{item.displayName}</span>
                    <span style={styles.time}>{formatCallTime(item.startedAtMillis)}</span>
                  </span>
                  <span style={styles.rowMeta}>{callMeta(item)}</span>
                  <span style={styles.preview}>
                    {item.summaryPreview || sectionStatusMessage('summary', item.summaryState)}
                  </span>
                </span>
              </button>
            })}
            {hasMore && nextCursor !== undefined && <button
              type="button"
              style={{ ...styles.button, ...styles.loadMore }}
              disabled={paging}
              onClick={() => { void loadList(nextCursor, true) }}
            >{paging ? '正在加载…' : '加载更多'}</button>}
          </div>}
    </aside>

    <main style={styles.detailPane} aria-label="通话详情">
      {selectedCallRef === undefined ? <div style={styles.status}>选择一条通话记录查看详情</div>
        : detailLoading ? <div style={styles.status}>正在加载通话详情…</div>
          : detailError !== '' ? <div style={styles.error} role="alert">
            <div>{detailError}</div>
            <button type="button" style={styles.button} onClick={() => { void loadDetail(selectedCallRef) }}>重试详情</button>
          </div>
            : detail !== undefined ? <article style={styles.detail}>
              <header style={styles.detailHeader}>
                <CallAvatar
                  avatarRef={detail.participants.find(item => !item.isSelf)?.avatarRef ?? selectedItem?.avatarRef}
                  label={detail.displayName}
                  size={48}
                />
                <div style={styles.detailHeaderBody}>
                  <h2 style={styles.detailTitle}>{detail.displayName}</h2>
                  <div style={styles.detailMeta}>
                    <span>{formatCallTime(detail.startedAtMillis)}</span>
                    <span>{callMediaLabel(detail.mediaType)}</span>
                    <span>{callDirectionLabel(detail.direction)}</span>
                    <span>{detail.connected ? '已接通' : '未接通'}</span>
                    <span>{formatCallDuration(detail.durationMillis)}</span>
                  </div>
                </div>
              </header>

              <section style={styles.section}>
                <h3 style={styles.sectionTitle}>参与人</h3>
                <div style={styles.card}>
                  {detail.participants.length > 0 ? <div style={styles.participants}>
                    {detail.participants.map((item, index) => <span
                      key={`${item.isSelf ? 'self' : 'peer'}-${item.displayName}-${String(index)}`}
                      style={styles.participant}
                    >
                      <CallAvatar avatarRef={item.avatarRef} label={item.displayName} size={28} />
                      <span style={styles.participantName}>{item.displayName}</span>
                    </span>)}
                  </div> : selectedItem?.displayName || '即我用户'}
                </div>
              </section>

              <section style={styles.section}>
                <h3 style={styles.sectionTitle}>AI 摘要</h3>
                <div style={styles.card}>
                  {detail.summary.state === 'ready'
                    ? <p style={styles.plainText}>{detail.summary.content}</p>
                    : <div style={styles.status}>{detail.summary.message || sectionStatusMessage('summary', detail.summary.state)}</div>}
                </div>
              </section>

              <section style={styles.section}>
                <h3 style={styles.sectionTitle}>通话转录</h3>
                <div style={{ ...styles.card, ...styles.transcriptCard }}>
                  {detail.transcript.items.length > 0 ? <div style={styles.transcript}>
                    {detail.transcript.state === 'processing' && <div style={styles.transcriptProgress}>
                      {detail.transcript.message || sectionStatusMessage('transcript', 'processing', true)}
                    </div>}
                    {detail.transcript.items.map((item, index) => {
                      const previous = index === 0 ? undefined : detail.transcript.items[index - 1]
                      return <div
                        key={item.itemId}
                        style={{
                          ...styles.transcriptRow,
                          ...(item.isSelf ? styles.transcriptRowSelf : {}),
                          marginTop: transcriptRowGap(previous, item),
                        }}
                      >
                        <div style={styles.speaker}>
                          <CallAvatar avatarRef={item.avatarRef} label={item.speakerLabel} size={32} />
                          <span style={styles.speakerName}>{item.speakerLabel}</span>
                        </div>
                        <div style={{
                          ...styles.transcriptBubble,
                          ...(item.isSelf ? styles.transcriptBubbleSelf : styles.transcriptBubbleOther),
                        }}>
                          <p style={styles.transcriptText}>
                            {item.text}<span style={styles.transcriptTimeReserve} aria-hidden />
                          </p>
                          <span style={styles.transcriptTime}>
                            {formatTranscriptTime(detail.startedAtMillis, item.startOffsetMillis)}
                          </span>
                        </div>
                      </div>
                    })}
                  </div> : <div style={styles.status}>
                    {detail.transcript.message || sectionStatusMessage('transcript', detail.transcript.state)}
                  </div>}
                </div>
              </section>
            </article> : <div style={styles.status}>选择一条通话记录查看详情</div>}
    </main>
  </section>
}
