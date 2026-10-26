import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { DictationWaveform, type DictationWaveformHandle } from './DictationWaveform.js'
import { ArkmeComposerToolButton } from './ArkmeComposerToolButton.js'
import { DictationSession, type DictationState } from './dictation-session.js'
import { plainDictationTarget, type DictationTarget } from './dictation-target.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { copyText } from './clipboard-text.js'
import type { ArkmeAuthSnapshot } from '../types.js'
import { tr } from './locale.js'

const initial: DictationState = { phase: 'idle', pending: 0, error: '', level: 0 }
export function textareaDictationTarget(input: HTMLTextAreaElement | null, write: (text: string) => void): DictationTarget | undefined {
  if (!input || input.disabled || input.readOnly) return
  return plainDictationTarget({ read: () => input.value, at: input.selectionEnd, maxLength: input.maxLength > 0 ? input.maxLength : 40_000,
    available: () => input.isConnected && !input.disabled && !input.readOnly,
    write(text, caret) { write(text); queueMicrotask(() => { if (input.isConnected) input.setSelectionRange(caret, caret) }) },
  })
}

/** One listening UX for notes, messages and articles; placement belongs to the caller. */
export function ArkmeDictationButton(props: {
  authSnapshot?: ArkmeAuthSnapshot | undefined
  scopeKey: string | undefined; disabled?: boolean | undefined; active?: boolean | undefined
  getTarget(): DictationTarget | undefined
  onBusyChange?(busy: boolean): void
}) {
  const storedAuth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const auth = props.authSnapshot ?? storedAuth
  const account = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  const [state, setState] = useState(initial)
  const session = useRef<DictationSession>()
  const waveform = useRef<DictationWaveformHandle>(null)
  const latest = useRef(props); latest.current = props
  const mounted = useRef(false)
  const busy = state.phase === 'starting' || state.phase === 'listening' || state.phase === 'finishing'
  useEffect(() => {
    mounted.current = true; setState(initial)
    return () => { mounted.current = false; session.current?.cancel(); session.current = undefined; latest.current.onBusyChange?.(false) }
  }, [account, props.scopeKey])
  useEffect(() => {
    if (props.active === false || props.disabled) { session.current?.cancel(); session.current = undefined; setState(initial); props.onBusyChange?.(false) }
  }, [props.active, props.disabled])
  const start = () => {
    if (busy || session.current?.busy || props.disabled || props.active === false || !auth?.userId || !account) return
    const target = props.getTarget()
    if (!target) { setState({ ...initial, error: '请先将光标放到可编辑的正文中' }); return }
    session.current?.cancel()
    const next = new DictationSession(target, auth.userId, value => {
      if (!mounted.current || session.current !== next) return
      setState(value)
      latest.current.onBusyChange?.(['starting', 'listening', 'finishing'].includes(value.phase) || value.phase === 'failed' && value.pending > 0)
    })
    next.setLevelListener(level => waveform.current?.sample(level))
    session.current = next; void next.start()
  }
  const listening = state.phase === 'listening' || state.phase === 'starting'
  const label = listening ? '停止听写' : state.phase === 'finishing' ? '正在识别语音' : '语音输入'
  return <span data-arkme-dictation={state.phase} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flex: 'none' }}>
    <ArkmeComposerToolButton aria-label={tr(label)} title={tr(label)} aria-pressed={listening}
      disabled={props.disabled || props.active === false || !account || state.phase === 'finishing' || state.phase === 'failed' && state.pending > 0}
      onMouseDown={event => event.preventDefault()}
      onClick={() => { if (listening) void session.current?.stop(); else start() }}>
      <span data-arkme-dictation-visual={state.phase === 'listening' ? 'waveform' : 'microphone'} style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 9,
        background: state.phase === 'listening' ? arkmeTheme.accent : 'transparent', color: state.phase === 'listening' ? '#fff' : 'inherit' }}>
        {state.phase === 'listening' ? <DictationWaveform ref={waveform} /> : <Microphone size={20} />}
      </span>
    </ArkmeComposerToolButton>
    {(busy || state.error || state.phase === 'failed') && <span role="status" style={{ position: 'absolute', bottom: 42, left: 0, minWidth: 180, maxWidth: 'min(340px,70vw)', padding: '8px 12px', borderRadius: 10,
      border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: '0 4px 18px #0002', fontSize: 12, lineHeight: '20px', zIndex: 15 }}>
      <span>{tr(state.phase === 'starting' ? '正在开启麦克风…' : state.phase === 'listening' ? '正在听写，停顿后文字会陆续出现' : state.phase === 'finishing' ? '正在识别剩余语音…' : state.error || '听写已停止')}</span>
      {state.pending > 0 && <span> · {state.pending}</span>}
      {state.error && busy && <span style={{ display: 'block' }}>{tr(state.error)}</span>}
      {state.phase === 'failed' && session.current?.canRetry && <button type="button" onClick={() => session.current?.retry()}>{tr('重试识别')}</button>}
      {state.phase === 'failed' && session.current?.recoverableText && <button type="button" onClick={() => { void copyText(session.current!.recoverableText) }}>{tr('复制识别结果')}</button>}
      {!busy && <button type="button" aria-label={tr('关闭听写提示')} onClick={() => { session.current?.cancel(); session.current = undefined; setState(initial); latest.current.onBusyChange?.(false) }} style={{ marginLeft: 8 }}>{tr(state.pending > 0 ? '结束听写' : '关闭')}</button>}
    </span>}
  </span>
}
