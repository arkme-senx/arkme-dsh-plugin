import { useEffect, useRef, useState } from 'react'
import type { ArkmeTeam } from '../types.js'
import { PublishDialog } from './ArkmeWorldSurface.js'
import { registerWorldPublish, takeWorldPublishTeam, type WorldPublishRequest } from './world-publish-entry.js'
export function useWorldPublishHost({ accountKey, navigationKey, actorName, actorAvatarRef, onPublished }: {
  accountKey: string | undefined; navigationKey: string; actorName?: string | undefined; actorAvatarRef?: string | undefined; onPublished(message: string): void
}) {
  const scope = `${accountKey}:${navigationKey}`
  const [request, setRequest] = useState<{ scope: string; content: WorldPublishRequest; team?: ArkmeTeam | undefined }>()
  const stop = useRef<() => void>()
  useEffect(() => {
    setRequest(undefined)
    const off = registerWorldPublish((content, signal) => {
      signal?.throwIfAborted()
      if (!accountKey || accountKey !== content.accountKey) throw new Error('账号已变化，请重新打开发布窗口')
      stop.current?.()
      const abort = () => setRequest(undefined)
      signal?.addEventListener('abort', abort, { once: true })
      stop.current = () => signal?.removeEventListener('abort', abort)
      setRequest({ scope, content, team: takeWorldPublishTeam(accountKey) })
    })
    return () => { off(); stop.current?.(); stop.current = undefined }
  }, [accountKey, scope])
  return request?.scope === scope ? <PublishDialog key={`${scope}:${request.content.origin.sourceRef}:${request.content.origin.itemUid}`}
    origin={request.content.origin} initialTeam={request.team} actorName={actorName} actorAvatarRef={actorAvatarRef}
    onClose={() => { stop.current?.(); setRequest(undefined) }} onPublished={result => { stop.current?.(); setRequest(undefined); onPublished(result.visibility === 'pending_review' ? '已提交审核' : '已发布到世界') }} /> : null
}
