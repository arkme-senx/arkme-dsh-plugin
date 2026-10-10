import type { CSSProperties } from 'react'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { arkmeTheme } from './arkme-theme.js'

const ARKME_MESSAGE_SELECT_HIT_SIZE = 32
const ARKME_MESSAGE_SELECT_GAP = 10
const ARKME_MESSAGE_SELECT_AVATAR_OFFSET = 1
const ARKME_MESSAGE_SELECT_CARD_RAIL_SIZE = 42

export const messageSelectionStyles = {
  rowSelectAvatarMode: {
    display: 'grid', gridTemplateColumns: `${ARKME_MESSAGE_SELECT_HIT_SIZE}px minmax(0, 1fr)`, alignItems: 'start', columnGap: ARKME_MESSAGE_SELECT_GAP,
    marginBottom: 18, paddingLeft: 6, boxSizing: 'border-box', cursor: 'pointer',
  },
  rowSelectCardCenterMode: {
    display: 'grid', gridTemplateColumns: `${ARKME_MESSAGE_SELECT_CARD_RAIL_SIZE}px minmax(0, 1fr) ${ARKME_MESSAGE_SELECT_CARD_RAIL_SIZE}px`,
    alignItems: 'center', marginBottom: 42, cursor: 'pointer',
  },
  rowSelectedForAction: { background: arkmeTheme.active },
  selectCheck: {
    width: ARKME_MESSAGE_SELECT_HIT_SIZE, height: ARKME_MESSAGE_SELECT_HIT_SIZE, display: 'grid', placeItems: 'center', border: 0, padding: 0,
    borderRadius: 999, background: 'transparent', color: arkmeTheme.foreground, cursor: 'pointer',
  },
  selectCheckAvatar: { justifySelf: 'center', marginTop: ARKME_MESSAGE_SELECT_AVATAR_OFFSET },
  selectCheckCardCenter: { justifySelf: 'center' },
  selectCheckCircle: {
    width: 22, height: 22, display: 'grid', placeItems: 'center', boxSizing: 'border-box',
    borderWidth: 1.5, borderStyle: 'solid', borderColor: arkmeTheme.tertiary, borderRadius: 999, background: 'transparent',
    color: arkmeTheme.foreground,
  },
  selectCheckActive: { borderColor: arkmeTheme.accent, background: arkmeTheme.accent },
  selectBar: {
    flex: 'none', minHeight: 72, display: 'flex',
    alignItems: 'center', justifyContent: 'center', gap: 'clamp(6px, 1.7vw, 18px)', padding: '7px clamp(8px, 3vw, 16px)', boxSizing: 'border-box',
    borderTop: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.layer2,
  },
  selectBarButton: {
    width: 'clamp(44px, 6vw, 54px)', minWidth: 0, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
    border: 0, padding: 0, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', fontSize: 11,
  },
  selectBarButtonDisabled: { opacity: .38, cursor: 'default' },
  selectBarIconTile: {
    width: 'clamp(30px, 3.8vw, 34px)', height: 'clamp(30px, 3.8vw, 34px)', display: 'grid', placeItems: 'center', borderRadius: 7, background: arkmeTheme.elevated,
    color: arkmeTheme.text, boxShadow: 'none',
  },
  selectBarLabel: { lineHeight: '15px', whiteSpace: 'nowrap' },
} satisfies Record<string, CSSProperties>

