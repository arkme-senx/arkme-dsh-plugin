import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ARKME_NATIVE_SELECTION_CLIENT_ID } from '../harness-embed-contract.js'

/** Called after native readiness. This resource is deliberately absent from the boot graph. */
export function loadNativeSelection(ctx: ClientContext, doc: Document, url: string): () => void {
  const modules = (ctx as unknown as { modules?: { import(id: string): Promise<unknown> } }).modules
  if (typeof modules?.import !== 'function') return () => {}
  let stopped = false
  let restore: (() => void) | undefined
  const script = doc.createElement('script')
  script.src = url
  script.async = true
  const failed = () => {
    script.remove()
    console.warn('Arkme native selection unavailable; native chat remains active.')
  }
  script.onerror = failed
  script.onload = () => {
    void modules.import(ARKME_NATIVE_SELECTION_CLIENT_ID).then(value => {
      if (stopped) return
      const module = value as { install?: (ctx: ClientContext, doc: Document) => () => void }
      if (typeof module?.install !== 'function') throw new Error('Missing native selection entry')
      restore = module.install(ctx, doc)
    }).catch(() => { if (!stopped) failed() })
  }
  doc.head.append(script)
  return () => {
    if (stopped) return
    stopped = true
    script.onload = null
    script.onerror = null
    script.remove()
    restore?.()
  }
}
