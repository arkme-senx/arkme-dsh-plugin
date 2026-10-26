import { subscribeNativeAnnotationInvalidation } from './native-annotation-invalidation.js'
import { callArkme } from './api.js'
import type { MessageMarkTransport } from './message-underline-session.js'
import type { MessageUnderlineSnapshot } from '../message-annotations.js'
import type { NativeAnnotationTarget, NativeAnnotationContext, NativeAnnotationSnapshot, NativeAnnotationCapabilities, NativeAnnotationRequest } from '../native-annotations.js'

const cloud = <T>(request: NativeAnnotationRequest, signal: AbortSignal) => callArkme<T>('native-chat.annotations', { request }, signal)
function sourceTarget(sourceRef: string, ref: string): { target: NativeAnnotationTarget; canonical: string } {
  const source = JSON.parse(sourceRef) as unknown[], value = JSON.parse(ref) as unknown[]
  const coordinate = value[3] as { eventSeq?: number; role?: string } | undefined
  if (!Array.isArray(source) || source[0] !== 'dsh-native' || typeof source[2] !== 'string' || value[0] !== sourceRef || typeof value[2] !== 'string'
    || !coordinate || !Number.isSafeInteger(coordinate.eventSeq) || !['user', 'assistant'].includes(coordinate.role ?? '')) throw Object.assign(new Error('这条消息尚未提供云标记定位，请更新来源电脑'), { code: 'CAPABILITY_UNSUPPORTED' })
  const id = source[2]
  const match = /^arkme:([^:]+):(.+)$/u.exec(id)
  return { target: { sessionRef: match ? decodeURIComponent(match[2]!) : id, ...(match ? { runtimeRef: decodeURIComponent(match[1]!) } : {}), eventSeq: coordinate.eventSeq!, role: coordinate.role as 'user' | 'assistant' }, canonical: value[2] }
}

