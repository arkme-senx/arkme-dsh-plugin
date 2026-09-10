import type { ArkmeSourceItem } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'

export const OFFICIAL_AUTHOR_USER_ID = 11
export const OFFICIAL_AUTHOR_PREVIEW = '问题反馈与使用建议'

export function isArkmeOfficialAuthor(source: ArkmeSourceItem | undefined): boolean {
  return source?.kind === 'private_chat' && source.peerUserId === OFFICIAL_AUTHOR_USER_ID
}

/** Presentation only: never inserts a message or mutates the conversation. */
export function ArkmeOfficialAuthorGuide() {
  return <section aria-label="使用反馈与建议" data-arkme-official-author-guide="true" style={{
    flex: 'none', padding: '16px 24px 28px', textAlign: 'center', background: arkmeTheme.base,
  }}>
    <h3 style={{ margin: '0 0 8px', fontSize: 14, lineHeight: '20px', fontWeight: 500, color: arkmeTheme.text }}>使用反馈与建议</h3>
    <p style={{ margin: '0 auto', maxWidth: 520, fontSize: 12, lineHeight: '22px', color: arkmeTheme.secondary }}>
      如有使用问题、功能疑问或改进建议，请在下方留言。反馈异常时，可附上操作步骤及截图。
    </p>
  </section>
}
