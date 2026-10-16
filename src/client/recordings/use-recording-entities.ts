import { useEffect, useRef, useState } from 'react'
import type { RecordingEntityDay, RecordingEntityStartResult } from '../../recording-entity-contract.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'

export function useRecordingEntities(account: string, dateStamp: number, active: boolean, refreshRevision: string) {
  const scope = `${account}:${dateStamp}`
  const [openedScope, setOpenedScope] = useState('')
  const open = openedScope === scope && active
  const [refresh, setRefresh] = useState(0)
  const command = useRef<{ scope: string; controller: AbortController }>()
  const [startState, setStartState] = useState<{ scope: string; starting: boolean; startError: boolean }>({ scope, starting: false, startError: false })
  useEffect(() => () => { command.current?.controller.abort(); command.current = undefined }, [scope, active])
  const start = async () => {
    if (!account || !active || command.current) return
    const current = { scope, controller: new AbortController() }
    command.current = current
    setStartState({ scope, starting: true, startError: false })
    const timeout = setTimeout(() => current.controller.abort(), 30_000)
    try {
      await callArkme<RecordingEntityStartResult>('recordings.entities.start', { dateStamp, transcriptSource: 'system' }, current.controller.signal)
      if (command.current !== current) return
      setStartState({ scope, starting: false, startError: false })
    } catch {
      if (command.current !== current) return
      setStartState({ scope, starting: false, startError: true })
    } finally {
      clearTimeout(timeout)
      if (command.current === current) {
        command.current = undefined
        // An unknown write outcome is resolved by a read, never automatic replay.
        setRefresh(value => value + 1)
      }
    }
  }
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const latest = useRef<{ scope: string; data: RecordingEntityDay }>()
  const [state, setState] = useState<{ scope: string; data?: RecordingEntityDay; loading: boolean; error: boolean; paused: boolean }>({ scope, loading: false, error: false, paused: false })
  useEffect(() => {
    if (typeof document === 'undefined') return
    const change = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  useEffect(() => { if (!active) setOpenedScope('') }, [active])
  useEffect(() => {
    if (latest.current?.scope !== scope) latest.current = undefined
    if (!account || !active || !visible) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const deadline = Date.now() + 10 * 60_000
    const load = async () => {
      const previous = latest.current?.scope === scope ? latest.current.data : undefined
      setState({ scope, ...(previous ? { data: previous } : {}), loading: !previous, error: false, paused: false })
      let poll = false
      try {
        const incoming = await withArkmeReadDeadline(signal => callArkme<RecordingEntityDay>('recordings.entities', {
          dateStamp, transcriptSource: 'system', knownStateRevision: previous?.stateRevision ?? 0, knownProjectionRevision: previous?.projectionRevision ?? 0,
          ...(previous?.personalization ? { knownPersonalizationRevision: previous.personalization.revision } : {}),
        }, signal), controller.signal)
        if (controller.signal.aborted) return
        const data = { ...incoming, entities: incoming.entities ?? (incoming.version === previous?.version ? previous.entities ?? [] : []) }
        latest.current = { scope, data }
        failures = 0
        poll = data.pollable
        setState({ scope, data, loading: false, error: false, paused: false })
      } catch {
        if (controller.signal.aborted) return
        failures += 1
        poll = true
        setState({ scope, ...(previous ? { data: previous } : {}), loading: false, error: true, paused: failures >= 3 })
      }
      if (open && poll && !controller.signal.aborted) {
        if (Date.now() >= deadline || failures >= 3) setState(value => ({ ...value, paused: true }))
        else timer = setTimeout(() => { void load() }, Math.min(30_000, 5000 * 2 ** Math.max(0, failures - 1)))
      }
    }
    void load()
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [scope, account, dateStamp, active, visible, open, refreshRevision, refresh])
  return {
    ...(startState.scope === scope ? startState : { starting: false, startError: false }), start,
    ...(state.scope === scope ? state : { scope, loading: true, error: false, paused: false }), open,
    setOpen: (value: boolean) => setOpenedScope(value ? scope : ''), refresh: () => setRefresh(value => value + 1),
  }
}