/** One transport per mounted account/session. The existing highlight owner drives refresh. */
export function createNativeTextMarkTransport(accountScope?: string): MessageMarkTransport {
  let mode: 'local' | 'cloud' = 'local'
  const contextByRef = new Map<string, NativeAnnotationContext>()
  const known = new Map<string, NativeAnnotationSnapshot>()
  // Both owners have independent monotonic revisions. Their sum orders combined snapshots.
  const combine = (local: MessageUnderlineSnapshot, remote: NativeAnnotationSnapshot): MessageUnderlineSnapshot => ({ ...remote, revision: local.revision + remote.revision, items: [...local.items, ...remote.items] })
  const context = async (sourceRef: string, ref: string, signal: AbortSignal) => {
    const parsed = sourceTarget(sourceRef, ref)
    const cached = contextByRef.get(ref)
    if (cached) return cached
    const rows = await cloud<NativeAnnotationContext[]>({ action: 'contexts', targets: [parsed.target] }, signal)
    const value = rows[0]
    if (rows.length !== 1 || !value) throw new Error('显示正文与来源投影不一致，暂未同步此标记')
    if (contextByRef.size >= 200) contextByRef.delete(contextByRef.keys().next().value!)
    contextByRef.set(ref, value); return value
  }
  return {
    ...(accountScope ? { subscribe: (invalidate: () => void) => subscribeNativeAnnotationInvalidation(accountScope, invalidate) } : {}),
    async capabilities(sourceRef, signal) {
      try {
        const value = await cloud<NativeAnnotationCapabilities>({ action: 'capabilities' }, signal)
        if (value.supported) { mode = 'cloud'; return { supported: true, maxLength: value.maxLength, storage: 'cloud' } }
      } catch (error) {
        const code = (error as { body?: { code?: string }; code?: string }).body?.code ?? (error as { code?: string }).code ?? ''
        if (!/http-404|operation-unsupported|operation-not-found/u.test(code)) throw error
      }
      mode = 'local'
      return await callArkme('native-chat.local-mark.capabilities', { sourceRef }, signal)
    },
    async list(sourceRef, refs, signal) {
      const result: { actionRef: string; snapshot: MessageUnderlineSnapshot }[] = []
      for (let start = 0; start < refs.length; start += 40) {
        const chunk = refs.slice(start, start + 40)
        const local = await callArkme<{ actionRef: string; snapshot: MessageUnderlineSnapshot }[]>('native-chat.local-mark.list', { sourceRef, markRefs: chunk }, signal)
        if (mode === 'local') { result.push(...local); continue }
        // Source contexts are exact and bounded. A not-yet-published source is an
        // explicit failure, never a fabricated empty cloud snapshot.
        const contexts: NativeAnnotationContext[] = []
        for (const ref of chunk) {
          try { contexts.push(await context(sourceRef, ref, signal)) }
          catch (error) {
            const value = error as { body?: { code?: string }; code?: string }
            const code = value.body?.code ?? value.code ?? ''
            if (!/SOURCE_NOT_READY|source-not-ready|CAPABILITY_UNSUPPORTED/u.test(code)) throw error
            const row = local.find(item => item.actionRef === ref)
            if (row) result.push({ actionRef: ref, snapshot: { ...row.snapshot, syncNotice: '来源文字尚未同步；保留已有本机标记' } })
          }
        }
        const cloudChunk = chunk.filter(ref => !result.some(row => row.actionRef === ref))
        if (!cloudChunk.length) continue
        const messageRefs = contexts.map(c => c.messageRef)
        const complete = messageRefs.every(ref => known.has(ref))
        const values = complete
          ? await cloud<NativeAnnotationSnapshot[]>({ action: 'changes', watches: messageRefs.map(messageRef => ({ messageRef, revision: known.get(messageRef)!.revision })) }, signal)
          : await cloud<NativeAnnotationSnapshot[]>({ action: 'list', messageRefs }, signal)
        for (const value of values) {
          if (!messageRefs.includes(value.messageRef)) throw new Error('标记响应目标不一致')
          if (known.size >= 200 && !known.has(value.messageRef)) known.delete(known.keys().next().value!)
          if ((known.get(value.messageRef)?.revision ?? -1) <= value.revision) known.set(value.messageRef, value)
        }
        for (let index = 0; index < cloudChunk.length; index++) {
          const value = known.get(contexts[index]!.messageRef)
          if (!value) throw new Error('云标记快照不完整，请重试')
          result.push({ actionRef: cloudChunk[index]!, snapshot: combine(local.find(row => row.actionRef === cloudChunk[index])?.snapshot ?? { revision: 0, accessible: true, items: [] }, value) })
        }
      }
      return result
    },
    async change(sourceRef, ref, change, signal) {
      if (mode === 'local') return await callArkme('native-chat.local-mark.change', { sourceRef, markRef: ref, change }, signal)
      if (change.kind === 'remove' && change.annotationId.startsWith('local:')) {
        const local = await callArkme<MessageUnderlineSnapshot>('native-chat.local-mark.change', { sourceRef, markRef: ref, change }, signal)
        const target = contextByRef.get(ref), remote = target && known.get(target.messageRef)
        return remote ? combine(local, remote) : local
      }
      const target = await context(sourceRef, ref, signal)
      if (change.kind === 'add' && (change.anchor.sourceDigest !== target.sourceDigest || sourceTarget(sourceRef, ref).canonical !== target.canonicalText)) throw new Error('来源正文已变化，请重新选择')
      const value = await cloud<NativeAnnotationSnapshot>(change.kind === 'add'
        ? { action: 'add', messageRef: target.messageRef, operationId: change.operationId, anchor: change.anchor }
        : { action: 'remove', messageRef: target.messageRef, operationId: change.operationId, annotationId: change.annotationId }, signal)
      if (known.size >= 200 && !known.has(target.messageRef)) known.delete(known.keys().next().value!)
      if ((known.get(target.messageRef)?.revision ?? -1) <= value.revision) known.set(target.messageRef, value)
      const local = await callArkme<{ snapshot: MessageUnderlineSnapshot }[]>('native-chat.local-mark.list', { sourceRef, markRefs: [ref] }, signal)
      return combine(local[0]?.snapshot ?? { revision: 0, accessible: true, items: [] }, known.get(target.messageRef)!)
    },
  }
}
