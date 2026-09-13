import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { Phone } from '@phosphor-icons/react/dist/icons/Phone'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { List } from '@phosphor-icons/react/dist/icons/List'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { recordingMobileGuideStyles } from './recording-mobile-guide-styles.js'

const steps = ['在快记页点击「录音」', '点击底部麦克风，开启录音', '看到「全天候录音中」，即已开启'] as const
const cycleMillis = 10_000
const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(reducedMotionQuery).matches === true)
  useEffect(() => {
    const media = window.matchMedia?.(reducedMotionQuery)
    if (!media) return
    const update = () => { setReduced(media.matches) }
    update()
    media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update) }
  }, [])
  return reduced
}

function useGuidePlayback(reducedMotion: boolean) {
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(true)
  const elapsedRef = useRef(0)
  const previousTime = useRef(0)
  useEffect(() => {
    if (!playing || reducedMotion) return
    previousTime.current = performance.now()
    let frame: number
    const tick = (now: number) => {
      elapsedRef.current = (elapsedRef.current + now - previousTime.current) % cycleMillis
      previousTime.current = now
      setElapsed(elapsedRef.current)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame) }
  }, [playing, reducedMotion])
  const replay = () => {
    elapsedRef.current = 0
    previousTime.current = performance.now()
    setElapsed(0)
    setPlaying(true)
  }
  return { elapsed, playing, replay, toggle: () => { setPlaying(value => !value) } }
}

function RecordingStatus({ recording, elapsed = 6000 }: { recording: boolean; elapsed?: number }) {
  return <div className={`guide-recording-status${recording ? ' is-recording' : ''}`}>
    <span className="guide-microphone"><Microphone size={19} weight="regular" />{!recording && <i className="guide-tap guide-microphone-tap" />}</span>
    <div className="guide-status-copy"><strong><i />{recording ? '全天候录音中' : '未开启'}</strong>
      {recording && <small data-recording-guide-clock>已录 00:00:{String(Math.floor((elapsed - 6000) / 1000)).padStart(2, '0')}</small>}
    </div>
    {recording && <div className="guide-wave">{Array.from({ length: 16 }, (_, index) => <i key={index} style={{ transform: `scaleY(${.2 + .8 * Math.abs(Math.sin(elapsed / 180 + index * .8))})` }} />)}</div>}
  </div>
}

function MobileDemo({ elapsed }: { elapsed: number }) {
  const phase = elapsed < 2000 ? 'swipe' : elapsed < 4000 ? 'enter' : elapsed < 6000 ? 'activate' : 'recording'
  // Seek paused CSS animations with the same clock as the captions and meter.
  // This also freezes transitions mid-gesture and resets every visual on replay.
  return <div className="guide-demo" data-recording-guide-demo data-recording-guide-phase={phase}
    style={{ '--guide-time': `-${elapsed}ms` } as CSSProperties} aria-hidden="true">
    <div className="guide-home">
      <header className="guide-phone-header"><span><List size={13} />即我</span><span><MagnifyingGlass size={13} /><CalendarBlank size={13} /></span></header>
      <div className="guide-messages"><small>今天</small>{[0, 1, 2].map(index => <div className="guide-message" key={index}><span /><i /></div>)}</div>
      <div className="guide-compose">
        <div className="guide-tools-window"><div className="guide-tools-track">
          <span>DSH</span><span><CalendarBlank size={11} />安排</span><span>Agent</span><span><Phone size={11} />通话</span>
          <span className="guide-record-tool"><Microphone size={12} />录音<i className="guide-tap guide-entry-tap" /></span>
        </div></div>
        <div className="guide-input">单击文字，长按语音<Plus size={18} /></div>
        <div className="guide-phone-nav"><strong>快记</strong><span>探索</span><span>我的</span></div>
      </div>
      <div className="guide-swipe"><i /><span /></div>
    </div>
    <div className="guide-record-page">
      <header className="guide-phone-header"><CaretLeft size={15} /><strong>录音</strong><CalendarBlank size={14} /></header>
      <div className="guide-record-tabs"><span>时间轴</span><span>总结</span><span>转写</span><span>文件</span></div>
      <div className="guide-record-empty"><span className="guide-empty-lines"><i /><i /><i /></span><strong>暂无时间轴</strong><small>可根据当天转写生成时间轴</small></div>
      <RecordingStatus recording={phase === 'recording'} elapsed={elapsed} />
    </div>
  </div>
}

function StaticGuide() {
  return <ol className="guide-static-steps">{steps.map((step, index) => <li key={step} data-recording-guide-static-step>
    <div className="guide-static-preview" aria-hidden="true">{index === 0
      ? <div className="guide-static-entry"><span>快记</span><span><Phone size={12} />通话</span><strong><Microphone size={14} />录音</strong></div>
      : <RecordingStatus recording={index === 2} />}</div>
    <p><span>{index + 1}</span>{step}</p>
  </li>)}</ol>
}

export function ArkmeRecordingMobileGuideDialog({ onClose, returnFocusRef }: {
  onClose(): void
  returnFocusRef: RefObject<HTMLButtonElement>
}) {
  const id = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const reducedMotion = useReducedMotion()
  const playback = useGuidePlayback(reducedMotion)
  const step = playback.elapsed < 4000 ? 0 : playback.elapsed < 6000 ? 1 : 2

  useEffect(() => {
    const previous = returnFocusRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    closeRef.current?.focus({ preventScroll: true })
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) closeRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('focusin', containFocus)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [returnFocusRef])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      } else if (event.key === 'Tab') {
        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
        const first = buttons?.[0]
        const last = buttons?.[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true) }
  }, [onClose])

  const content = <div className="arkme-recording-mobile-guide" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <style>{recordingMobileGuideStyles}</style>
    <section ref={dialogRef} className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description ${id}-note`}>
      <header className="guide-header"><h2 id={`${id}-title`}>在手机上开启全天候录音</h2>
        <button ref={closeRef} type="button" className="guide-close" aria-label="关闭录音引导" onClick={onClose}><X size={18} /></button>
      </header>
      <p id={`${id}-description`} className="guide-description">打开手机即我，登录同一账号</p>
      {reducedMotion ? <StaticGuide /> : <>
        <div className="guide-stage"><MobileDemo elapsed={playback.elapsed} /></div>
        <p className="guide-step" data-recording-guide-step><span>{step + 1}</span>{steps[step]}</p>
        <div className="guide-progress" aria-hidden="true">{steps.map((label, index) => <i key={label} className={index === step ? 'is-current' : ''} />)}</div>
        <ol className="guide-accessible">{steps.map(label => <li key={label}>{label}</li>)}</ol>
      </>}
      <p className="guide-note" id={`${id}-note`}>操作演示，请在手机上开启</p>
      <footer className="guide-footer"><div className="guide-controls">{!reducedMotion && <>
        <button type="button" onClick={playback.toggle}>{playback.playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}{playback.playing ? '暂停' : '继续'}</button>
        <button type="button" onClick={playback.replay}><ArrowCounterClockwise size={14} aria-hidden />重新播放</button>
      </>}</div><button type="button" className="guide-done" onClick={onClose}>我知道了</button></footer>
    </section>
  </div>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