export function ArkmeMessageSelectionControl(props: {
  anchor: 'avatar' | 'card-center'
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return <button
    type="button"
    role="checkbox"
    data-arkme-select-check="true"
    data-arkme-selection-anchor={props.anchor}
    aria-checked={props.checked}
    aria-label={props.checked ? '取消选择消息' : '选择消息'}
    disabled={props.disabled}
    style={{
      ...messageSelectionStyles.selectCheck,
      ...(props.anchor === 'avatar' ? messageSelectionStyles.selectCheckAvatar : messageSelectionStyles.selectCheckCardCenter),
      opacity: props.disabled ? .35 : 1,
    }}
    onClick={event => { event.stopPropagation(); props.onToggle() }}
  ><span style={{
      ...messageSelectionStyles.selectCheckCircle,
      ...(props.checked ? messageSelectionStyles.selectCheckActive : {}),
    }}>
      {props.checked ? <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3.08 7.08L5.9 9.82L10.92 4.18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg> : null}
    </span></button>
}

export function ArkmeSelectActionIcon({ kind, size = 22 }: { kind: 'assign' | 'copy' | 'link' | 'select' | 'forward' | 'close'; size?: number }) {
  // Flutter assets/images/record_func_assign_topic.svg.
  if (kind === 'assign') return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path fillRule="evenodd" clipRule="evenodd" d="M12.6 2.5H7.4C6.25514 2.5 5.48671 2.50117 4.89496 2.54952C4.32071 2.59643 4.04615 2.6802 3.86502 2.77248C3.39462 3.01217 3.01217 3.39462 2.77248 3.86502C2.6802 4.04615 2.59643 4.32071 2.54952 4.89496C2.50117 5.48671 2.5 6.25514 2.5 7.4V15.8754C2.5 16.283 2.50033 16.5407 2.50855 16.7322C2.5139 16.8568 2.52154 16.9115 2.52348 16.9248C2.59801 17.1596 2.83292 17.3052 3.07637 17.2675C3.08914 17.2633 3.14151 17.2459 3.25551 17.1952C3.43068 17.1174 3.66164 17.003 4.02666 16.8217L4.05608 16.8071C4.20179 16.7347 4.33028 16.6708 4.46463 16.6145C4.92599 16.4211 5.41636 16.306 5.91557 16.274C6.06095 16.2646 6.20444 16.2647 6.36718 16.2647L6.4 16.2647H9.04451C9.10561 16.7861 9.22841 17.2886 9.40541 17.7647H6.4C6.2052 17.7647 6.1078 17.7647 6.01173 17.7709C5.67893 17.7923 5.35201 17.869 5.04444 17.9979C4.95566 18.0351 4.86843 18.0784 4.69396 18.1651C3.98787 18.5158 3.63482 18.6912 3.35471 18.7417C2.34708 18.9233 1.36504 18.3145 1.07941 17.3313C1 17.058 1 16.6638 1 15.8754V7.4C1 5.15979 1 4.03969 1.43597 3.18404C1.81947 2.43139 2.43139 1.81947 3.18404 1.43597C4.03969 1 5.15979 1 7.4 1H12.6C14.8402 1 15.9603 1 16.816 1.43597C17.5686 1.81947 18.1805 2.43139 18.564 3.18404C19 4.03969 19 5.15979 19 7.4V10.0218C18.5368 9.72526 18.0335 9.48584 17.5 9.3135V7.4C17.5 6.25514 17.4988 5.48671 17.4505 4.89496C17.4036 4.32071 17.3198 4.04615 17.2275 3.86502C16.9878 3.39462 16.6054 3.01217 16.135 2.77248C15.9539 2.6802 15.6793 2.59643 15.105 2.54952C14.5133 2.50117 13.7449 2.5 12.6 2.5ZM10.75 11.0629V7.75H12C12.4142 7.75 12.75 7.41421 12.75 7C12.75 6.58579 12.4142 6.25 12 6.25H10H8C7.58579 6.25 7.25 6.58579 7.25 7C7.25 7.41421 7.58579 7.75 8 7.75H9.25V12.5C9.25 12.7128 9.33865 12.905 9.48104 13.0415C9.78235 12.3046 10.215 11.6353 10.75 11.0629Z" fill="currentColor"/>
    <path d="M15 18.5V12.5M15 12.5L13 14M15 12.5L17 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
  if (kind === 'copy') return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M12.4998 0.916504C13.3618 0.916504 14.1884 1.25891 14.7979 1.86841C15.4074 2.4779 15.7498 3.30455 15.7498 4.1665V4.24984H15.8332C16.6772 4.24984 17.4882 4.57822 18.0944 5.1655C18.7007 5.75278 19.0547 6.55287 19.0815 7.3965L19.0832 7.49984V15.8332C19.0832 16.6772 18.7548 17.4882 18.1675 18.0944C17.5802 18.7007 16.7801 19.0547 15.9365 19.0815L15.8332 19.0832H7.49984C6.65578 19.0832 5.84483 18.7548 5.23858 18.1675C4.63233 17.5802 4.27834 16.7801 4.2515 15.9365L4.24984 15.8332V15.7498H4.1665C3.32245 15.7498 2.5115 15.4214 1.90525 14.8342C1.299 14.2469 0.945007 13.4468 0.918171 12.6032L0.916504 12.4998V4.1665C0.916504 3.30455 1.25891 2.4779 1.86841 1.86841C2.4779 1.25891 3.30455 0.916504 4.1665 0.916504H12.4998ZM15.7498 12.4998C15.7498 13.3618 15.4074 14.1884 14.7979 14.7979C14.1884 15.4074 13.3618 15.7498 12.4998 15.7498H5.74984V15.8332C5.74981 16.2822 5.92236 16.714 6.23181 17.0393C6.54125 17.3647 6.9639 17.5586 7.41234 17.5811L7.49984 17.5832H15.8332C16.2822 17.5832 16.714 17.4106 17.0393 17.1012C17.3647 16.7918 17.5586 16.3691 17.5811 15.9207L17.5832 15.8332V7.49984C17.5832 7.05084 17.4106 6.61901 17.1012 6.29367C16.7918 5.96833 16.3691 5.77437 15.9207 5.75192L15.8332 5.74984H15.7498V12.4998ZM12.4998 2.4165H4.1665C3.70237 2.4165 3.25726 2.60088 2.92907 2.92907C2.60088 3.25726 2.4165 3.70237 2.4165 4.1665V12.4998C2.4165 12.7297 2.46177 12.9572 2.54971 13.1695C2.63766 13.3819 2.76656 13.5748 2.92907 13.7373C3.09157 13.8998 3.28449 14.0287 3.49681 14.1166C3.70913 14.2046 3.93669 14.2498 4.1665 14.2498H12.4998C12.7297 14.2498 12.9572 14.2046 13.1695 14.1166C13.3819 14.0287 13.5748 13.8998 13.7373 13.7373C13.8998 13.5748 14.0287 13.3819 14.1166 13.1695C14.2046 12.9572 14.2498 12.7297 14.2498 12.4998V4.1665C14.2498 3.93669 14.2046 3.70913 14.1166 3.49681C14.0287 3.28449 13.8998 3.09157 13.7373 2.92907C13.5748 2.76656 13.3819 2.63766 13.1695 2.54971C12.9572 2.46177 12.7297 2.4165 12.4998 2.4165Z" fill="currentColor" />
  </svg>
  if (kind === 'link') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M13.06 10.9399C15.31 13.1899 15.31 16.8299 13.06 19.0699C10.81 21.3099 7.17003 21.3199 4.93003 19.0699C2.69003 16.8199 2.68003 13.1799 4.93003 10.9399" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.59 13.41C8.25002 11.07 8.25002 7.27001 10.59 4.92001C12.93 2.57001 16.73 2.58001 19.08 4.92001C21.43 7.26001 21.42 11.06 19.08 13.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  if (kind === 'select') return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path fillRule="evenodd" clipRule="evenodd" d="M2.58997 5.26183C2.77832 5.45018 3.0236 5.54435 3.27108 5.54435C3.51855 5.54435 3.76603 5.45018 3.95437 5.26183L6.56929 2.64473C6.94598 2.26804 6.94598 1.6592 6.56929 1.28252C6.1926 0.905828 5.58377 0.905828 5.20708 1.28252L3.27108 3.21852L2.64473 2.59216C2.26804 2.21548 1.6592 2.21548 1.28252 2.59216C0.905828 2.96885 0.905828 3.57769 1.28252 3.95437L2.58997 5.26183ZM2.58997 11.9897C2.76956 12.1714 3.01484 12.2722 3.27108 12.2722C3.52731 12.2722 3.7726 12.1714 3.95218 11.9897L6.56929 9.37255C6.94598 8.99586 6.94598 8.38703 6.56929 8.01034C6.1926 7.63365 5.58377 7.63365 5.20708 8.01034L3.27108 9.94634L2.64473 9.31999C2.26804 8.9433 1.6592 8.9433 1.28252 9.31999C0.905828 9.69668 0.905828 10.3055 1.28252 10.6822L2.58997 11.9897ZM2.58997 18.7175C2.76956 18.8993 3.01484 19 3.27108 19C3.52731 19 3.7726 18.8993 3.95218 18.7175L6.56929 16.1004C6.94598 15.7237 6.94598 15.1149 6.56929 14.7382C6.1926 14.3615 5.58377 14.3615 5.20708 14.7382L3.27108 16.6742L2.64473 16.0478C2.26804 15.6711 1.6592 15.6711 1.28252 16.0478C0.905828 16.4245 0.905828 17.0333 1.28252 17.41L2.58997 18.7175ZM9.98566 18H18.0143C18.5587 18 19 17.5513 19 16.9977C19 16.4442 18.5587 15.9954 18.0143 15.9954H9.98566C9.44131 15.9954 9 16.4442 9 16.9977C9 17.5513 9.44131 18 9.98566 18ZM9.98566 4.00456H18.0143C18.5587 4.00456 19 3.55581 19 3.00228C19 2.44875 18.5587 2 18.0143 2H9.98566C9.44131 2 9 2.44875 9 3.00228C9 3.55581 9.44131 4.00456 9.98566 4.00456ZM9.98566 11.0023H18.0143C18.5587 11.0023 19 10.5535 19 10C19 9.44647 18.5587 8.99772 18.0143 8.99772H9.98566C9.44131 8.99772 9 9.44647 9 10C9 10.5535 9.44131 11.0023 9.98566 11.0023Z" fill="currentColor" />
  </svg>
  if (kind === 'forward') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M7.39993 6.31991L15.8899 3.48991C19.6999 2.21991 21.7699 4.29991 20.5099 8.10991L17.6799 16.5999C15.7799 22.3099 12.6599 22.3099 10.7599 16.5999L9.91993 14.0799L7.39993 13.2399C1.68993 11.3399 1.68993 8.22991 7.39993 6.31991Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.1101 13.6501L13.6901 10.0601" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  return <X size={size} weight="regular" aria-hidden />
}
