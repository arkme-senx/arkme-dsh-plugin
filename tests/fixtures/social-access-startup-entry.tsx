// Browser component QA only. All Host responses are local fixtures; no upstream writes.
import { createRoot } from 'react-dom/client'

let allowed: boolean | null | undefined
let finish: ((allowed: boolean) => void) | undefined
const first = new Promise<boolean>(resolve => { finish = resolve })
window.fetch = async (_input, init) => {
  const { operation } = JSON.parse(String(init?.body)) as { operation: string }
  const value = operation === 'social.access'
    ? { userId: 42, allowed: allowed === undefined ? await first : allowed }
    : operation.startsWith('user.profile') ? { profile: null } : {}
  return Response.json({ ok: true, value })
}
const { ArkmeProductNavigation } = await import('../../src/client/ArkmeProductNavigation.js')
const { SocialAccessPresentationBoundary } = await import('../../src/client/SocialAccessPresentationBoundary.js')
const { arkmeAuthStore } = await import('../../src/client/auth-store.js')
const { socialAccessStore } = await import('../../src/client/social-access-store.js')
const { arkmeUi } = await import('../../src/client/ui-controller.js')
const resolve = (next: boolean) => {
  allowed = next; finish?.(next); finish = undefined; void socialAccessStore.refresh()
}
setTimeout(() => { resolve(true) }, 350)
arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
createRoot(document.getElementById('root')!).render(<>
  <header style={{ padding: 12 }}>
    <button onClick={() => { resolve(true) }}>返回已绑定</button>
    <button onClick={() => { resolve(false) }}>返回未绑定</button>
    <button onClick={() => {
      allowed = true
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
      arkmeUi.authChanged(true)
    }}>同账号绑定成功</button>
    <button onClick={() => { allowed = null; void socialAccessStore.refresh() }}>模拟刷新失败</button>
    <button onClick={() => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 }) }}>切换账号</button>
    <a href={location.pathname}>重新启动页面</a>
  </header>
  <SocialAccessPresentationBoundary><main style={{ display: 'flex', height: 600, background: '#fff' }}>
    <ArkmeProductNavigation compact={false} />
    <section style={{ padding: 24, visibility: 'visible' }}>
      <h1>个人工作区</h1><label>未发送草稿<input defaultValue="原有草稿" /></label>
    </section>
  </main></SocialAccessPresentationBoundary>
  <output id="frames" />
</>)
let frames = 0
let partialFrames = 0
function measure() {
  const root = document.querySelector('main')
  if (root) {
    frames++
    if (getComputedStyle(root).opacity !== '0' && !root.querySelector('[data-arkme-home-tour-target="contacts"]')) partialFrames++
    document.getElementById('frames')!.textContent = JSON.stringify({ frames, partialFrames })
  }
  if (frames < 120) requestAnimationFrame(measure)
}
requestAnimationFrame(measure)
