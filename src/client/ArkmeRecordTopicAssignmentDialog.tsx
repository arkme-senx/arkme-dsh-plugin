import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import type { ArkmeRecordTopicAssignmentResult } from '../record-topic-assignment-contract.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeTheme } from './arkme-theme.js'
import { recordTopicAssignmentPort, type RecordTopicAssignmentPort, type RecordTopicAssignmentTarget } from './record-topic-assignment-port.js'

const styles = {
  search: { width: '100%', boxSizing: 'border-box', marginTop: 16, padding: '9px 12px', borderRadius: 8,
    border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.input, color: arkmeTheme.text, font: 'inherit' },
  list: { maxHeight: 'min(360px, 45vh)', overflowY: 'auto', marginTop: 10 },
  topic: { width: '100%', textAlign: 'left', border: 0, borderRadius: 8, padding: '10px 12px',
    background: 'transparent', color: arkmeTheme.text, font: 'inherit', cursor: 'pointer', overflowWrap: 'anywhere' },
  status: { fontSize: 13, color: arkmeTheme.secondary, padding: '12px 0' },
} satisfies Record<string, CSSProperties>

export function ArkmeRecordTopicAssignmentDialog(props: {
  source: ArkmeSourceItem
  assignmentRefs: readonly string[]
  firstRecordText: string
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
    titleId="arkme-record-topic-assignment-title" title="指定主题"
    description={`已选择 ${props.assignmentRefs.length} 条快记`}
    busy={pending} confirmDisabled={requiresRefresh || selectionError !== ''} confirmLabel="新建主题" busyLabel={pendingLabel}
    onClose={cancel} onConfirm={() => { void assign(undefined, true) }} error={writeError || selectionError}
  >
    <input aria-label="搜索主题名" type="search" style={styles.search} value={keyword} disabled={locked}
      onChange={event => { setKeyword(event.currentTarget.value) }} />
    <div style={styles.list} aria-label="可指定主题">
      {topics.map(topic => <button type="button" key={topic.topicHierarchyKey} style={{ ...styles.topic, opacity: locked ? .45 : 1 }}
        aria-label={`指定到${topic.displayName}`} disabled={locked} onClick={() => { void assign(topic) }}
      >{topic.displayName}</button>)}
      {loading && <p role="status" style={styles.status}>主题加载中…</p>}
      {!loading && topics.length === 0 && readError === '' && <p style={styles.status}>暂无可选主题</p>}
      {readError !== '' && <p role="alert">{readError}<button type="button" disabled={locked} onClick={() => { void load(nextCursor) }}>重试</button></p>}
      {nextCursor && readError === '' && <button type="button" disabled={loading || locked} onClick={() => { void load(nextCursor) }}>加载更多主题</button>}
    </div>
    {props.source.kind === 'topic' && <button type="button" style={styles.topic} disabled={locked} onClick={() => { void assign() }}>移出主题</button>}
    {requiresRefresh && <button type="button" onClick={props.onRefresh}>刷新并重新选择</button>}
  </ArkmeConfirmDialog>
}
