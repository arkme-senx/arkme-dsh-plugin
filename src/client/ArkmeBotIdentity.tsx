/** Flutter parity: participant_identity.dart and the shared Bot avatar component.
 * The smart_toy_rounded glyph is copied unchanged from Flutter's MaterialIcons font
 * (U+F019A), scaled from 512 to 24 units. Google Material Icons, CC BY 4.0;
 * attribution and license: assets/licenses/MaterialIcons_LICENSE.txt.
 */
export function ArkmeBotIdentityStyles() {
  return <style>{`
.arkme-bot-identity {
  --arkme-bot-primary: #2b2b2b;
  --arkme-bot-secondary: #616161;
  --arkme-bot-tertiary: #a4a4a4;
  --arkme-bot-avatar-fill: color-mix(in srgb, var(--arkme-bot-primary) 8%, transparent);
  --arkme-bot-avatar-border: color-mix(in srgb, var(--arkme-bot-primary) 12%, transparent);
  --arkme-bot-tag-fill: rgb(0 0 0 / 5%);
}
body[data-ds-dark-theme] .arkme-bot-identity {
  --arkme-bot-primary: #d2d2d2;
  --arkme-bot-secondary: #a4a4a4;
  --arkme-bot-tertiary: #888888;
  --arkme-bot-avatar-fill: color-mix(in srgb, var(--arkme-bot-primary) 14%, transparent);
  --arkme-bot-avatar-border: color-mix(in srgb, var(--arkme-bot-primary) 20%, transparent);
  --arkme-bot-tag-fill: rgb(255 255 255 / 10%);
}
`}</style>
}

export function ArkmeBotAvatarFallback({ size }: { size: number }) {
  return <span className="arkme-bot-identity" data-arkme-bot-avatar="true" style={{
    width: '100%', height: '100%', display: 'grid', placeItems: 'center', boxSizing: 'border-box',
    borderRadius: '50%', background: 'var(--arkme-bot-avatar-fill)', color: 'var(--arkme-bot-primary)',
    border: `${size * .03}px solid var(--arkme-bot-avatar-border)`,
  }}><svg width={size * .6} height={size * .6} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.015625 9.0V6.984375C20.015625 5.90625 19.078125 5.015625 18.0 5.015625H15.0C15.0 3.328125 13.640625 2.015625 12.0 2.015625C10.359375 2.015625 9.0 3.328125 9.0 5.015625H6.0C4.921875 5.015625 3.984375 5.90625 3.984375 6.984375V9.0C2.34375 9.0 0.984375 10.359375 0.984375 12.0C0.984375 13.640625 2.34375 15.0 3.984375 15.0V18.984375C3.984375 20.109375 4.921875 21.0 6.0 21.0H18.0C19.078125 21.0 20.015625 20.109375 20.015625 18.984375V15.0C21.65625 15.0 23.015625 13.640625 23.015625 12.0C23.015625 10.359375 21.65625 9.0 20.015625 9.0ZM7.5 11.484375C7.5 10.6875 8.15625 9.984375 9.0 9.984375C9.84375 9.984375 10.5 10.6875 10.5 11.484375C10.5 12.328125 9.84375 12.984375 9.0 12.984375C8.15625 12.984375 7.5 12.328125 7.5 11.484375ZM15.0 17.015625H9.0C8.4375 17.015625 8.015625 16.546875 8.015625 15.984375C8.015625 15.46875 8.4375 15.0 9.0 15.0H15.0C15.5625 15.0 15.984375 15.46875 15.984375 15.984375C15.984375 16.546875 15.5625 17.015625 15.0 17.015625ZM15.0 12.984375C14.15625 12.984375 13.5 12.328125 13.5 11.484375C13.5 10.6875 14.15625 9.984375 15.0 9.984375C15.84375 9.984375 16.5 10.6875 16.5 11.484375C16.5 12.328125 15.84375 12.984375 15.0 12.984375Z" />
  </svg></span>
}

export function ArkmeBotSenderName({ name, detail = false }: { name: string; detail?: boolean }) {
  return <span className="arkme-bot-identity" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      fontSize: detail ? 14 : 12, lineHeight: detail ? '20px' : '12px', fontWeight: detail ? 500 : 400,
      color: detail ? 'var(--arkme-bot-primary)' : 'var(--arkme-bot-tertiary)',
    }}>{name}</span>
    <span data-arkme-bot-tag="true" style={{ flex: 'none', borderRadius: 999, padding: '2px 7px',
      fontSize: 10, lineHeight: '14px', fontWeight: 500, background: 'var(--arkme-bot-tag-fill)',
      color: 'var(--arkme-bot-secondary)',
    }}>BOT</span>
  </span>
}
