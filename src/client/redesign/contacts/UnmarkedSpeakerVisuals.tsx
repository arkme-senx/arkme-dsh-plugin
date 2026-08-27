export function UnmarkedSpeakerTokenAvatar({
  token,
  size = 38,
  label,
}: {
  token?: string | undefined
  size?: number
  label: string
}) {
  return <span
    className="arkme-unmarked-speaker-token-avatar"
    style={{ width: size, height: size, fontSize: Math.max(13, Math.round(size * .32)) }}
    role="img"
    aria-label={label}
  >{token?.trim() || '–'}</span>
}

export function UnmarkedSpeakerLinearIcon({ kind }: { kind: 'search' | 'sound' | 'profile' }) {
  if (kind === 'sound') return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M3 8.25V15.75" />
    <path d="M7.5 5.75V18.25" />
    <path d="M12 3.25V20.75" />
    <path d="M16.5 5.75V18.25" />
    <path d="M21 8.25V15.75" />
  </svg>
  if (kind === 'profile') return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M12.1601 10.87C12.0601 10.86 11.9401 10.86 11.8301 10.87C9.45006 10.79 7.56006 8.84 7.56006 6.44C7.56006 3.99 9.54006 2 12.0001 2C14.4501 2 16.4401 3.99 16.4401 6.44C16.4301 8.84 14.5401 10.79 12.1601 10.87Z" />
    <path d="M7.15997 14.56C4.73997 16.18 4.73997 18.82 7.15997 20.43C9.90997 22.27 14.42 22.27 17.17 20.43C19.59 18.81 19.59 16.17 17.17 14.56C14.43 12.73 9.91997 12.73 7.15997 14.56Z" />
  </svg>
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z" />
    <path d="M3.40991 22C3.40991 18.13 7.25994 15 11.9999 15" />
    <path d="M18.2 21.4C19.9673 21.4 21.4 19.9673 21.4 18.2C21.4 16.4327 19.9673 15 18.2 15C16.4327 15 15 16.4327 15 18.2C15 19.9673 16.4327 21.4 18.2 21.4Z" />
    <path d="M22 22L21 21" />
  </svg>
}
