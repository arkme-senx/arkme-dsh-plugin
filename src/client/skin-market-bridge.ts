import { publishQQ2006HarnessSkin } from './qq2006-harness-skin.js'

interface SkinMarketRuntimeState {
  skins?: Array<{
    skinId?: string
    installation?: string
    activation?: string
    primary?: boolean
  }>
}

const QQ2006_SKIN_ID = 'laplaceyoung.dsh-qq2006'
const QQ2006_SELECTED_ACTIVATIONS = new Set(['active', 'restart-required'])

export function installArkmeSkinMarketBridge(
  documentRef: Document = document,
  fetchRef: typeof fetch = fetch,
): () => void {
  let disposed = false
  let applied = false
  const sync = async () => {
    try {
      const response = await fetchRef('/dsh-skin-market/state', { cache: 'no-store' })
      if (!response.ok) return
      const state = await response.json() as SkinMarketRuntimeState
      if (disposed) return
      const qq2006Selected = state.skins?.some(skin => skin.skinId === QQ2006_SKIN_ID
        && skin.installation === 'installed'
        && skin.primary === true
        && QQ2006_SELECTED_ACTIVATIONS.has(skin.activation ?? '')) === true
      const body = documentRef.body
      if (qq2006Selected) {
        body.dataset.arkmeSkin = 'qq2006'
        applied = true
      } else if (applied && body.dataset.arkmeSkin === 'qq2006') {
        delete body.dataset.arkmeSkin
        applied = false
      }
      publishQQ2006HarnessSkin(qq2006Selected)
    } catch {
      // The marketplace is optional; Arkme keeps its default theme when unavailable.
    }
  }
  void sync()
  const timer = window.setInterval(() => { void sync() }, 5_000)
  return () => {
    disposed = true
    window.clearInterval(timer)
    if (applied && documentRef.body.dataset.arkmeSkin === 'qq2006') delete documentRef.body.dataset.arkmeSkin
    publishQQ2006HarnessSkin(false)
  }
}
