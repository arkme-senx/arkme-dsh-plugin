import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createElement, useLayoutEffect } from 'react'
import { HARNESS_ACTIVITY_ATTRIBUTE, HARNESS_ACTIVITY_EVENT, HarnessActivityTracker, type ActivityList, type PendingInteractions } from './harness-activity.js'

/** A renderless public-slot reader bridges the native iframe's actual state to the Arkme row. */
export function installHarnessActivityReporter(ctx: ClientContext, surface: Element, doc: Document = document): () => void {
  if (typeof ctx.slots.spec !== 'function') return () => {}
  const parentDoc = surface.ownerDocument
  let tracker: HarnessActivityTracker | undefined
  let latest: { list: ActivityList; archived: readonly string[]; pending: PendingInteractions | undefined } | undefined
  const notify = () => parentDoc.dispatchEvent(new parentDoc.defaultView!.Event(HARNESS_ACTIVITY_EVENT))
  const clear = () => {
    if (!surface.hasAttribute(HARNESS_ACTIVITY_ATTRIBUTE)) return
    surface.removeAttribute(HARNESS_ACTIVITY_ATTRIBUTE); notify()
  }
  const sync = () => {
    const scope = surface.getAttribute('data-arkme-account-scope')
    if (!scope || !surface.getAttribute('data-arkme-account-id')) { tracker = undefined; clear(); return }
    if (!latest) return
    if (tracker?.scope !== scope) {
      let storage: Storage | undefined
      try { storage = doc.defaultView?.localStorage } catch { /* Browser storage may be disabled. */ }
      tracker = new HarnessActivityTracker(scope, storage)
    }
    const visible = surface.getAttribute('data-arkme-visible') === 'true'
      && surface.getAttribute('data-arkme-follow-session') === 'true'
      && parentDoc.visibilityState === 'visible' && parentDoc.hasFocus()
    const value = tracker.update(latest.list, latest.archived, latest.pending, visible ? latest.list.current : undefined)
    const raw = JSON.stringify(value)
    if (surface.getAttribute(HARNESS_ACTIVITY_ATTRIBUTE) !== raw) {
      surface.setAttribute(HARNESS_ACTIVITY_ATTRIBUTE, raw); notify()
    }
  }
  function Publish(props: NonNullable<typeof latest>) {
    useLayoutEffect(() => { latest = props; sync() }, [props.list, props.archived, props.pending])
    return null
  }
  function WithPending({ usePending, ...props }: Omit<NonNullable<typeof latest>, 'pending'> & { usePending: SnapshotSelectorHook<PendingInteractions> }) {
    const pending = usePending(value => value)
    return createElement(Publish, { ...props, pending })
  }
  function Reporter({ useSessions, useWorkspaces, useSessionPendingInteraction }: PropsRuntime<'sidebar.footer.action'> & { useSessionPendingInteraction?: SnapshotSelectorHook<PendingInteractions> }) {
    const list = useSessions(value => value)
    const archived = useWorkspaces(value => value.archivedSessionIds)
    return useSessionPendingInteraction
      ? createElement(WithPending, { list, archived, usePending: useSessionPendingInteraction })
      : createElement(Publish, { list, archived, pending: undefined })
  }
  const observer = new MutationObserver(sync)
  observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-visible', 'data-arkme-follow-session', 'data-arkme-account-id', 'data-arkme-account-scope'] })
  parentDoc.addEventListener('visibilitychange', sync)
  parentDoc.defaultView?.addEventListener('focus', sync)
  parentDoc.defaultView?.addEventListener('blur', sync)
  const remove = ctx.slots.inject('sidebar.footer.action', () => {
    const spec = ctx.slots.spec('sidebar.footer.action')
    if (spec?.kind !== 'list' || spec.scope !== 'root') return () => {}
    return ctx.slots.register({ name: 'sidebar.footer.action', id: 'arkme-harness-activity', order: 100 }, Reporter)
  })
  return () => {
    remove(); observer.disconnect()
    parentDoc.removeEventListener('visibilitychange', sync)
    parentDoc.defaultView?.removeEventListener('focus', sync)
    parentDoc.defaultView?.removeEventListener('blur', sync)
    clear()
  }
}
