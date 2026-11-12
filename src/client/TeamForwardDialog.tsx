import { UnifiedForwardDialog, type UnifiedForwardAttempt } from './UnifiedForwardDialog.js'
import { forwardTargetKey, type ForwardTarget } from './unified-forward-targets.js'
import type { TeamForwardAttempt } from './team-forward-attempt.js'
import { useMemo } from 'react'

export function TeamForwardDialog({ accountKey, attempt, previewTitle, previewSubtitle, onClose, onComplete }: {
  accountKey: string; attempt: TeamForwardAttempt; previewTitle: string; previewSubtitle: string;
  onClose(): void; onComplete(targets: readonly ForwardTarget[]): void;
}) {
  const delivery = useMemo<UnifiedForwardAttempt>(() => ({
    get commentText() { return attempt.commentText },
    hasAttempt: key => attempt.hasAttempt(key),
    send: (target, comment, signal) => attempt.send(forwardTargetKey(target), target.kind === 'team'
      ? { kind: 'team', conversationRef: target.conversation.ref }
      : { kind: 'source', sourceRef: target.source.sourceRef }, comment, signal),
  }), [attempt])
  return <UnifiedForwardDialog fixed accountKey={accountKey} attempt={delivery} previewTitle={previewTitle}
    previewSubtitle={previewSubtitle} onClose={onClose} onComplete={onComplete}/>
}
