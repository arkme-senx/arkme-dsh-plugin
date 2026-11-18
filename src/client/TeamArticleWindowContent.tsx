import { useEffect, useState } from 'react'
import { ArkmeLongArticleSnapshotDialog } from './ArkmeLongArticleDialog.js'
import type { LongArticleWindowTarget } from './long-article-window.js'
import type { ArkmeMediaReadState } from './media-access.js'
import type { TeamMessage } from '../team-app-contract.js'
import { watchTeamSourceRead } from './team-source-read.js'
import { TeamMessageMediaScope, teamMessagePresentation } from './TeamMessageContent.js'
import { tr } from './locale.js'

type Article = NonNullable<NonNullable<LongArticleWindowTarget['article']>['teamRead']>

export function TeamArticleWindowContent({ target, article, windowMode, onClose }: {
  target: LongArticleWindowTarget
  article: Article
  windowMode: NonNullable<Parameters<typeof ArkmeLongArticleSnapshotDialog>[0]['windowMode']>
  onClose(): void
}) {
  const messageKey = target.article?.item.itemUid
  const scope = JSON.stringify([target.accountKey, target.sourceRef, messageKey, article.messageRef, article.version])
  const [result, setResult] = useState<{ scope: string; message: TeamMessage }>()
  const [status, setStatus] = useState<ArkmeMediaReadState>({ status: 'checking' })
  const valid = !!messageKey && typeof article.messageRef === 'string' && !!article.messageRef
    && typeof article.conversationKey === 'string' && !!article.conversationKey && Number.isSafeInteger(article.version) && article.version > 0
  const readable = valid && !windowMode.invalidated && status.status === 'available' && result?.scope === scope
  useEffect(() => {
    if (windowMode.invalidated || !valid || !messageKey) return
    return watchTeamSourceRead({ accountKey: target.accountKey, conversationRef: target.sourceRef,
      conversationKey: article.conversationKey, messageRef: article.messageRef, messageKey, version: article.version },
    state => { if (state.status !== 'available') setResult(undefined); setStatus(state) },
    message => setResult({ scope, message }))
  }, [windowMode.invalidated, scope, messageKey, target.accountKey, target.sourceRef, article.conversationKey, article.messageRef, article.version, valid])
  useEffect(() => { if (!readable) return windowMode.subscribeClose(onClose) }, [readable, windowMode, onClose])
  if (readable && result) {
    return <TeamMessageMediaScope message={result.message} conversationRef={target.sourceRef} conversationKey={article.conversationKey}>
      <ArkmeLongArticleSnapshotDialog item={teamMessagePresentation(result.message)} standalone articleLabel={tr('长文详情')} windowMode={windowMode} onClose={onClose} />
    </TeamMessageMediaScope>
  }
  return <div style={{ padding: 24 }}>
    <p role={valid && status.status === 'checking' && !windowMode.invalidated ? 'status' : 'alert'}>
      {valid && status.status === 'checking' && !windowMode.invalidated ? tr('正在加载长文…') : tr('内容当前不可用')}
    </p>
    {status.status === 'unavailable' && !windowMode.invalidated && <button type="button" onClick={status.retry}>{tr('重试')}</button>}
    <button type="button" onClick={onClose}>{tr('关闭')}</button>
  </div>
}
