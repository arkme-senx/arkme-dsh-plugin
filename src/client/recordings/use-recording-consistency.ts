import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ArkmeRecordingSpeakerConsistency, ArkmeRecordingSpeakerConsistencyGroup } from '../../types.js'
import { callArkme } from '../api.js'
import { arkmeAuthStore } from '../auth-store.js'

export function recordingConsistencyLabel(group?: ArkmeRecordingSpeakerConsistencyGroup, error?: string) {
  if (error) return '读取失败'
  if (!group) return '待计算'
  if (group.state === 'insufficient') return '证据不足'
  if (group.state === 'building') return '计算中'
  return `${group.score?.toFixed(0) ?? '待计算'}${group.state === 'partial' ? '（局部）' : ''}`
}

/** One bounded request per batch, never one request for every transcript row. */
export function useRecordingConsistency(anchorRefs: readonly string[], itemRefs: readonly string[] = []) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const key = JSON.stringify([auth.auth?.environment, auth.auth?.userId, anchorRefs, itemRefs])
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ key: string; groups: ArkmeRecordingSpeakerConsistencyGroup[]; loading: boolean; supported?: boolean; error?: string }>({ key: '', groups: [], loading: false })
  useEffect(() => {
    const controller = new AbortController()
    if (!anchorRefs.length || auth.auth?.status !== 'authenticated') { setState({ key, groups: [], loading: false }); return () => controller.abort() }
    setState({ key, groups: [], loading: true })
    void (async () => {
      const groups: ArkmeRecordingSpeakerConsistencyGroup[] = []
      for (let offset = 0; offset < anchorRefs.length; offset += 100) {
        const result = await callArkme<ArkmeRecordingSpeakerConsistency>('recordings.speaker.consistency', { anchorRefs: anchorRefs.slice(offset, offset + 100), itemRefs }, controller.signal)
        if (controller.signal.aborted) return
        if (!result.supported) { setState({ key, groups: [], loading: false, supported: false }); return }
        groups.push(...result.groups)
      }
      if (!controller.signal.aborted) setState({ key, groups, loading: false, supported: true })
    })().catch(error => { if (!controller.signal.aborted) setState({ key, groups: [], loading: false, error: error instanceof Error ? error.message : '一致性读取失败' }) })
    return () => controller.abort()
  }, [key, revision, auth.auth?.status])
  return { ...(state.key === key ? state : { key, groups: [], loading: true }), reload: () => setRevision(value => value + 1) }
}
