import { createRoot } from 'react-dom/client'
import { ArkmeLongArticleWindow } from '../../src/client/ArkmeLongArticleWindow.js'
import { installArkmeRedesignStyles } from '../../src/client/redesign/styles.js'
import { arkmeAuthStore } from '../../src/client/auth-store.js'
import { bindLongArticleWindowAccount, openLongArticleWindow } from '../../src/client/long-article-window.js'
installArkmeRedesignStyles()
if (location.search.includes('arkmeLongArticle=1')) {
  createRoot(document.getElementById('root')!).render(<ArkmeLongArticleWindow />)
} else {
  await arkmeAuthStore.refresh()
  bindLongArticleWindowAccount()
  Object.assign(window, { smokeOpen: (article?: Parameters<typeof openLongArticleWindow>[1]) => openLongArticleWindow({ sourceRef: 'source-A', sourceKey: 'chat:A', displayName: '产品讨论群' }, article) })
  document.getElementById('root')!.textContent = 'Arkme · 会话 A（独立测试环境）'
}
