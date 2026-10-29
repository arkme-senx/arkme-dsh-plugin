import { createRoot } from 'react-dom/client'
import { registerLongArticleWindowRoot } from '../../src/client/long-article-window-root.js'
import { installArkmeRedesignStyles } from '../../src/client/redesign/styles.js'
import { arkmeAuthStore } from '../../src/client/auth-store.js'
import { bindLongArticleWindowAccount, longArticleWindowBridge, openLongArticleWindow, openBrowseWindow } from '../../src/client/long-article-window.js'
installArkmeRedesignStyles()
if (location.search.includes('arkmeLongArticle=1')) {
  // Use the production registration so sibling overlays and body portals are tested.
  registerLongArticleWindowRoot({
    effect: (setup: () => unknown) => setup(),
    slots: { register: (_options: unknown, Component: () => React.ReactNode) => {
      createRoot(document.getElementById('root')!).render(<Component />)
    } },
  } as unknown as Parameters<typeof registerLongArticleWindowRoot>[0])
} else {
  await arkmeAuthStore.refresh()
  bindLongArticleWindowAccount()
  const smokeReceipts: unknown[] = []
  longArticleWindowBridge()?.onCreated(receipt => smokeReceipts.push(receipt))
  Object.assign(window, { smokeReceipts, smokeBrowse: openBrowseWindow, smokeOpen: (article?: Parameters<typeof openLongArticleWindow>[1], composition?: Parameters<typeof openLongArticleWindow>[3]) => openLongArticleWindow({ sourceRef: 'source-A', sourceKey: 'chat:A', displayName: '产品讨论群' }, article, false, composition) })
  document.getElementById('root')!.textContent = 'Arkme · 会话 A（独立测试环境）'
}
