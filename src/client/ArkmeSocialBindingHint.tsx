import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { useId } from 'react'
import { arkmeTheme as theme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { arkmeUi } from './ui-controller.js'

export const socialBindingDescription = '绑定手机号后即可使用社交功能'

/** Reuse the account settings flow without adding a login or business guard. */
export function ArkmeSocialBindingHint({ onOpen }: { onOpen?: () => void }) {
  useArkmeLocale()
  const descriptionId = useId()
  return <div data-arkme-social-binding-hint style={{ padding: '8px 12px 12px', minWidth: 0 }}>
    <button type="button" data-arkme-feedback="neutral" aria-label={tr('去绑定')} aria-describedby={descriptionId}
      style={{ width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', cursor: 'pointer', textAlign: 'start', font: 'inherit', color: theme.text, background: theme.layer1, border: 0, borderRadius: 8 }}
      onClick={() => { onOpen?.(); arkmeUi.openDshSettings('arkme-account') }}>
      <span id={descriptionId} style={{ flex: 1, minWidth: 0, color: theme.secondary, fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{tr(socialBindingDescription)}</span>
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 2, fontSize: 12, fontWeight: 500 }}>
        {tr('去绑定')}<CaretRight size={13} aria-hidden />
      </span>
    </button>
  </div>
}
