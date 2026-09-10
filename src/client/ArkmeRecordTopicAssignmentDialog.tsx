import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import type { ArkmeRecordTopicAssignmentResult } from '../record-topic-assignment-contract.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeTheme } from './arkme-theme.js'
import { recordTopicAssignmentPort, type RecordTopicAssignmentPort, type RecordTopicAssignmentTarget } from './record-topic-assignment-port.js'

const styles = {
  header: { display: 'flex', alignItems: 'center', gap: 19, margin: 16 },
  search: { flex: 1, minWidth: 0, height: 40, boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
    border: 0, background: arkmeTheme.subtle, color: arkmeTheme.text, font: 'inherit', fontSize: 16 },
  action: { display: 'grid', placeItems: 'center', flexShrink: 0, width: 20, height: 20, padding: 0,
    border: 0, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer' },
  list: { maxHeight: 'min(384px, calc(100vh - 136px))', overflowY: 'auto', margin: '0 16px 16px' },
  topic: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 52, textAlign: 'left',
    border: 0, borderRadius: 12, padding: '10px 12px', background: 'transparent', color: arkmeTheme.text,
    font: 'inherit', fontSize: 16, cursor: 'pointer' },
  title: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { flexShrink: 0, color: arkmeTheme.secondary, fontSize: 12 },
  status: { fontSize: 13, color: arkmeTheme.secondary, padding: '12px 16px' },
} satisfies Record<string, CSSProperties>

