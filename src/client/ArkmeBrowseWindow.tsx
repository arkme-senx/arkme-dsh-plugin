import { useEffect } from 'react'
import { ArkmeLocationDialog } from './ArkmeLocationDialog.js'
import { ArkmeLongArticleLibraryDialog } from './ArkmeLongArticleLibraryDialog.js'
import { longArticleWindowBridge, type LongArticleWindowTarget } from './long-article-window.js'

/** Reuses the plugin's browser surfaces in a dedicated, account-bound renderer. */
export function ArkmeBrowseWindow({ target, invalidated }: { target: LongArticleWindowTarget; invalidated: boolean }) {
  const bridge = longArticleWindowBridge()
  const close = () => { void bridge?.close() }
  useEffect(() => bridge?.onClose(close), [bridge])
  useEffect(() => { if (invalidated) close() }, [invalidated])
  if (invalidated) return null
  return <>{target.surface === 'library'
    ? <ArkmeLongArticleLibraryDialog standalone onClose={close} />
    : <ArkmeLocationDialog key={JSON.stringify(target.location)} standalone {...target.location} onClose={close}
      onOpenConversation={async item => {
        if (!item.targetSource || !await bridge?.navigate?.({ source: item.targetSource, recordUid: item.recordUid,
          sendAtMillis: item.sendAtMillis, ...(item.recordOwnerUserId !== undefined ? { recordOwnerUserId: item.recordOwnerUserId } : {}) })) throw new Error('无法定位原会话，请重试')
      }} />}</>
}
