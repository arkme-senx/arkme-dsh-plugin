import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ArkmeRecordingSpeakerCorrectionContext } from '../../types.js'
import { callArkme } from '../api.js'
import { arkmeAuthStore } from '../auth-store.js'

export function useRecordingSpeakerCorrection(itemRef: string) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const account = `${auth.auth?.environment}:${auth.auth?.userId}`
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ key: string; context?: ArkmeRecordingSpeakerCorrectionContext; error?: string; loading: boolean }>({ key: '', loading: true })
  const key = `${account}:${itemRef}`
  useEffect(() => {
    const controller = new AbortController()
    setState({ key, loading: true })
    void callArkme<ArkmeRecordingSpeakerCorrectionContext>('recordings.speaker.correction.context', { itemRef }, controller.signal)
      .then(context => { if (!controller.signal.aborted) setState({ key, context, loading: false }) })
      .catch(error => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : '纠错信息读取失败', loading: false }) })
    return () => { controller.abort() }
  }, [key, revision])
  return { ...(state.key === key ? state : { key, loading: true }), reload: () => { setRevision(value => value + 1) } }
}
