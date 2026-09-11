import type { CSSProperties, MouseEvent } from 'react'

const SEND_BACKGROUND = '#09B83E'
const SEND_BACKGROUND_HOVER = '#08A437'

export const arkmeComposerSendButtonStyle: CSSProperties = {
  width: 36,
  height: 28,
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  border: 0,
  borderRadius: 14,
  background: SEND_BACKGROUND,
  color: '#fff',
  cursor: 'pointer',
  transform: 'translateY(-2px)',
  transition: 'background-color 100ms ease',
}

export const arkmeComposerSendButtonDisabledStyle: CSSProperties = {
  background: '#DCE1E9',
  color: '#fff',
  cursor: 'default',
}

export function ArkmeComposerSendIcon() {
  return <svg viewBox="9.7 6.1 16 16" width="16" height="16" aria-hidden>
    <path d="M23.5521 7.04659L11.5965 10.7238C10.7646 10.9798 10.6133 12.092 11.3467 12.5609L14.879 14.8189C15.0627 14.9363 15.2792 14.9919 15.4967 14.9775C15.7142 14.9631 15.9214 14.8794 16.088 14.7388L20.4967 11.0186C20.7357 10.8169 21.0582 11.1392 20.8566 11.3784L17.1366 15.7879C16.996 15.9545 16.9124 16.1617 16.8981 16.3792C16.8837 16.5966 16.9393 16.813 17.0568 16.9966L19.3143 20.5285C19.783 21.2617 20.8954 21.1104 21.1513 20.2787L24.8286 8.32335C25.0696 7.53956 24.3356 6.80563 23.5521 7.04659Z" fill="currentColor" />
  </svg>
}

export function ArkmeComposerSendButton({ ariaLabel, disabled, onClick }: {
  ariaLabel: string
  disabled: boolean
  onClick: () => void
}) {
  const buttonDisabled = disabled === true
  return <button
    type="button"
    style={{
      ...arkmeComposerSendButtonStyle,
      ...(buttonDisabled ? arkmeComposerSendButtonDisabledStyle : {}),
    }}
    disabled={buttonDisabled}
    aria-label={ariaLabel}
    onMouseDown={(event: MouseEvent<HTMLButtonElement>) => { event.preventDefault() }}
    onMouseEnter={event => {
      if (!event.currentTarget.disabled) {
        event.currentTarget.style.background = SEND_BACKGROUND_HOVER
      }
    }}
    onMouseLeave={event => {
      if (!event.currentTarget.disabled) event.currentTarget.style.background = SEND_BACKGROUND
    }}
    onClick={onClick}
  >
    <ArkmeComposerSendIcon />
  </button>
}
