import { useEffect, useId, useRef, useState } from 'react'
import type { ArkmeLoginTranslate } from './arkme-login-locales.js'
import { icon0, icon1, icon2, icon3, icon4, icon5 } from './scan-guide-icons.js'
import { scanGuideStyles } from './scan-guide-styles.js'

export function ArkmeScanGuide({ t }: { t: ArkmeLoginTranslate }) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [resetting, setResetting] = useState(true)
  const demo = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    let timers: ReturnType<typeof setTimeout>[] = []
    const cycle = () => {
      timers = []
      setPhase(0); setRevealed(false); setResetting(true)
      timers.push(setTimeout(() => setResetting(false), 60))
      timers.push(setTimeout(() => setRevealed(true), 1300))
      timers.push(setTimeout(() => setPhase(1), 2600))
      timers.push(setTimeout(() => setPhase(2), 4700))
      timers.push(setTimeout(cycle, 8800))
    }
    cycle()
    return () => timers.forEach(clearTimeout)
  }, [open])
  useEffect(() => {
    const frame = demo.current
    if (!frame || phase === 0) return
    const target = frame.querySelector<HTMLElement>(phase === 1 ? '.demo-plus' : '.scan-target')
    const ring = frame.querySelector<HTMLElement>('.tap-ring')
    if (!target || !ring) return
    const a = target.getBoundingClientRect(), b = frame.getBoundingClientRect()
    const scale = b.width / frame.offsetWidth || 1
    ring.style.left = `${(a.left - b.left + a.width / 2) / scale - frame.clientLeft - 10.5}px`
    ring.style.top = `${(a.top - b.top + a.height / 2) / scale - frame.clientTop - 10.5}px`
  }, [phase, open])
  const close = () => { setOpen(false); setPhase(0); setRevealed(false); setResetting(true) }
  const steps = [t('guide.swipe'), t('guide.plus'), t('guide.choose')]
  return <div className="arkme-scan-guide">
    <style>{scanGuideStyles}</style>
    <button type="button" className="arkme-scan-guide-trigger" aria-expanded={open} aria-controls={id}
      onMouseEnter={() => setOpen(true)} onMouseLeave={close}
      onFocus={() => setOpen(true)} onBlur={close}
      onKeyDown={event => { if (event.key === 'Escape') close() }}
    >{t('guide.label')}</button>
    {open && <div id={id} className="arkme-scan-guide-content" role="note">
      <div className="guide-animation-frame">
      <div ref={demo} className={`clean-demo${revealed ? ' reveal' : ''}${resetting ? ' resetting' : ''}`} data-phase={phase} aria-hidden="true">
<div className="demo-home">
        <div className="demo-bar">
        <span className="home-title">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5h10M3 8h10M3 11h10"/>
        </svg> {t('guide.app')}</span>
        <span className="home-tools">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="4"/>
        <path d="m10 10 3 3"/>
        </svg>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="3.5" width="11" height="10" rx="2"/>
        <path d="M5 2v3m6-3v3M3 7h10"/>
        </svg>
        </span>
        </div>
        <div className="demo-bubbles">
        <div className="demo-date">{t('guide.today')}</div>
        <div className="bubble-row">
        <i>
        </i>
        <span className="avatar">
        <img src={icon0} alt="" />
        </span>
        </div>
        <div className="bubble-row">
        <i>
        </i>
        <span className="avatar">
        <img src={icon0} alt="" />
        </span>
        </div>
        </div>
        </div>
        <div className="demo-shade">
        </div>
        <div className="demo-list">
        <div className="demo-bar">
        <span>{t('guide.chats')}</span>
        <span className="demo-plus">＋</span>
        </div>
        <div className="simple-row">
        <span className="simple-avatar self-icon">
        <img src={icon1} alt="" />
        </span>
        <div>
        <span>{t('guide.self')}</span>
        <i>
        </i>
        </div>
        <time className="row-date">09/10</time>
        </div>
        <div className="simple-row">
        <span className="simple-avatar agent-icon">
        <img src={icon2} alt="" />
        </span>
        <div>
        <span>Agent</span>
        <i>
        </i>
        </div>
        <time className="row-date">09/09</time>
        </div>
        </div>
        <div className="demo-menu">
        <div>
        <img src={icon3} alt="" />{t('guide.contact')}</div>
        <div>
        <img src={icon4} alt="" />{t('guide.group')}</div>
        <div>
        <img src={icon5} alt="" />{t('guide.bot')}</div>
        <div className="scan-target">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2H3a1 1 0 0 0-1 1v3m8-4h3a1 1 0 0 1 1 1v3M2 10v3a1 1 0 0 0 1 1h3m4 0h3a1 1 0 0 0 1-1v-3M5 5h6v6H5z"/>
        </svg>{t('guide.scan')}</div>
        </div>
        <div className="swipe-cue">
        <span className="swipe-track">
        </span>
        <span className="swipe-finger">
        </span>
        </div>
        <div className="tap-ring">
        </div>
      </div>
      </div>
      <div className="guide-step">{steps[phase]}</div>
      <div className="guide-note">{t('guide.update')}</div>
      <span className="guide-accessible">{steps.join(' → ')}</span>
    </div>}
  </div>
}
