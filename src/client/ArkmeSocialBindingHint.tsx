import { arkmeTheme as theme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { arkmeUi } from './ui-controller.js'

export const socialBindingDescription = '绑定手机号后可使用聊天、世界、联系人和通话'

/** Reuse the account settings flow without adding a login or business guard. */
export function ArkmeSocialBindingHint({ onOpen }: { onOpen?: () => void }) {
  useArkmeLocale()
  return <div data-arkme-social-binding-hint style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
    <p style={{ margin: 0, color: theme.secondary, fontSize: 13, lineHeight: 1.6 }}>{tr(socialBindingDescription)}</p>
    <button type="button" data-arkme-feedback="neutral"
      style={{ alignSelf: 'flex-start', padding: '8px 12px', cursor: 'pointer', color: theme.text, background: theme.base, border: `1px solid ${theme.border}`, borderRadius: 8 }}
      onClick={() => { onOpen?.(); arkmeUi.openDshSettings('arkme-account') }}>
      {tr('去绑定')}
    </button>
  </div>
}
