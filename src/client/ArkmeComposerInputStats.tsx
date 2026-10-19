import { memo, useState, useEffect, useCallback, type CSSProperties } from 'react'
import { tr, useArkmeLocale } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'
const ARKME_COMPOSER_SHOW_INPUT_TIME_STORAGE_KEY = 'arkme.composer.show-input-time'
const INPUT_TIME_CHANGED = 'arkme:composer-input-time-changed'
const styles = {
composerStats: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 10, marginLeft: 'auto', marginRight: 4, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap' },
composerTimeToggle: { height: 18, display: 'flex', alignItems: 'center', gap: 4, border: 0, padding: 0, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer', font: 'inherit' },
} satisfies Record<string, CSSProperties>

export function arkmeComposerShowsInputTime(): boolean {
  try { return window.localStorage.getItem(ARKME_COMPOSER_SHOW_INPUT_TIME_STORAGE_KEY) !== 'hidden' } catch { return true }
}

export function setArkmeComposerShowsInputTime(value: boolean): void {
  try { window.localStorage.setItem(ARKME_COMPOSER_SHOW_INPUT_TIME_STORAGE_KEY, value ? 'shown' : 'hidden') } catch { /* storage is optional */ }
  window.dispatchEvent(new Event(INPUT_TIME_CHANGED))
}

function ArkmeComposerInputTimeIcon({ visible }: { visible: boolean }) {
  return visible
    ? <svg width="14" height="15" viewBox="0 0 14 15" fill="none" aria-hidden>
      <path d="M0 7.5C.85 4.43 3.66 2.18 7 2.18S13.15 4.43 14 7.5C13.15 10.57 10.34 12.83 7 12.83S.85 10.57 0 7.5Z" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="7" cy="7.5" r="1.92" stroke="currentColor" strokeWidth="1.2" />
    </svg>
    : <svg width="14" height="15" viewBox="0 0 14 15" fill="none" aria-hidden>
      <path d="M1.11 4.95C1.69 5.72 2.53 6.38 3.57 6.84C4.61 7.31 5.79 7.55 7 7.55S9.39 7.31 10.42 6.84C11.46 6.38 12.31 5.72 12.89 4.95M3.21 6.77L1.03 9.53M10.76 6.77L13 9.79M8.55 7.55L9.17 11.03M5.83 7.55L5.21 11.03" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
}

export const ArkmeComposerInputStats = memo(function ArkmeComposerInputStats({
  active,
  visible,
  textLength,
  startedAtMillis,
  showsInputTime,
  onToggle,
}: {
  active: boolean
  visible: boolean
  textLength: number
  startedAtMillis?: number | undefined
  showsInputTime: boolean
  onToggle(): void
}) {
  useArkmeLocale()
  const [nowMillis, setNowMillis] = useState(() => Date.now())
  const [foreground, setForeground] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    if (typeof document === 'undefined') return
    const update = () => { setForeground(document.visibilityState !== 'hidden') }
    document.addEventListener('visibilitychange', update)
    return () => { document.removeEventListener('visibilitychange', update) }
  }, [])
  useEffect(() => {
    setNowMillis(Date.now())
    if (!active || !foreground || !visible || !showsInputTime || startedAtMillis === undefined) return
    const timer = globalThis.setInterval(() => { setNowMillis(Date.now()) }, 1_000)
    return () => { globalThis.clearInterval(timer) }
  }, [active, foreground, showsInputTime, startedAtMillis, visible])
  if (!active || !visible) return null
  const durationSeconds = startedAtMillis === undefined
    ? 0
    : Math.max(0, Math.floor((nowMillis - startedAtMillis) / 1_000))
  return <div data-arkme-composer-stats="true" style={styles.composerStats} aria-label={`已输入 ${String(textLength)} 字，编辑 ${String(durationSeconds)} 秒`}>
    <span>{String(textLength)}{tr("字")}</span>
    <button data-arkme-feedback="neutral"
      type="button"
      style={styles.composerTimeToggle}
      aria-label={showsInputTime ? tr("隐藏输入时长") : tr("显示输入时长")}
      title={showsInputTime ? tr("隐藏输入时长") : tr("显示输入时长")}
      onMouseDown={event => { event.preventDefault() }}
      onClick={onToggle}
    >
      <span>{showsInputTime ? tr("{v0}秒", { v0: String(durationSeconds) }) : tr("思考中…")}</span>
      <ArkmeComposerInputTimeIcon visible={showsInputTime} />
    </button>
  </div>
})

export function useArkmeComposerInputTimePreference(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(arkmeComposerShowsInputTime)
  useEffect(() => {
    const update = () => setValue(arkmeComposerShowsInputTime())
    window.addEventListener(INPUT_TIME_CHANGED, update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener(INPUT_TIME_CHANGED, update); window.removeEventListener('storage', update) }
  }, [])
  const set = useCallback((next: boolean) => { setValue(next); setArkmeComposerShowsInputTime(next) }, [])
  return [value, set]
}
