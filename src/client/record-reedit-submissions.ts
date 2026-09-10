import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeRecordReeditSubmissionView } from '../record-reedit-contract.js'
import type { ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'
import { localFileBlock } from './file-send-tasks.js'

/** Shared by display handoff and receipt acknowledgement; newer edits always win. */
export function recordReeditProjectionSettled(item: ArkmeTimelineItem, job: ArkmeRecordReeditSubmissionView): boolean {
  if (!job.result || item.itemUid !== job.itemUid) return false
  const version = item.recordVersion ?? item.version ?? 0
  return version > job.result.version || (version === job.result.version
    && (item.status !== 1 || item.mediaUnavailable !== true))
}

export function projectRecordReedit(item: ArkmeTimelineItem, jobs: readonly ArkmeRecordReeditSubmissionView[]): ArkmeTimelineItem {
  const job = jobs.find(value => value.itemUid === item.itemUid)
  const version = item.recordVersion ?? item.version ?? 0
  if (!job || item.status !== 1 || (job.result ? recordReeditProjectionSettled(item, job) : version > job.baseVersion)) return item
  const voiceBlock = job.voiceFileAssetUid
    ? [...(item.contentBlocks ?? []), ...(job.voiceBlock ? [job.voiceBlock] : [])]
      .find(block => block.kind === 'audio' && block.fileAssetUid === job.voiceFileAssetUid)
    : undefined
  return {
    ...item, title: job.title, textContent: job.textContent,
    // The candidate supplies the complete media selection, including explicit removal.
    mediaUnavailable: Boolean(job.voiceFileAssetUid && !voiceBlock),
    contentBlocks: [
      ...(voiceBlock ? [voiceBlock] : []),
      ...job.attachments.flatMap((attachment, index) => {
        const block = attachment.localFile ? localFileBlock(attachment.localFile, index)
          : (item.contentBlocks ?? []).find(value => value.fileAssetUid === attachment.asset.fileAssetUid) ?? attachment.block ?? {
          kind: 'file' as const, mediaRef: '', fileName: attachment.asset.fileName,
          mimeType: attachment.asset.mimeType, size: attachment.asset.size, sortOrder: index,
        }
        return block ? [{ ...block, sortOrder: index }] : []
      }),
    ],
  }
}

/** Activates Host recovery explicitly and hands receipts off to the canonical timeline. */
export function useRecordReeditSubmissions(
  sourceRef: string | undefined,
  accountKey: string | undefined,
  active: boolean,
  items: readonly ArkmeTimelineItem[],
  refreshCurrentWindow: () => Promise<void>,
  sourceKey: string,
) {
  const key = JSON.stringify([sourceKey, accountKey, active])
  const scope = useRef({ key, sourceRef, generation: 0, requestGeneration: 0 })
  if (scope.current.key !== key || scope.current.sourceRef !== sourceRef) scope.current = {
    key, sourceRef,
    generation: scope.current.generation + (scope.current.key === key ? 0 : 1),
    requestGeneration: scope.current.requestGeneration + 1,
  }
  const { generation, requestGeneration } = scope.current
  const revision = useRef(0)
  const resumedGeneration = useRef(-1)
  const [snapshot, setSnapshot] = useState<{ key: string; generation: number; requestGeneration: number; jobs: ArkmeRecordReeditSubmissionView[] }>({ key, generation, requestGeneration: -1, jobs: [] })
  const jobs = snapshot.key === key && snapshot.generation === generation ? snapshot.jobs : []
  const needsDiscovery = snapshot.key !== key || snapshot.generation !== generation || snapshot.requestGeneration !== requestGeneration
  const needsPolling = needsDiscovery || jobs.some(job => job.state === 'pending' || job.state === 'committing' || job.state === 'uncertain'
      || job.result && items.some(item => item.itemUid === job.itemUid))
  const refresh = useCallback(async (reconcile = false) => {
    if (!sourceRef || !accountKey || !active) return
    const started = revision.current
    if (reconcile) await callArkme('source.record-reedit.resume', { sourceRef, reconcile: true })
    const jobs = await callArkme<ArkmeRecordReeditSubmissionView[]>('source.record-reedit.submissions', { sourceRef })
    if (scope.current.requestGeneration !== requestGeneration || scope.current.generation !== generation
      || scope.current.key !== key || started !== revision.current || !Array.isArray(jobs)) return
    setSnapshot({ key, generation, requestGeneration, jobs })
  }, [sourceRef, accountKey, active, key, generation, requestGeneration])
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (resumedGeneration.current !== requestGeneration) {
        try {
          await callArkme('source.record-reedit.resume', { sourceRef })
          if (!disposed) resumedGeneration.current = requestGeneration
        } catch { /* Retry activation without hiding already available receipts. */ }
      }
      if (disposed) return
      try {
        await refresh()
      } catch { /* Retain known receipts when the read is temporarily unavailable. */ }
      if (!disposed) timer = setTimeout(() => { void poll() }, 1500)
    }
    if (active && sourceRef && accountKey && needsPolling) {
      if (needsDiscovery) void poll()
      else timer = setTimeout(() => { void poll() }, 1500)
    }
    return () => { disposed = true; clearTimeout(timer) }
  }, [refresh, active, sourceRef, accountKey, needsPolling, needsDiscovery, requestGeneration])
  const accepted = useCallback((job: ArkmeRecordReeditSubmissionView) => {
    if (scope.current.key !== key || scope.current.generation !== generation) return
    revision.current += 1
    setSnapshot(previous => ({ ...previous, key, generation, jobs: [...(previous.key === key && previous.generation === generation ? previous.jobs : []).filter(value => value.itemUid !== job.itemUid), job] }))
  }, [key, generation])
  const projectionWindow = useRef({ items, refreshCurrentWindow })
  projectionWindow.current = { items, refreshCurrentWindow }
  useEffect(() => {
    if (!active || !sourceRef || !accountKey || scope.current.key !== key || scope.current.generation !== generation) return
    const current = projectionWindow.current
    for (const job of jobs) {
      if (job.result && current.items.some(item => recordReeditProjectionSettled(item, job))) {
        void callArkme('source.record-reedit.acknowledge', {
          sourceRef, submissionId: job.submissionId, version: job.result.version,
        }).catch(() => undefined)
      }
    }
    const awaitingProjection = jobs.some(job => job.result && current.items.some(item => item.itemUid === job.itemUid
      && !recordReeditProjectionSettled(item, job)))
    if (awaitingProjection) void current.refreshCurrentWindow().catch(() => undefined)
    // Receipt polling remains the retry cadence; window reads must not trigger more reads.
  }, [jobs, sourceRef, accountKey, active, key, generation])
  return { jobs, accepted, refresh }
}
