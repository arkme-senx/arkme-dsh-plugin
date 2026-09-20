import { useEffect, useMemo, useState } from 'react'
import { ArkmeLongArticleDialog, ArkmeLongArticleSnapshotDialog } from './ArkmeLongArticleDialog.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { longArticleAccountKey, longArticleWindowBridge, type LongArticleWindowTarget } from './long-article-window.js'
import { tr, useArkmeLocale } from './locale.js'

export function ArkmeLongArticleWindow() {
  useArkmeLocale()
  const bridge = longArticleWindowBridge()
  const [target, setTarget] = useState<LongArticleWindowTarget>()
  const [error, setError] = useState('')
  const [invalidated, setInvalidated] = useState(false)
  useEffect(() => {
    if (!bridge) { setError('当前客户端不支持独立长文窗口'); return }
    let active = true
    const invalidate = () => { if (active) setInvalidated(true) }
    const stop = bridge.onInvalidated(invalidate)
    void (async () => {
      const context = await bridge.context()
      if (!context) throw new Error('长文窗口已失效，请关闭后重新打开')
      await arkmeAuthStore.refresh()
      if (!await bridge.active() || longArticleAccountKey() !== context.accountKey) throw new Error('账号已切换，请关闭后重新打开长文')
      if (active) setTarget(context)
    })().catch(caught => { if (active) setError(caught instanceof Error ? caught.message : '长文加载失败') })
    // Catch expiry and account changes even when the main window is hidden.
    const timer = setInterval(() => {
      void Promise.all([bridge.active(), arkmeAuthStore.refresh()]).then(([valid]) => {
        if (!valid) invalidate()
      }).catch(() => {})
    }, 3000)
    return () => { active = false; stop(); clearInterval(timer) }
  }, [bridge])
  const mode = useMemo(() => ({
    displayName: target?.displayName ?? '', invalidated, editOnOpen: target?.article?.mode === 'existing',
    verifyAccount: async () => {
      if (!bridge || !target || invalidated || !await bridge.active()) throw new Error('账号已切换，请关闭后重新打开长文')
      await arkmeAuthStore.refresh()
      if (longArticleAccountKey() !== target.accountKey || !await bridge.active()) throw new Error('账号已切换，请关闭后重新打开长文')
    },
    subscribeClose: (listener: () => void) => bridge?.onClose(listener) ?? (() => {}),
    cancelClose: () => { void bridge?.cancelClose() },
  }), [bridge, target, invalidated])
  useEffect(() => {
    if ((!target || target.article?.mode === 'snapshot') && bridge) return bridge.onClose(() => { void bridge.close() })
  }, [bridge, target])
  useEffect(() => { document.title = `${tr(target?.article ? '长文' : '写长文')} · ${target?.displayName ?? 'Arkme'}` }, [target])
  if (!target) return <div style={{ position: 'fixed', inset: 0, display: 'grid', placeContent: 'center', gap: 16, background: theme.base, color: theme.text }}>
    <div role={error ? 'alert' : 'status'}>{error || tr('正在加载长文…')}</div>
    {error && <button onClick={() => { void bridge?.close() }}>{tr('关闭')}</button>}
  </div>
  if (target.article?.mode === 'snapshot') return <ArkmeLongArticleSnapshotDialog standalone item={target.article.item} onClose={() => { void bridge?.close() }} />
  return <ArkmeLongArticleDialog sourceRef={target.sourceRef} windowMode={mode} {...(target.article ? { item: target.article.item } : {})}
    onUpdated={async detail => { if (!await bridge?.published({ ...target.article!.item, ...detail, recordVersion: detail.version })) throw new Error('更新回执同步失败，请重新打开长文核对') }}
    onCreated={async item => { await bridge?.published(item) }} onClose={() => { void bridge?.close() }} />
}
