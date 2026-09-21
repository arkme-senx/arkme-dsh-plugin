import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { useSyncExternalStore, type ComponentProps } from 'react'
import { ArkmeModelSelect, type ArkmeModelDirectory } from './ArkmeModelSelect.js'
import css from './arkme-model-select.css?inline'

type Projection = { getSnapshot(): unknown; subscribe(listener: () => void): () => void }
function ReadOnlyModelSeat({ projection }: { projection: Projection }) {
  const value = useSyncExternalStore(projection.subscribe, projection.getSnapshot) as { next?: { model: string; reasoningEffort?: string } } | undefined
  return <div className="arkme-model-select"><style>{css}</style><button type="button" className="arkme-model-trigger" disabled title="模型设置请在源电脑修改">
    <span>{value?.next?.model ?? '源实例默认模型'}</span>{value?.next?.reasoningEffort && <small> · {value.next.reasoningEffort}</small>}<span aria-hidden>⌄</span>
  </button></div>
}

// The public conversation.input.model slot is present on supported DSH model-selection runtimes.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.input.model': { kind: 'single'; scope: 'session'; owner: { locked: boolean } }
  }
}

function ModelSeat(props: { sessionId: SessionId } & (ComponentProps<typeof ArkmeModelSelect> | { projection: Projection })) {
  return 'projection' in props ? <ReadOnlyModelSeat key={props.sessionId} projection={props.projection} /> : <ArkmeModelSelect key={props.sessionId} {...props} />
}

// modelDirectories owns the rc2 remote.session model-catalog face. Declaring the
// same service boundary here keeps its lazy directory calls inside an injected scope.
export const inject = ['slots', 'sessions', 'remote', 'remote.session']

export function apply(ctx: ClientContext): void {
  ctx.inject(['modelDirectories'], scope => {
    const models = scope.get('modelDirectories') as {
      directoryFor(sessionId: SessionId): ArkmeModelDirectory
    } | undefined
    const sessions = scope.sessions as unknown as ISessions
    if (typeof models?.directoryFor !== 'function' || typeof sessions.subagentAddress !== 'function') return
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      priority: -100,
      inject: sessionId => sessionId.startsWith('arkme:') ? {
        projection: sessions.binding(sessionId)!.session.projections.faceOf('modelSelection'),
      } : ({
        directory: models.directoryFor(sessionId),
        available: sessions.subagentAddress!(sessionId) === undefined,
      }),
    }, ModelSeat))
  })
}
