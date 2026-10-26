import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeLongArticleDialog } from './ArkmeLongArticleDialog.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arkmeUi } from './ui-controller.js'
import { tr } from './locale.js'

/** A global entry never inherits the currently selected chat's send target. */
export function ArkmeNewLongArticleDialog({ accountKey, onClose }: { accountKey: string; onClose(): void }) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const currentAccount = auth.auth?.status === 'authenticated' ? `${auth.auth.environment}:${auth.auth.userId}` : ''
  const initialAccount = useRef(accountKey), close = useRef(onClose); close.current = onClose
  const [target, setTarget] = useState<ArkmeSourceItem>(), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const sameAccount = currentAccount === initialAccount.current && accountKey === initialAccount.current
  useEffect(() => { if (!sameAccount) close.current() }, [sameAccount])
  useEffect(() => {
    if (!sameAccount) return
    const controller = new AbortController()
    setError('')
    void withArkmeReadDeadline(signal => callArkme<ArkmeSourceItem>('sources.self-target', {}, signal), controller.signal)
      .then(value => {
        const current = arkmeAuthStore.getSnapshot().auth
        if (controller.signal.aborted || `${current?.environment}:${current?.userId}` !== initialAccount.current) return
        if (value.kind !== 'send_to_self' || !value.sourceRef) throw new Error('暂时无法读取发给自己，请重试')
        setTarget(value)
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法添加长文，请重试') })
    return () => controller.abort()
  }, [sameAccount, attempt])
  if (!sameAccount) return null
  if (target) return <ArkmeLongArticleDialog sourceRef={target.sourceRef} overlayZIndex={10060} onClose={onClose}
    onCreated={() => arkmeUi.recordChanged()} onUpdated={() => arkmeUi.recordChanged()} />
  return <ArkmeConfirmDialog titleId="arkme-new-long-article-title" title={tr('添加长文')}
    description={<span role="status">{tr(error ? '长文将保存到发给自己。' : '正在准备长文…')}</span>}
    busy={!error} closeWhileBusy cancelLabel={tr('关闭')} confirmLabel={tr('重试')} busyLabel={tr('准备中…')}
    error={error} onClose={onClose} onConfirm={() => setAttempt(value => value + 1)} />
}
