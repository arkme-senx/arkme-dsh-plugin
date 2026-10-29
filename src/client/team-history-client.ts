import { useCallback, useEffect, useRef, useState } from 'react'
import type { TeamHistoryAction, TeamHistoryOptions, TeamHistoryResponse } from '../team-history-contract.js'
import type { TeamIdentity, TeamMessage } from '../team-app-contract.js'
import { callArkme } from './api.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'

export function historyCall(conversationRef: string, accountKey: string, action: TeamHistoryAction, options: TeamHistoryOptions, signal: AbortSignal) {
  return callArkme<TeamHistoryResponse>('team.app.history', { conversationRef, expectedAccountKey: accountKey, action, options }, signal)
}
export function waitHistoryPoll(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1500)
    signal.addEventListener('abort', abort, { once: true })
  })
}
/** Technical progress only; a ready manifest still needs the chosen verified read. */
export async function prepareHistory(conversationRef: string, accountKey: string, action: TeamHistoryAction, options: TeamHistoryOptions, signal: AbortSignal, onProgress?: (result: TeamHistoryResponse) => void): Promise<TeamHistoryResponse> {
  let result = await historyCall(conversationRef, accountKey, action, options, signal)
  for (;;) {
    signal.throwIfAborted()
    onProgress?.(result)
    if (result.state === 'ready') return result
    if (result.state === 'failed' || result.state === 'cancelled') throw new Error(result.reason || '历史处理未完成，请重试')
    await waitHistoryPoll(signal)
    result = await historyCall(conversationRef, accountKey, result.resultRef ? (action.startsWith('exports/') ? 'exports/state' : 'analysis/state') : action, { ...options, ...(result.resultRef ? { resultRef: result.resultRef } : {}) }, signal)
  }
}
export const historyTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
export function localDateWindow(from: string, through: string) {
  const date = (v: string) => { const [y, m, d] = v.split('-').map(Number); return new Date(y!, m! - 1, d!) }
  const start = from ? date(from) : undefined, end = through ? date(through) : undefined
  if (end) end.setDate(end.getDate() + 1)
  return { ...(start ? { fromAt: start.getTime() } : {}), ...(end ? { untilAt: end.getTime() } : {}), timezone: historyTimezone() }
}
export function historyMonthWindow(month: string): TeamHistoryOptions {
  if (!month) return { timezone: historyTimezone() }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) throw new Error('分析月份无效')
  const [year, value] = month.split('-').map(Number)
  if (!year) throw new Error('分析月份无效')
  const boundary = (monthIndex: number) => {
    const date = new Date(0)
    date.setFullYear(year!, monthIndex, 1)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  return { fromAt: boundary(value! - 1), untilAt: boundary(value!), timezone: historyTimezone() }
}

type PageState = { key: string; page?: TeamHistoryResponse; loading: boolean; error: string; windowed: boolean }
/** A bounded cursor stream. The full presentation uses the existing authorized
 * batch-get only for the visible page; it never resumes a timeline body scan. */
