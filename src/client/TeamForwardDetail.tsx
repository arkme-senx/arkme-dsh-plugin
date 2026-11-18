import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TeamMessage } from '../team-app-contract.js'
import { createArkmeSdk } from '../sdk/index.js'
import { ForwardRecordsDetail } from './ArkmeNoteDetails.js'
import { teamMessagePresentation, TeamMessageMediaScope } from './TeamMessageContent.js'
import { teamText as tr } from './team-messaging-i18n.js'
import type { ArkmeSourceItem } from '../types.js'

export function TeamForwardDetail({ message, conversationRef, conversationKey, sourceBadge, onPrivateChatOpened, onClose }: {
  message: TeamMessage
  conversationRef: string
  conversationKey?: string | undefined
  sourceBadge?: ReactNode
  onPrivateChatOpened?: (source: ArkmeSourceItem) => void
  onClose(): void
}) {
  const scope = JSON.stringify([conversationKey ?? conversationRef, message.key, message.version, message.revision, message.contentStatus])
  const references = useRef({ conversationRef, messageRef: message.ref })
  references.current = { conversationRef, messageRef: message.ref }
  const [result, setResult] = useState<{ scope: string; message?: TeamMessage; error?: string }>()
  const [attempt, setAttempt] = useState(0)
  const current = result?.scope === scope ? result : undefined
  const available = message.contentStatus === 'available' && !!message.forwardRecords
  useEffect(() => {
    if (!available) return
    const controller = new AbortController()
    const { conversationRef, messageRef } = references.current
    void createArkmeSdk().preflightTeamMessages(conversationRef, [{ messageRef, version: message.version }], controller.signal)
      .then(([row]) => {
        if (row?.state !== 'published' || row.contentStatus !== 'available' || !row.forwardRecords || row.key !== message.key || row.version !== message.version) throw new Error(tr('内容当前不可用'))
        if (!controller.signal.aborted) setResult({ scope, message: row })
      }).catch(reason => {
        if (!controller.signal.aborted) setResult({ scope, error: reason instanceof Error ? reason.message : tr('加载失败') })
      })
    return () => controller.abort()
  }, [available, message.key, message.version, scope, attempt])
  const confirmed = available ? current?.message : undefined
  // Summary-only cards keep their timeline preview until the complete drawer can open.
  if (available && !current && !message.forwardRecords?.items.length) return null
  const preview = available && !current?.error ? confirmed ?? message : undefined
  const item = preview ? teamMessagePresentation(preview) : {
    ...teamMessagePresentation(message),
    forwardRecords: { title: tr('转发快记'), items: [], summaryLines: [], createdAtMillis: message.createdAt },
  }
  const pending = !confirmed && !current?.error && (available || message.contentStatus === 'revalidating')
  const readStatus = confirmed || pending ? undefined
    : <p role="alert">{current?.error || tr('内容当前不可用')} {available &&
      <button type="button" onClick={() => setAttempt(value => value + 1)}>{tr('重试')}</button>}</p>
  return <TeamMessageMediaScope message={confirmed ?? message} conversationRef={conversationRef} conversationKey={conversationKey}>
    <ForwardRecordsDetail item={item} onClose={onClose} sourceBadge={sourceBadge} readStatus={readStatus} pending={pending}
      onPrivateChatOpened={onPrivateChatOpened} />
  </TeamMessageMediaScope>
}