function TopicPickerIcon({ release = false }: { release?: boolean }) {
  // Flutter icon_add.svg and icon_release.svg.
  return <svg width="20" height="20" viewBox={release ? '0 0 21 20' : '0 0 20 20'} fill="none" aria-hidden="true">
    {(release ? ['M3.5 7V4C3.5 3.44772 3.94772 3 4.5 3H7.5', 'M3.5 13V16C3.5 16.5523 3.94772 17 4.5 17H7.5',
      'M17.5 7V4C17.5 3.44772 17.0523 3 16.5 3H13.5', 'M17.5 13L15.5 15L13.5 17', 'M13.5 13L15.5 15L17.5 17']
      : ['M16.0721 10H3.92773', 'M10 3.92773V16.0721']).map(d => <path key={d} d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>
}

export function ArkmeRecordTopicAssignmentDialog(props: {
  source: ArkmeSourceItem
  assignmentRefs: readonly string[]
  firstRecordText: string
  currentTopicKey?: string
  port?: RecordTopicAssignmentPort
  onCancel(): void
  onRefresh(): void
  onAssigned(result: ArkmeRecordTopicAssignmentResult, target?: ArkmeSourceItem): void
}) {
  const port = props.port ?? recordTopicAssignmentPort
  const [keyword, setKeyword] = useState('')
  const [topics, setTopics] = useState<RecordTopicAssignmentTarget[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [selectionNotice, setSelectionNotice] = useState('')
  const [pending, setPending] = useState(false)
  const [pendingLabel, setPendingLabel] = useState('正在指定主题…')
  const readRef = useRef<AbortController>()
  const writeRef = useRef<AbortController>()
  const mounted = useRef(true)
  // A failed/unknown mutation requires fresh owner evidence, not a blind retry of this selection.
  const requiresRefresh = writeError !== ''
  const selectionError = props.assignmentRefs.length < 1 || props.assignmentRefs.length > 100 ? '请选择 1 至 100 条快记' : ''
  const locked = pending || requiresRefresh || selectionError !== ''
  const load = useCallback(async (cursor?: string) => {
    readRef.current?.abort()
    const controller = new AbortController()
    readRef.current = controller
    setLoading(true)
    setReadError('')
    if (cursor === undefined) { setTopics([]); setNextCursor(undefined) }
    try {
      const page = await port.listTopics(keyword, cursor, controller.signal)
      if (controller.signal.aborted || !mounted.current) return
      if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) throw new Error('主题列表加载不完整，请重试')
      setTopics(current => {
        const incoming = page.items.filter(topic => topic.kind === 'topic')
        const byRef = new Map((cursor === undefined ? [] : current).map(topic => [topic.topicHierarchyKey, topic]))
        for (const topic of incoming) byRef.set(topic.topicHierarchyKey, topic)
        return [...byRef.values()]
      })
      setNextCursor(page.hasMore ? page.nextCursor : undefined)
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setReadError(error instanceof Error ? error.message : '主题加载失败')
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false)
    }
  }, [keyword, port])
  useEffect(() => { void load(); return () => { readRef.current?.abort() } }, [load])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; readRef.current?.abort(); writeRef.current?.abort() }
  }, [])

  const assign = async (target?: ArkmeSourceItem, create = false) => {
    if (writeRef.current || requiresRefresh || selectionError !== '') return
    if (!create && target?.topicHierarchyKey && target.topicHierarchyKey === props.currentTopicKey) {
      setSelectionNotice('已在当前主题中！')
      return
    }
    setSelectionNotice('')
    const controller = new AbortController()
    writeRef.current = controller
    setPending(true)
    setPendingLabel(create ? '正在创建主题…' : target ? '正在指定主题…' : '正在移出主题…')
    let created: ArkmeSourceItem | undefined
    let result: ArkmeRecordTopicAssignmentResult
    try {
      if (create) {
        // Desktop derives a new topic title from the first selected record.
        const title = Array.from(props.firstRecordText.trim()).slice(0, 24).join('') || '未命名主题'
        created = await port.createTopic(title, props.source.sourceRef, controller.signal)
        if (controller.signal.aborted || !mounted.current) return
        target = created
        setPendingLabel('正在指定主题…')
      }
      result = await port.assign({ sourceRef: props.source.sourceRef, assignmentRefs: props.assignmentRefs,
        ...(target === undefined ? {} : { targetSourceRef: target.sourceRef }),
      }, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        setWriteError(`${created ? `主题「${created.displayName}」已创建。` : ''}${error instanceof Error ? error.message : '操作未完成'}。请刷新核对归属后重新选择。`)
      }
      return
    } finally {
      if (!controller.signal.aborted && mounted.current) setPending(false)
      if (writeRef.current === controller) writeRef.current = undefined
    }
    if (!controller.signal.aborted && mounted.current) props.onAssigned(result, target)
  }
  const cancel = () => { if (!writeRef.current) props.onCancel() }
  return <ArkmeConfirmDialog
    layout="picker"
    titleId="arkme-record-topic-assignment-title" title="指定主题"
    busy={pending} onClose={cancel} error={writeError || selectionError}
  >
    <style>{`.arkme-topic-picker-row:not(:disabled):hover { background: ${arkmeTheme.layer1} !important; }
      .arkme-topic-picker-action:disabled { opacity: .45; cursor: not-allowed; }`}</style>
    <div style={styles.header}>
      <input aria-label="搜索主题名" placeholder="搜索主题名" type="search" style={styles.search} value={keyword} disabled={locked}
        onChange={event => { setKeyword(event.currentTarget.value) }} />
      {props.source.kind === 'topic' && <button className="arkme-topic-picker-action" type="button" style={styles.action}
        aria-label="移出主题" title="移出主题" disabled={locked} onClick={() => { void assign() }}><TopicPickerIcon release /></button>}
      <button className="arkme-topic-picker-action" type="button" style={styles.action} aria-label="新建主题" title="创建新主题"
        disabled={locked} onClick={() => { void assign(undefined, true) }}><TopicPickerIcon /></button>
    </div>
    <div style={styles.list} aria-label="可指定主题">
      {topics.map(topic => <button className="arkme-topic-picker-row" type="button" key={topic.topicHierarchyKey}
        style={{ ...styles.topic, opacity: locked ? .45 : 1 }} aria-label={`指定到${topic.displayName}`}
        disabled={locked} onClick={() => { void assign(topic) }}>
        <span style={styles.title}>{topic.displayName}</span>
        <span style={styles.meta}>{topic.topicHierarchyKey === props.currentTopicKey ? '当前主题' : topic.recordCount}</span>
      </button>)}
      {loading && <p role="status" style={styles.status}>主题加载中…</p>}
      {!loading && topics.length === 0 && readError === '' && <button type="button" style={styles.topic} disabled={locked}
        onClick={() => { void assign(undefined, true) }}>+ 创建新主题</button>}
      {readError !== '' && <p role="alert">{readError}<button type="button" disabled={locked} onClick={() => { void load(nextCursor) }}>重试</button></p>}
      {nextCursor && readError === '' && <button type="button" disabled={loading || locked} onClick={() => { void load(nextCursor) }}>加载更多主题</button>}
    </div>
    {selectionNotice && <p role="status" style={styles.status}>{selectionNotice}</p>}
    {pending && <p role="status" style={styles.status}>{pendingLabel}</p>}
    {requiresRefresh && <button type="button" style={styles.topic} onClick={props.onRefresh}>刷新并重新选择</button>}

  </ArkmeConfirmDialog>
}