export function useTeamHistoryPage(conversationRef: string, accountKey: string, action: TeamHistoryAction, options: TeamHistoryOptions, enabled = true, scopeKey = conversationRef, optionsKey?: string, presentation: 'preview' | 'full' = 'preview') {
  const [revision, setRevision] = useState(0), [state, setState] = useState<PageState>({ key: '', loading: false, error: '', windowed: false })
  const active = useRef<AbortController>(), value = useRef<PageState>(), busy = useRef(false)
  const signature = optionsKey ?? JSON.stringify(options)
  const key = JSON.stringify([scopeKey, accountKey, action, signature, revision, presentation])
  const current = useRef({ options, conversationRef }); current.current = { options, conversationRef }
  const load = useCallback(async (more = false) => {
    if (!enabled || more && busy.current) return
    const previous = value.current?.key === key ? value.current : undefined
    if (more && !previous?.page?.hasMore) return
    if (!more) active.current?.abort()
    const controller = more ? active.current : new AbortController()
    if (!controller || controller.signal.aborted) return
    active.current = controller; busy.current = true
    const start: PageState = { key, ...(more && previous?.page ? { page: previous.page } : {}), loading: true, error: '', windowed: more && previous?.windowed === true }
    value.current = start; setState(start)
    try {
      const requestOptions = { ...current.current.options, ...(more && previous?.page?.cursor ? { cursor: previous.page.cursor } : {}) }
      let next = await historyCall(current.current.conversationRef, accountKey, action, requestOptions, controller.signal)
      controller.signal.throwIfAborted()
      while (next.state === 'index_preparing') {
        setState({ ...start, page: next }); await waitHistoryPoll(controller.signal)
        next = await historyCall(current.current.conversationRef, accountKey, action, requestOptions, controller.signal)
        controller.signal.throwIfAborted()
      }
      if (next.state !== 'ready') throw new Error(next.reason || '历史数据尚未就绪')
      if (next.hasMore && (!next.cursor || more && next.cursor === previous?.page?.cursor)) throw new Error('历史分页异常，请重新查询')
      if (presentation === 'full' && next.messages.length) {
        const messages = await callArkme<TeamMessage[]>('team.app.preflight', {
          conversationRef: current.current.conversationRef, expectedAccountKey: accountKey,
          selections: next.messages.map(message => ({ messageRef: message.ref, version: message.version })),
        }, controller.signal)
        if (!Array.isArray(messages) || messages.length !== next.messages.length || messages.some((message, i) => message.key !== next.messages[i]!.key || message.version !== next.messages[i]!.version || message.historyPreview || message.contentStatus !== 'available' || message.state !== 'published')) throw new Error('历史内容已变化，请重新查询')
        next = { ...next, messages }
      }
      if (controller.signal.aborted || active.current !== controller) return
      if (more && previous?.page) {
        next = { ...next, messages: [...new Map([...previous.page.messages, ...next.messages].map(m => [m.key, m])).values()], words: [...previous.page.words, ...next.words], participants: [...previous.page.participants, ...next.participants] }
      }
      const windowed = start.windowed || next.messages.length > 200
      if (next.messages.length > 200) next = { ...next, messages: next.messages.slice(-200) }
      const ready = { key, page: next, loading: false, error: '', windowed }
      value.current = ready; setState(ready)
    } catch (caught) {
      if (!controller.signal.aborted && active.current === controller) {
        const failed = { key, loading: false, error: caught instanceof Error ? caught.message : '历史读取失败，请重试', windowed: false }
        value.current = failed; setState(failed)
      }
    } finally {
      if (active.current === controller) busy.current = false
    }
  }, [key, enabled, accountKey, action, presentation])
  useEffect(() => {
    if (enabled) void load()
    else { active.current?.abort(); value.current = undefined; busy.current = false; setState({ key, loading: false, error: '', windowed: false }) }
    return () => active.current?.abort()
  }, [load, enabled])
  useEffect(() => subscribeTeamMessageChanges((account, receiptOnly) => {
    if (account !== accountKey || receiptOnly || !enabled) return
    active.current?.abort(); busy.current = false
    const invalidated = { key, loading: false, error: '团队内容已更新，请刷新查询', windowed: false }
    value.current = invalidated; setState(invalidated)
  }), [accountKey, key, enabled])
  const pause = () => {
    active.current?.abort(); busy.current = false
    const paused = { ...(value.current?.key === key ? value.current : { key, windowed: false }), loading: false, error: '已暂停读取，当前结果不完整' }
    value.current = paused; setState(paused)
  }
  const visible = enabled && state.key === key ? state : { loading: enabled, error: '', windowed: false, page: undefined }
  return { ...visible, more: () => load(true), refresh: () => setRevision(n => n + 1), pause }
}

/** The original member select is populated automatically with identity metadata.
 * Pagination never becomes an extra user step or a scan of message bodies. */
export function useTeamHistoryParticipants(conversationRef: string, accountKey: string, side: string, scope: string, revision: number) {
  const [state, setState] = useState<{ key: string; people: TeamIdentity[]; loading: boolean; error: string }>({ key: '', people: [], loading: false, error: '' })
  const key = JSON.stringify([scope, accountKey, side, revision]), active = useRef<AbortController>()
  const reference = useRef(conversationRef); reference.current = conversationRef
  useEffect(() => {
    if (side !== 'team') { setState({ key, people: [], loading: false, error: '' }); return }
    const controller = new AbortController(); active.current = controller
    setState({ key, people: [], loading: true, error: '' })
    void (async () => {
      const manifest = await prepareHistory(reference.current, accountKey, 'participants', { requestId: crypto.randomUUID(), timezone: historyTimezone() }, controller.signal)
      if (!manifest.resultRef) throw new Error('人员结果无效，请重试')
      let cursor: string | undefined
      const people = new Map<string, TeamIdentity>(), cursors = new Set<string>()
      for (;;) {
        const page = await historyCall(reference.current, accountKey, 'participants', { resultRef: manifest.resultRef!, ...(cursor ? { cursor } : {}), limit: 100 }, controller.signal)
        controller.signal.throwIfAborted()
        if (page.state !== 'ready' || page.hasMore && (!page.cursor || cursors.has(page.cursor))) throw new Error('发言者分页未推进，请重新读取')
        for (const person of page.participants) if (person.personKey && person.personRef) people.set(person.personKey, person)
        setState({ key, people: [...people.values()], loading: page.hasMore, error: '' })
        if (!page.hasMore) break
        cursor = page.cursor; cursors.add(cursor!)
      }
    })().catch(error => {
      if (!controller.signal.aborted) setState({ key, people: [], loading: false, error: error instanceof Error ? error.message : '人员读取失败' })
    })
    return () => controller.abort()
  }, [key, accountKey, side])
  useEffect(() => subscribeTeamMessageChanges((account, receiptOnly) => {
    if (account === accountKey && !receiptOnly) { active.current?.abort(); setState({ key, people: [], loading: false, error: '团队内容已更新，请刷新查询' }) }
  }), [accountKey, key])
  return { ...(state.key === key ? state : { people: [], loading: side === 'team', error: '' }), pause: () => { active.current?.abort(); setState(old => ({ ...old, loading: false, error: '已暂停读取，当前结果不完整' })) } }
}
