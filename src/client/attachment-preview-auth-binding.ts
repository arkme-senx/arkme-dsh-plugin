import { arkmeAuthStore } from './auth-store.js'
import { closeAttachmentPreview } from './attachment-preview-window.js'
export function bindAttachmentPreviewAccount(): () => void {
  const scope = () => {
    const auth = arkmeAuthStore.getSnapshot().auth
    return auth?.status === 'authenticated' ? `${auth.environment}:${String(auth.userId)}` : undefined
  }
  let account = scope()
  const unsubscribe = arkmeAuthStore.subscribe(() => {
    const next = scope()
    if (next !== account) closeAttachmentPreview()
    account = next
  })
  return () => { unsubscribe(); closeAttachmentPreview() }
}
