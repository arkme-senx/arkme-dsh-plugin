import { useEffect, useRef, useState } from 'react'
import type { RecordingEntityFeedbackAction, RecordingEntityFeedbackInput, RecordingEntityFeedbackResult, RecordingEntityFeedbackUndoInput } from '../../recording-entity-contract.js'
import { callArkme } from '../api.js'

type Command = { operation: 'recordings.entities.feedback'; input: RecordingEntityFeedbackInput }
  | { operation: 'recordings.entities.feedback.undo'; input: RecordingEntityFeedbackUndoInput }

/** Mounted under the existing account/day-scoped panel. Never persists a local result. */
export function useRecordingEntityFeedback(onRefresh: () => void) {
  const pending = useRef<AbortController>(), command = useRef<Command>()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [receipt, setReceipt] = useState<RecordingEntityFeedbackResult>()
  useEffect(() => () => { pending.current?.abort(); pending.current = undefined }, [])
  const run = async (next: Command) => {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller; command.current = next
    setBusy(true); setError(''); setNotice('')
    let rejectTimeout!: (error: Error) => void
    const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject })
    const timer = setTimeout(() => { controller.abort(); rejectTimeout(new Error('timeout')) }, 30_000)
    try {
      if (next.operation === 'recordings.entities.feedback') {
        const value = await Promise.race([callArkme<RecordingEntityFeedbackResult>(next.operation, { ...next.input }, controller.signal), timeout])
        if (controller.signal.aborted) return
        setReceipt(value); setNotice('反馈已保存，仅影响这次提及')
      } else {
        await Promise.race([callArkme(next.operation, { ...next.input }, controller.signal), timeout])
        if (controller.signal.aborted) return
        setReceipt(undefined); setNotice('已撤销这次反馈')
      }
      command.current = undefined; onRefresh()
    } catch (failure) {
      if (pending.current !== controller) return
      const code = (failure as { body?: { code?: string } })?.body?.code
      if (code === 'recording-entity-feedback-rejected') {
        command.current = undefined
        setError('这次操作未生效，请刷新后再操作。'); onRefresh()
      } else setError('暂未确认操作结果，请重试这次反馈。')
    } finally {
      clearTimeout(timer)
      if (pending.current === controller) { pending.current = undefined; setBusy(false) }
    }
  }
  return { busy, error, notice, receipt, retryPending: !!command.current,
    apply: (feedbackRef: string, action: RecordingEntityFeedbackAction) => {
      if (command.current || pending.current) return
      void run({ operation: 'recordings.entities.feedback', input: { feedbackRef, action, requestId: crypto.randomUUID() } })
    },
    undo: () => {
      if (!receipt || command.current || pending.current) return
      void run({ operation: 'recordings.entities.feedback.undo', input: { undoRef: receipt.undoRef, requestId: crypto.randomUUID() } })
    },
    retry: () => { if (command.current) void run(command.current) },
  }
}
