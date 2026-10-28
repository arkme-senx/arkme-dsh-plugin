import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Export } from '@phosphor-icons/react/dist/icons/Export'
import { LinkSimple } from '@phosphor-icons/react/dist/icons/LinkSimple'
import { PaperPlaneTilt } from '@phosphor-icons/react/dist/icons/PaperPlaneTilt'
import { SpinnerGap } from '@phosphor-icons/react/dist/icons/SpinnerGap'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArkmeSourceSendResult, ArkmeWorldFeedItem, ArkmeWorldShareResult } from '../types.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { copyText } from './clipboard-text.js'
import { openLocalSnapshotForward } from './local-snapshot-forward.js'
import { nativeForwardDelivery } from './native-forward-entry.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'

export function ArkmeWorldShareActions({ item }: { item: ArkmeWorldFeedItem }) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; sequence: number }>()
  const request = useRef<AbortController>(), anchor = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    setOpen(false); setBusy(false); setNotice(undefined)
    return () => { request.current?.abort(); request.current = undefined }
  }, [scope, item.recordRef])
  const act = async (action: 'copy' | 'forward') => {
    if (request.current) return
    setOpen(false)
    if (auth?.status !== 'authenticated' || !auth.userId) { setNotice(value => ({ text: tr('请先登录后分享'), sequence: (value?.sequence ?? 0) + 1 })); return }
    const userId = auth.userId, environment = auth.environment
    const controller = new AbortController(); request.current = controller; setBusy(true)
    const timeout = setTimeout(() => controller.abort(), 20_000)
    const isCurrent = () => {
      const current = arkmeAuthStore.getSnapshot().auth
      return !controller.signal.aborted && request.current === controller && current?.status === 'authenticated' && current.userId === userId && current.environment === environment
    }
    try {
      const share = await callArkme<ArkmeWorldShareResult>('world.share', { recordRef: item.recordRef, expectedUserId: userId }, controller.signal)
      if (!isCurrent()) return
      if (action === 'copy') {
        await copyText(share.url)
        if (isCurrent()) setNotice(value => ({ text: tr('已复制链接'), sequence: (value?.sequence ?? 0) + 1 }))
      } else {
        clearTimeout(timeout)
        const result = await openLocalSnapshotForward({ userId, preview: { title: share.title, subtitle: share.previewText },
          delivery: nativeForwardDelivery((target, identity, commentText, signal) => callArkme<ArkmeSourceSendResult>('world.forward', {
            recordRef: item.recordRef, expectedUserId: userId, targetSourceRef: target.sourceRef, recordUid: identity.recordUid, commentText,
          }, signal)),
        }, controller.signal)
        if (result.completed && isCurrent()) setNotice(value => ({ text: tr('已转发'), sequence: (value?.sequence ?? 0) + 1 }))
      }
    } catch (error) {
      if (request.current === controller && scope === `${arkmeAuthStore.getSnapshot().auth?.environment}:${arkmeAuthStore.getSnapshot().auth?.userId}`) {
        setNotice(value => ({ text: controller.signal.aborted ? tr('分享超时，请重试') : error instanceof Error ? error.message : tr('分享失败，请重试'), sequence: (value?.sequence ?? 0) + 1 }))
      }
    } finally { clearTimeout(timeout); if (request.current === controller) { request.current = undefined; setBusy(false) } }
  }
  return <div style={{ marginLeft: 'auto' }}>
    <ArkmeActionMenu open={open} label={tr('分享动态')} align="end" onClose={() => setOpen(false)} actions={[
      { id: 'copy', label: tr('复制链接'), icon: <LinkSimple size={18} />, onSelect: () => { void act('copy') } },
      { id: 'forward', label: tr('转发'), icon: <PaperPlaneTilt size={18} />, onSelect: () => { void act('forward') } },
    ]} anchor={<button ref={anchor} type="button" aria-label={tr('分享')} title={tr('分享')} aria-haspopup="menu" aria-expanded={open} disabled={busy}
      data-arkme-feedback="neutral" onClick={() => setOpen(value => !value)} style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: c.secondary, cursor: busy ? 'default' : 'pointer' }}>
      {busy ? <SpinnerGap className="arkme-icon-spin" size={18} /> : <Export size={18} weight="light" />}
    </button>} />
    {notice && (typeof document === 'undefined' ? <span role="status">{notice.text}</span> : <Toast key={notice.sequence} text={notice.text} anchor={anchor.current} onDone={() => setNotice(undefined)} />)}
  </div>
}
