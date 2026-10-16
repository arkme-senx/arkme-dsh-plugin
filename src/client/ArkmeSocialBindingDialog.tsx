import { useEffect, useId, useSyncExternalStore } from 'react'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeAuthStore } from './auth-store.js'
import { tr, useArkmeLocale } from './locale.js'
import { socialBindingPrompt } from './social-action-guard.js'
import { arkmeUi } from './ui-controller.js'

export function ArkmeSocialBindingDialog() {
  useArkmeLocale()
  const titleId = useId()
  const prompt = useSyncExternalStore(socialBindingPrompt.subscribe, socialBindingPrompt.getSnapshot, socialBindingPrompt.getSnapshot)
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  useEffect(() => { if (prompt && prompt.accountKey !== accountKey) socialBindingPrompt.close() }, [accountKey, prompt])
  if (!prompt || prompt.accountKey !== accountKey) return null
  return <ArkmeConfirmDialog titleId={titleId} title={tr('绑定手机号后继续')}
    description={tr('绑定手机号后即可{v0}，你仍可继续浏览', { v0: tr(prompt.action) })}
    busy={false} busyLabel={tr('去绑定')} confirmLabel={tr('去绑定')} cancelLabel={tr('暂不绑定')}
    onClose={socialBindingPrompt.close}
    onConfirm={() => { socialBindingPrompt.close(); arkmeUi.openDshSettings('arkme-account') }} />
}
