import { useEffect, useRef } from 'react'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeTeam } from '../types.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { arkmeUi } from './ui-controller.js'
import { rememberWorldPublishTeam } from './world-publish-entry.js'
/** World is an outlet for already sent content; this guide never writes a record. */
export function WorldPublishGuide({ onClose, initialTeam }: { onClose(): void; initialTeam?: ArkmeTeam }) {
  useArkmeLocale()
  const dialog = useRef<HTMLElement>(null), button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    button.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab' && dialog.current) {
        const items = [...dialog.current.querySelectorAll<HTMLButtonElement>('button')]
        if ((event.shiftKey && document.activeElement === items[0]) || (!event.shiftKey && document.activeElement === items.at(-1))) {
          event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0])?.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus() }
  }, [onClose])
  const write = () => {
    const auth = arkmeAuthStore.getSnapshot().auth
    if (auth?.status !== 'authenticated' || !auth.userId) { onClose(); arkmeUi.showLogin(); return }
    rememberWorldPublishTeam(`${auth.environment}:${auth.userId}`, initialTeam)
    onClose(); arkmeUi.focusSendToSelf(true)
  }
  return <div style={{ position: 'fixed', inset: 0, zIndex: 1750, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(0,0,0,.28)' }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="world-publish-guide-title" style={{ width: 'min(380px,100%)', boxSizing: 'border-box', padding: 22, borderRadius: 14, background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}><h2 id="world-publish-guide-title" style={{ flex: 1, margin: 0, fontSize: 16 }}>{tr('把你发过的内容分享给世界')}</h2><button type="button" aria-label={tr('关闭发布引导')} onClick={onClose} style={{ border: 0, padding: 3, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer' }}><X size={18}/></button></div>
      <p style={{ fontSize: 14, lineHeight: 1.8, margin: '16px 0', color: arkmeTheme.secondary }}>{tr('在发给自己、私聊、群聊、Arko 等对话中，找到自己发过的内容，右键或长按，选择「发到世界」。')}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 22 }}><span style={{ fontSize: 13, color: arkmeTheme.secondary }}>{tr('想现在写一条？')}</span><button ref={button} type="button" onClick={write} style={{ border: 0, borderRadius: 8, padding: '8px 16px', background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>{tr('去记录')}</button></div>
    </section>
  </div>
}
