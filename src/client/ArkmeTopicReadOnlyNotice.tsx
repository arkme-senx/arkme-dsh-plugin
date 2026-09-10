import type { CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import { ARKME_DSH_INPUT_TOPIC_TITLE, ARKME_DSH_INPUT_TOPIC_DESCRIPTION } from '../topic-policy.js'

const styles: Record<string, CSSProperties> = {
  footer: { flexShrink: 0, minHeight: 72, width: '100%', boxSizing: 'border-box',
    padding: '14px 22px', borderTop: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.base,
    color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px' },
  title: { color: arkmeTheme.text, fontWeight: 500 },
  hint: { fontSize: 12, color: arkmeTheme.tertiary },
}

/** Explains the absent composer without adding archive-only settings. */
export function ArkmeTopicReadOnlyNotice() {
  return <footer aria-label="系统主题说明" style={styles.footer}>
    <div style={styles.title}>系统主题 · {ARKME_DSH_INPUT_TOPIC_TITLE}</div>
    <div style={styles.hint}>{ARKME_DSH_INPUT_TOPIC_DESCRIPTION}</div>
  </footer>
}
