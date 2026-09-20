import { tr, useArkmeLocale } from './locale.js'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ArkmeEnvironment, ArkmeSourceItem } from '../types.js'
import type { ArkmeRecordTopicAssignmentResult } from '../record-topic-assignment-contract.js'
import { ArkmeSourceBreadcrumb } from './ArkmeSourceBreadcrumb.js'
import { ArkmeTopicCreateDialog } from './ArkmeTopicCreateDialog.js'
import { arkmeTheme } from './arkme-theme.js'
import { recordTopicAssignmentPort, type RecordTopicAssignmentPort } from './record-topic-assignment-port.js'
import { selfTopicDirectory, type SelfTopicDirectoryCache } from './self-topic-directory-cache.js'

export function ArkmeRecordTopicAssignmentDialog(props: {
  userId: number
  environment: ArkmeEnvironment
  anchor?: HTMLElement | undefined
  source: ArkmeSourceItem
  assignmentRefs: readonly string[]
  currentTopicKey?: string
  port?: RecordTopicAssignmentPort
  directory?: SelfTopicDirectoryCache
  onCancel(): void
  onRefresh(): void
  onAssigned(result: ArkmeRecordTopicAssignmentResult, target?: ArkmeSourceItem): void
}) {
  useArkmeLocale()
  const port = props.port ?? recordTopicAssignmentPort
  const directory = useMemo(() => props.directory ?? selfTopicDirectory(props.userId, props.environment), [props.directory, props.userId, props.environment])
  const snapshot = useSyncExternalStore(directory.subscribe, directory.getSnapshot, directory.getSnapshot)
  const [writeError, setWriteError] = useState('')
  const [selectionNotice, setSelectionNotice] = useState('')
  const [pending, setPending] = useState(false)
  const [pendingLabel, setPendingLabel] = useState('正在指定主题…')
  const [createOpen, setCreateOpen] = useState(false)
  const writeRef = useRef<AbortController>()
  const mounted = useRef(true)
  const requiresRefresh = writeError !== ''
  const selectionError = props.assignmentRefs.length < 1 || props.assignmentRefs.length > 100 ? '请选择 1 至 100 条快记' : ''
  const locked = pending || requiresRefresh || selectionError !== ''

  useEffect(() => { void directory.ensure() }, [directory])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; writeRef.current?.abort() }
  }, [])

  const assign = async (target?: ArkmeSourceItem, createTitle?: string) => {
    if (writeRef.current || requiresRefresh || selectionError !== '') return
    if (createTitle === undefined && target?.topicHierarchyKey && target.topicHierarchyKey === props.currentTopicKey) {
      setSelectionNotice('已在当前主题中！')
      return
    }
    setSelectionNotice('')
    const controller = new AbortController()
    writeRef.current = controller
    setPending(true)
    setPendingLabel(createTitle !== undefined ? '正在创建主题…' : target ? '正在指定主题…' : '正在移出主题…')
    let created: ArkmeSourceItem | undefined
    let result: ArkmeRecordTopicAssignmentResult
    try {
      if (createTitle !== undefined) {
        created = await port.createTopic(createTitle, props.source.sourceRef, controller.signal)
        if (controller.signal.aborted || !mounted.current) return
        directory.upsert(created)
        target = created
        setCreateOpen(false)
        setPendingLabel('正在指定主题…')
      }
      result = await port.assign({ sourceRef: props.source.sourceRef, assignmentRefs: props.assignmentRefs,
        ...(target === undefined ? {} : { targetSourceRef: target.sourceRef }),
      }, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        setCreateOpen(false)
        setWriteError(`${created ? `主题「${created.displayName}」已创建。` : ''}${error instanceof Error ? error.message : '操作未完成'}。请刷新核对归属后重新选择。`)
      }
      return
    } finally {
      // Counts and membership must come from acknowledged server projections, even after an unknown outcome.
      directory.invalidate()
      if (!controller.signal.aborted && mounted.current) setPending(false)
      if (writeRef.current === controller) writeRef.current = undefined
    }
    if (!controller.signal.aborted && mounted.current) props.onAssigned(result, target)
  }
  const cancel = () => { if (!writeRef.current) props.onCancel() }
  const statusStyle = { margin: '6px 4px', fontSize: 12, color: arkmeTheme.secondary }
  return <>
    <ArkmeSourceBreadcrumb
      userId={props.userId} environment={props.environment} trigger="none"
      sources={snapshot.sources} selectedSource={snapshot.sources.find(source => source.topicHierarchyKey !== undefined && source.topicHierarchyKey === props.currentTopicKey)}
      loading={snapshot.loading || (!snapshot.complete && !snapshot.error)} countsReady={snapshot.complete}
      {...(snapshot.error ? { error: snapshot.error } : {})}
      onSelect={target => { void assign(target) }} onSelectAggregate={() => {}}
      onRetry={() => { void directory.ensure(true) }}
      onCreateTopic={() => { if (!locked) setCreateOpen(true) }}
      assignment={{ anchor: props.anchor, count: props.assignmentRefs.length, disabled: locked, busy: pending,
        hidden: createOpen, onClose: cancel,
        onRelease: props.source.kind === 'topic' ? () => { void assign() } : undefined,
        status: <>
          {(writeError || selectionError) && <p role="alert" style={{ ...statusStyle, color: arkmeTheme.danger }}>{writeError || selectionError}</p>}
          {selectionNotice && <p role="status" style={statusStyle}>{selectionNotice}</p>}
          {pending && <p role="status" style={statusStyle}>{pendingLabel}</p>}
          {requiresRefresh && <button data-arkme-feedback="neutral" type="button" onClick={props.onRefresh}>{tr("刷新并重新选择")}</button>}
        </>,
      }}
    />
    {createOpen && <ArkmeTopicCreateDialog mode="topic" submitting={pending}
      onCancel={() => { if (!writeRef.current) setCreateOpen(false) }}
      onConfirm={title => { void assign(undefined, title) }} />}
  </>
}
