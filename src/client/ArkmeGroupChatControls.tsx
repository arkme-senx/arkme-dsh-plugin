import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import qrcode from 'qrcode-generator'
import type {
  ArkmeConversationMemberItem,
  ArkmeConversationMemberList,
  ArkmeGroupActionResult,
  ArkmeGroupMemberAddResult,
  ArkmeGroupBotCandidateList,
  ArkmeGroupMemberCandidate,
  ArkmeGroupMemberCandidateGroup,
  ArkmeGroupMemberCandidateList,
  ArkmeGroupInvitePreview,
  ArkmeGroupNotificationResult,
  ArkmeGroupSettingsSnapshot,
  ArkmeSourceItem,
} from '../types.js'
import { callArkme } from './api.js'
import { loadArkmeImageDataUrl } from './ArkmeAvatar.js'
import { ArkmeMark } from './ArkmeFooterAction.js'
import { arkmeTheme } from './arkme-theme.js'

const colors = {
  panel: arkmeTheme.layer2,
  subtle: arkmeTheme.subtle,
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  border: arkmeTheme.border,
  primary: arkmeTheme.info,
}

export const ARKME_GROUP_HEADER_ICON_COLOR = arkmeTheme.secondary

const asset = (value: string) => `data:image/svg+xml;base64,${value}`
// These are the production desktop-client assets, embedded so the published plugin remains self-contained.
const icons = {
  rename: asset('PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTguODAwNzggMS42MDAxSDEwLjAwMDhNMTAuMDAwOCAxLjYwMDFIMTEuMjAwOE0xMC4wMDA4IDEuNjAwMVYxNC40MDAxTTguODAwNzggMTQuNDAwMUgxMS4yMDA4IiBzdHJva2U9IiNEMkQyRDIiIHN0cm9rZS13aWR0aD0iMS4yIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPHBhdGggZD0iTTcuODk5NjEgNEgzLjE5OTYxQzIuMzE1OTUgNCAxLjU5OTYxIDQuNzE2MzQgMS41OTk2MSA1LjZWMTAuNEMxLjU5OTYxIDExLjI4MzcgMi4zMTU5NSAxMiAzLjE5OTYxIDEySDcuODk5NjFNMTEuOTk5NiA0SDEyLjc5OTZDMTMuNjgzMyA0IDE0LjM5OTYgNC43MTYzNCAxNC4zOTk2IDUuNlYxMC40QzE0LjM5OTYgMTEuMjgzNyAxMy42ODMzIDEyIDEyLjc5OTYgMTJIMTEuOTk5NiIgc3Ryb2tlPSIjRDJEMkQyIiBzdHJva2Utd2lkdGg9IjEuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CjxwYXRoIGQ9Ik00LjgwMDc4IDhMNi40MDA3OCA4IiBzdHJva2U9IiNEMkQyRDIiIHN0cm9rZS13aWR0aD0iMS4yIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPC9zdmc+Cg=='),
  exit: asset('PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMSIgaGVpZ2h0PSIyMCIgdmlld0JveD0iMCAwIDIxIDIwIiBmaWxsPSJub25lIj4KPHBhdGggZD0iTTMuNSA3VjRDMy41IDMuNDQ3NzIgMy45NDc3MiAzIDQuNSAzSDcuNSIgc3Ryb2tlPSIjRDJEMkQyIiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CjxwYXRoIGQ9Ik0zLjUgMTNWMTZDMy41IDE2LjU1MjMgMy45NDc3MiAxNyA0LjUgMTdINy41IiBzdHJva2U9IiNEMkQyRDIiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPHBhdGggZD0iTTE3LjUgN1Y0QzE3LjUgMy40NDc3MiAxNy4wNTIzIDMgMTYuNSAzSDEzLjUiIHN0cm9rZT0iI0QyRDJEMiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8cGF0aCBkPSJNMTcuNSAxM0wxNS41IDE1TDEzLjUgMTciIHN0cm9rZT0iI0QyRDJEMiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8cGF0aCBkPSJNMTMuNSAxM0wxNS41IDE1TDE3LjUgMTciIHN0cm9rZT0iI0QyRDJEMiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8L3N2Zz4='),
  notice: asset('PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgdmlld0JveD0iMCAwIDIwIDIwIiBmaWxsPSJub25lIj4KPHBhdGggZD0iTTEwLjAxNzUgMi40MjQ4QzcuMjU5MTQgMi40MjQ4IDUuMDE3NDcgNC42NjY0NyA1LjAxNzQ3IDcuNDI0OFY5LjgzMzE0QzUuMDE3NDcgMTAuMzQxNSA0LjgwMDgxIDExLjExNjUgNC41NDI0NyAxMS41NDk4TDMuNTg0MTQgMTMuMTQxNUMyLjk5MjQ3IDE0LjEyNDggMy40MDA4MSAxNS4yMTY1IDQuNDg0MTQgMTUuNTgzMUM4LjA3NTgxIDE2Ljc4MzEgMTEuOTUwOCAxNi43ODMxIDE1LjU0MjUgMTUuNTgzMUMxNi41NTA4IDE1LjI0OTggMTYuOTkyNSAxNC4wNTgxIDE2LjQ0MjUgMTMuMTQxNUwxNS40ODQxIDExLjU0OThDMTUuMjM0MSAxMS4xMTY1IDE1LjAxNzUgMTAuMzQxNSAxNS4wMTc1IDkuODMzMTRWNy40MjQ4QzE1LjAxNzUgNC42NzQ4IDEyLjc2NzUgMi40MjQ4IDEwLjAxNzUgMi40MjQ4WiIgc3Ryb2tlPSIjRDJEMkQyIiBzdHJva2Utd2lkdGg9IjEuNCIgc3Ryb2tlLW1pdGVybGltaXQ9IjEwIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPHBhdGggZD0iTTExLjU1OTkgMi42NjcxOUMxMS4zMDE2IDIuNTkyMTkgMTEuMDM0OSAyLjUzMzg1IDEwLjc1OTkgMi41MDA1MkM5Ljk1OTkgMi40MDA1MiA5LjE5MzIzIDIuNDU4ODUgOC40NzY1NiAyLjY2NzE5QzguNzE4MjMgMi4wNTA1MiA5LjMxODIzIDEuNjE3MTkgMTAuMDE4MiAxLjYxNzE5QzEwLjcxODIgMS42MTcxOSAxMS4zMTgyIDIuMDUwNTIgMTEuNTU5OSAyLjY2NzE5WiIgc3Ryb2tlPSIjRDJEMkQyIiBzdHJva2Utd2lkdGg9IjEuMjUiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CjxwYXRoIGQ9Ik0xMi41MTU2IDE1Ljg4MjhDMTIuNTE1NiAxNy4yNTc4IDExLjM5MDYgMTguMzgyOCAxMC4wMTU2IDE4LjM4MjhDOS4zMzIyOSAxOC4zODI4IDguNjk4OTYgMTguMDk5NSA4LjI0ODk2IDE3LjY0OTVDNy43OTg5NiAxNy4xOTk1IDcuNTE1NjIgMTYuNTY2MSA3LjUxNTYyIDE1Ljg4MjgiIHN0cm9rZT0iI0QyRDJEMiIgc3Ryb2tlLXdpZHRoPSIxLjI1IiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiLz4KPC9zdmc+'),
  members: asset('PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyLjY5MzQgMi41QzE0Ljk5NDIgMi41MDAzNSAxNi44NTk0IDQuMzY2MDIgMTYuODU5NCA2LjY2Njk5QzE2Ljg1OTMgNy44OTY2NSAxNi4zMjU4IDkuMDAxMDYgMTUuNDc4NSA5Ljc2MzY3QzE1LjQ3NDEgOS43Njc2OCAxNS40NzUxIDkuNzc0ODEgMTUuNDgwNSA5Ljc3NzM0QzE3Ljc3IDEwLjgzMjcgMTkuMzYwMiAxMy4xNDc2IDE5LjM2MDQgMTUuODM0QzE5LjM2MDIgMTYuMjkzOSAxOC45ODYyIDE2LjY2NzYgMTguNTI2NCAxNi42NjhINi44NjAzNUM2LjQwMDIyIDE2LjY2OCA2LjAyNjU0IDE2LjI5NDEgNi4wMjYzNyAxNS44MzRDNi4wMjY1IDEzLjE0NzMgNy42MTYyOCAxMC44MzI2IDkuOTA2MjUgOS43NzczNEM5LjkxMTY2IDkuNzc0ODEgOS45MTI2NSA5Ljc2NzY4IDkuOTA4MiA5Ljc2MzY3QzkuMDYwNjIgOS4wMDEwNCA4LjUyNjQ2IDcuODk2OTEgOC41MjYzNyA2LjY2Njk5QzguNTI2MzcgNC4zNjU4MSAxMC4zOTIyIDIuNSAxMi42OTM0IDIuNVpNNi43NTk3NyA1QzYuOTU2ODYgNS4wMDAwNiA3LjE0OTcgNS4wMTg0MSA3LjMzNjkxIDUuMDUyNzNDNy4zMDAxMiA1LjMwNzU5IDcuMjc5MzEgNS41Njc5NyA3LjI3OTMgNS44MzMwMUM3LjI3OTMgNi4wMDkyMyA3LjI5MTE0IDYuMTgzNTMgNy4zMDc2MiA2LjM1NTQ3QzcuMTMzNDMgNi4zMDMxNCA2Ljk0ODk2IDYuMjc0NTEgNi43NTc4MSA2LjI3NDQxQzUuNzAyMTMgNi4yNzQ2IDQuODQ2NjggNy4xMzA4IDQuODQ2NjggOC4xODY1MkM0Ljg0Njg1IDkuMTU0MjggNS41NjU5NSA5Ljk1MDY5IDYuNDk5MDIgMTAuMDc3MUM2LjEzNTEgMTAuNTM0NiA1LjgyMjEyIDExLjAzMzUgNS41NjU0MyAxMS41NjU0QzQuMjU2MTcgMTEuOTk2NSAzLjI1OTE1IDEzLjExMzggMy4wMDI5MyAxNC40OTMyTDIuOTkyMTkgMTQuNTU4Nkg0Ljc5Mjk3QzQuNzg0OTQgMTQuNzA0NyA0Ljc3OTMgMTQuODUxOSA0Ljc3OTMgMTVDNC43NzkzIDE1LjI5NjMgNC44NDI1NiAxNS41Nzc4IDQuOTU0MSAxNS44MzNIMi4zMDA3OEMxLjk0OTAzIDE1LjgzMjggMS42NjQwNiAxNS41NDcxIDEuNjY0MDYgMTUuMTk1M0MxLjY2NDIxIDEzLjEzNjkgMi44ODQyOCAxMS4zNjQ0IDQuNjQwNjIgMTAuNTU5NkMzLjk4NzM5IDkuOTc2MjYgMy41NzMzMSA5LjEzMTIzIDMuNTczMjQgOC4xODY1MkMzLjU3MzI0IDYuNDI2NzkgNS4wMDAwMyA1IDYuNzU5NzcgNVpNMTIuNjkzNCAzLjc1QzExLjA4MjUgMy43NSA5Ljc3NjM3IDUuMDU2MTYgOS43NzYzNyA2LjY2Njk5QzkuNzc2NDUgNy40NzMwNyAxMC4xMDM0IDguMjAxNSAxMC42MzU3IDguNzMxNDVMMTAuNzQ0MSA4LjgzNDk2QzExLjQxODEgOS40NDEyOSAxMS4yNDg2IDEwLjUzNTYgMTAuNDI5NyAxMC45MTMxQzguNjg1NTcgMTEuNzE2OCA3LjQ0NDIzIDEzLjQxNiA3LjI5MTk5IDE1LjQxOEgxOC4wOTQ3QzE3Ljk0MjQgMTMuNDE2NCAxNi43MDA5IDExLjcxNyAxNC45NTcgMTAuOTEzMUMxNC4xMzgzIDEwLjUzNTcgMTMuOTY4MiA5LjQ0MTM1IDE0LjY0MTYgOC44MzQ5NkMxNS4yMzczIDguMjk4ODQgMTUuNjA5MyA3LjUyNjk1IDE1LjYwOTQgNi42NjY5OUMxNS42MDk0IDUuMDU2MjUgMTQuMzAzOCAzLjc1MDM1IDEyLjY5MzQgMy43NVoiIGZpbGw9IiNEMkQyRDIiLz4KPC9zdmc+Cg=='),
  more: asset('PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIj4KPGNpcmNsZSBjeD0iNiIgY3k9IjEyIiByPSIyIiBmaWxsPSIjMkIyQjJCIi8+CjxjaXJjbGUgY3g9IjEzIiBjeT0iMTIiIHI9IjIiIGZpbGw9IiMyQjJCMkIiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxMiIgcj0iMiIgZmlsbD0iIzJCMkIyQjIiLz4KPC9zdmc+'),
}

const styles: Record<string, CSSProperties> = {
  headerActions: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 },
  headerButton: {
    width: 32, height: 32, padding: 4, border: 0, borderRadius: 4, background: 'transparent',
    color: ARKME_GROUP_HEADER_ICON_COLOR, display: 'grid', placeItems: 'center', cursor: 'pointer',
  },
  icon: {
    width: 20, height: 20, display: 'block', backgroundColor: 'currentColor', opacity: .84,
    maskRepeat: 'no-repeat', maskPosition: 'center', maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', WebkitMaskSize: 'contain',
  },
  drawer: {
    position: 'absolute', top: 68, right: 0, bottom: 0, zIndex: 8, width: 262, maxWidth: '86%',
    display: 'flex', flexDirection: 'column', background: colors.panel,
    boxShadow: '0 4px 10px rgba(0,0,0,.1)',
  },
  drawerHeader: {
    flex: 'none', height: 54, display: 'flex', alignItems: 'center',
    padding: '0 10px', boxSizing: 'border-box',
  },
  drawerTitle: { margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 600, color: colors.text },
  closeButton: {
    width: 30, height: 30, border: 0, borderRadius: 4, background: 'transparent',
    color: colors.secondary, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 20,
  },
  drawerBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 18px' },
  memberRow: {
    width: '100%', border: 0, background: 'transparent', borderRadius: 8, padding: '12px 6px',
    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', color: colors.text, cursor: 'pointer',
  },
  avatar: {
    width: 32, height: 32, borderRadius: 999, overflow: 'hidden', flex: 'none',
    display: 'grid', placeItems: 'center', background: colors.subtle, color: colors.secondary,
  },
  avatarImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  memberMain: { minWidth: 0, flex: 1 },
  memberNameLine: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  memberName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '20px' },
  badge: { flex: 'none', color: colors.primary, fontSize: 11, lineHeight: '16px' },
  empty: { padding: '38px 18px', color: colors.secondary, fontSize: 13, textAlign: 'center' },
  loading: { padding: '14px 16px', color: colors.secondary, fontSize: 13, textAlign: 'center' },
  menuScrim: { position: 'absolute', inset: 0, zIndex: 9 },
  popover: {
    position: 'absolute', zIndex: 10, width: 181, padding: '6px 8px',
    borderRadius: 4, background: colors.panel, boxShadow: '0 4px 10px rgba(0,0,0,.1)', boxSizing: 'border-box',
  },
  menuRow: {
    width: '100%', height: 32, border: 0, borderRadius: 4, background: 'transparent', padding: '2px 8px',
    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', color: colors.text,
    cursor: 'pointer', fontSize: 14, lineHeight: '20px', whiteSpace: 'nowrap', boxSizing: 'border-box',
  },
  switch: {
    marginLeft: 'auto', width: 40, height: 22, border: 0, borderRadius: 999, padding: 2,
    display: 'flex', alignItems: 'center', cursor: 'pointer', transition: 'background .15s ease',
  },
  switchThumb: {
    width: 18, height: 18, borderRadius: 999, background: arkmeTheme.foreground, boxShadow: '0 1px 2px rgba(0,0,0,.14)',
    transition: 'transform .15s ease',
  },
  dialogScrim: {
    position: 'absolute', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center',
    background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,.18))', padding: 20,
  },
  dialog: {
    width: 420, maxWidth: '100%', padding: 16, borderRadius: 12, background: colors.panel,
    boxShadow: '0 12px 40px rgba(0,0,0,.18)', boxSizing: 'border-box',
  },
  dialogTitle: { margin: '0 0 14px', fontSize: 16, lineHeight: '22px', fontWeight: 600, color: colors.text },
  dialogInput: {
    width: '100%', height: 38, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '0 10px',
    outline: 0, color: colors.text, background: colors.panel, fontSize: 14, boxSizing: 'border-box',
  },
  dialogActions: { marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 },
  dialogButton: { height: 34, border: 0, borderRadius: 8, padding: '0 16px', cursor: 'pointer', fontSize: 14 },
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function roleLabel(member: Pick<ArkmeConversationMemberItem, 'role'>): string {
  if (member.role === 'owner') return '发起人'
  if (member.role === 'admin') return '管理员'
  return ''
}

function ClientIcon({ src, size = 20 }: { src: string; size?: number }) {
  return <span aria-hidden style={{
    ...styles.icon, width: size, height: size,
    maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")`,
  }} />
}

function MoreIcon() {
  return <svg aria-hidden width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
    <circle cx="5" cy="12" r="1.8" fill="currentColor" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    <circle cx="19" cy="12" r="1.8" fill="currentColor" />
  </svg>
}

function IconButton(props: {
  label: string
  children: ReactNode
  buttonRef?: RefObject<HTMLButtonElement>
  onClick: () => void
}) {
  return <button
    ref={props.buttonRef}
    type="button"
    aria-label={props.label}
    title={props.label}
    style={styles.headerButton}
    onMouseEnter={event => { event.currentTarget.style.background = colors.subtle }}
    onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
    onClick={props.onClick}
  >{props.children}</button>
}

function Avatar({ imageRef, size = 32 }: { imageRef: string | undefined; size?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    setSrc('')
    if (imageRef === undefined) return () => { active = false }
    void loadArkmeImageDataUrl(imageRef)
      .then(value => { if (active) setSrc(value) })
      .catch(() => undefined)
    return () => { active = false }
  }, [imageRef])
  return <span style={{ ...styles.avatar, width: size, height: size }}>
    {src === '' ? <ArkmeMark size={size} /> : <img src={src} alt="" draggable={false} style={styles.avatarImage} />}
  </span>
}

function GroupMembersDrawer(props: {
  source: ArkmeSourceItem
  open: boolean
  refreshToken: number
  onClose: () => void
  onAdd: () => void
  onMemberOpen: (member: ArkmeConversationMemberItem) => void
  onMemberContextMenu: (member: ArkmeConversationMemberItem, anchorRect: DOMRect) => void
  onSettingsLoaded: (settings: Pick<ArkmeGroupSettingsSnapshot, 'selfRole' | 'selfStatus'>) => void
  onError: (message: string) => void
}) {
  const [snapshot, setSnapshot] = useState<ArkmeConversationMemberList>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!props.open) return
    const controller = new AbortController()
    setLoading(true)
    void callArkme<ArkmeConversationMemberList>('source.members', {
      sourceRef: props.source.sourceRef,
      activeOnly: true,
    }, controller.signal)
      .then(value => {
        setSnapshot(value)
        const self = value.items.find(member => member.isSelf)
        if (self !== undefined) props.onSettingsLoaded({ selfRole: self.role, selfStatus: self.status })
      })
      .catch(caught => { props.onError(errorMessage(caught)) })
      .finally(() => { setLoading(false) })
    return () => { controller.abort() }
  }, [props.open, props.refreshToken, props.source.sourceRef])

  if (!props.open) return null
  const items = snapshot?.items ?? []
  return <aside style={styles.drawer} aria-label="协作者">
    <div style={styles.drawerHeader}>
      <h3 style={{ ...styles.drawerTitle, fontSize: 16, fontWeight: 400 }}>协作者{snapshot === undefined ? '' : `（${snapshot.activeCount}）`}</h3>
      <span style={{ flex: 1 }} />
      <button type="button" style={{ ...styles.closeButton, width: 'auto', padding: '0 6px', fontSize: 14, fontWeight: 700, color: colors.primary }} onClick={props.onAdd}>添加</button>
    </div>
    <div style={styles.drawerBody}>
      {loading && items.length === 0 ? <div style={styles.loading}>正在读取群成员…</div> : null}
      {!loading && items.length === 0 ? <div style={styles.empty}>暂无群成员</div> : null}
      {items.map(member => {
        const badge = roleLabel(member)
        return <button
          key={member.memberRef}
          type="button"
          style={styles.memberRow}
          onMouseEnter={event => {
            event.currentTarget.style.background = colors.subtle
          }}
          onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
          onClick={() => { props.onMemberOpen(member) }}
          onContextMenu={event => {
            event.preventDefault()
            const avatar = event.currentTarget.querySelector('[data-arkme-member-avatar]')
            props.onMemberContextMenu(member, (avatar ?? event.currentTarget).getBoundingClientRect())
          }}
        >
          <span data-arkme-member-avatar="true"><Avatar imageRef={member.avatarRef} /></span>
          <span style={styles.memberMain}>
            <span style={styles.memberNameLine}>
              <span style={styles.memberName}>{member.displayName}{member.isSelf ? '（我）' : ''}</span>
              {badge !== '' && <span style={styles.badge}>{badge}</span>}
            </span>
            <span style={{ display: 'block', fontSize: 12, lineHeight: '16px', color: colors.secondary }}>{member.recordCount}条快记</span>
          </span>
        </button>
      })}
    </div>
  </aside>
}

function qrDataUrl(content: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(content)
  qr.make()
  return qr.createDataURL(6, 0)
}

function inviteExpireText(expireAtMillis: number): string {
  if (expireAtMillis <= 0) return '二维码有效期24小时'
  const date = new Date(expireAtMillis)
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getFullYear() === new Date().getFullYear() ? '' : `${String(date.getFullYear())}-`
  return `二维码有效期至 ${year}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function InviteActionIcon({ kind }: { kind: 'copy' | 'save' | 'add' }) {
  if (kind === 'copy') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M16 12.9V17.1C16 20.6 14.6 22 11.1 22H6.9C3.4 22 2 20.6 2 17.1V12.9C2 9.4 3.4 8 6.9 8H11.1C14.6 8 16 9.4 16 12.9Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M22 6.9V11.1C22 14.6 20.6 16 17.1 16H16V12.9C16 9.4 14.6 8 11.1 8H8V6.9C8 3.4 9.4 2 12.9 2H17.1C20.6 2 22 3.4 22 6.9Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  if (kind === 'save') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
    <path d="M12 8.5V14.5M9 12.5L12 15.5L15 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path fillRule="evenodd" clipRule="evenodd" d="M12 4.5C10.067 4.5 8.5 6.067 8.5 8C8.5 9.933 10.067 11.5 12 11.5C13.933 11.5 15.5 9.933 15.5 8C15.5 6.067 13.933 4.5 12 4.5ZM7 8C7 5.23858 9.23858 3 12 3C14.7614 3 17 5.23858 17 8C17 9.88174 15.9605 11.5207 14.4244 12.3739C15.1087 12.5913 15.753 12.8982 16.3437 13.2808C15.7833 13.4775 15.2686 13.7712 14.8196 14.1417C13.9667 13.7305 13.0103 13.5 12 13.5C8.57838 13.5 5.77426 16.1438 5.51894 19.5H13.2289C13.4005 20.0464 13.6634 20.5523 13.9996 21H5C4.44772 21 4 20.5523 4 20C4 16.4269 6.34252 13.4009 9.5756 12.3739C8.03951 11.5207 7 9.88174 7 8Z" fill="currentColor" />
    <path d="M18 16V20M20 18H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
}

function InviteSavingSpinner() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.8" />
    <path d="M12 3.5A8.5 8.5 0 0 1 20.5 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".75s" repeatCount="indefinite" />
    </path>
  </svg>
}

function CloseGlyph() {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden style={{ display: 'block' }}>
    <path d="M1.0804 2.81662C.59579 2.33201.59579 1.5463 1.0804 1.06169C1.56501.57708 2.35072.57708 2.83533 1.06169L8.14213 6.36849L13.4489 1.06169C13.9335.57708 14.7193.57708 15.2039 1.06169C15.6885 1.5463 15.6885 2.33201 15.2039 2.81662L9.89707 8.12342L15.2225 13.4489C15.7071 13.9335 15.7071 14.7192 15.2225 15.2038C14.7379 15.6884 13.9522 15.6884 13.4676 15.2038L8.14213 9.87835L2.81666 15.2038C2.33205 15.6884 1.54634 15.6884 1.06173 15.2038C.57712 14.7192.57712 13.9335 1.06173 13.4489L6.3872 8.12342L1.0804 2.81662Z" fill="currentColor" />
  </svg>
}

function AddMembersDrawer(props: {
  source: ArkmeSourceItem
  open: boolean
  onClose: () => void
  onAdded: () => void
  onError: (message: string) => void
}) {
  type Focus = 'all' | 'group' | 'privateChat' | 'bot'
  const [query, setQuery] = useState('')
  const [snapshot, setSnapshot] = useState<ArkmeGroupMemberCandidateList>()
  const [groups, setGroups] = useState<ArkmeSourceItem[]>([])
  const [groupCandidates, setGroupCandidates] = useState<Record<string, ArkmeGroupMemberCandidateGroup>>({})
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [loadingGroups, setLoadingGroups] = useState<string[]>([])
  const [bots, setBots] = useState<ArkmeGroupBotCandidateList>()
  const [focus, setFocus] = useState<Focus>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [selectedBots, setSelectedBots] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [searchingGroups, setSearchingGroups] = useState(false)
  const [busy, setBusy] = useState(false)

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const isSearchMode = normalizedQuery !== ''

  useEffect(() => {
    if (!props.open) {
      setQuery('')
      setSnapshot(undefined)
      setGroups([])
      setGroupCandidates({})
      setExpandedGroups([])
      setLoadingGroups([])
      setBots(undefined)
      setFocus('all')
      setSelected([])
      setSelectedBots([])
      setLoading(false)
      setSearchingGroups(false)
      setBusy(false)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setQuery('')
    setSnapshot(undefined)
    setGroups([])
    setGroupCandidates({})
    setExpandedGroups([])
    setLoadingGroups([])
    setBots(undefined)
    setFocus('all')
    setSelected([])
    setSelectedBots([])
    setSearchingGroups(false)
    setBusy(false)
    setLoading(true)
    void Promise.allSettled([
      callArkme<ArkmeGroupMemberCandidateList>('group.member-candidates', {
        sourceRef: props.source.sourceRef, query: '', limit: 50,
      }, controller.signal),
      callArkme<ArkmeGroupBotCandidateList>('group.bots', { sourceRef: props.source.sourceRef }, controller.signal),
    ])
      .then(([peopleResult, botResult]) => {
        if (cancelled) return
        if (peopleResult.status === 'fulfilled') {
          setSnapshot(peopleResult.value)
          setGroups(peopleResult.value.groups)
        } else {
          props.onError(errorMessage(peopleResult.reason))
        }
        if (botResult.status === 'fulfilled') setBots(botResult.value)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [props.open, props.source.sourceRef])

  const mergeGroupCandidates = (items: ArkmeGroupMemberCandidateGroup[]) => {
    setGroupCandidates(current => {
      const next = { ...current }
      for (const item of items) next[item.group.sourceRef] = item
      return next
    })
  }

  const loadGroupMembers = (group: ArkmeSourceItem) => {
    if (busy || loadingGroups.includes(group.sourceRef)) return
    const controller = new AbortController()
    setLoadingGroups(value => [...value, group.sourceRef])
    void callArkme<ArkmeGroupMemberCandidateList>('group.member-candidates', {
      sourceRef: props.source.sourceRef,
      query,
      limit: 50,
      groupSourceRefs: [group.sourceRef],
    }, controller.signal)
      .then(value => {
        setSnapshot(current => current ?? value)
        if (value.groupCandidates.length > 0) mergeGroupCandidates(value.groupCandidates)
      })
      .catch(caught => {
        setGroupCandidates(current => ({
          ...current,
          [group.sourceRef]: {
            group, items: [], total: 0, error: errorMessage(caught),
          },
        }))
      })
      .finally(() => { setLoadingGroups(value => value.filter(ref => ref !== group.sourceRef)) })
  }

  useEffect(() => {
    if (!props.open || groups.length === 0) return
    for (const group of groups.slice(0, 3)) {
      if (groupCandidates[group.sourceRef] === undefined && !loadingGroups.includes(group.sourceRef)) loadGroupMembers(group)
    }
  }, [props.open, groups])

  useEffect(() => {
    if (!props.open || !isSearchMode || groups.length === 0) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setSearchingGroups(true)
      void callArkme<ArkmeGroupMemberCandidateList>('group.member-candidates', {
        sourceRef: props.source.sourceRef,
        query,
        limit: 50,
        groupSourceRefs: groups.map(group => group.sourceRef),
      }, controller.signal)
        .then(value => {
          setSnapshot(value)
          mergeGroupCandidates(value.groupCandidates)
        })
        .catch(caught => { props.onError(errorMessage(caught)) })
        .finally(() => { setSearchingGroups(false) })
    }, 220)
    return () => { clearTimeout(timeout); controller.abort() }
  }, [props.open, props.source.sourceRef, query, groups])

  if (!props.open) return null

  const people = snapshot?.items ?? []
  const botItems = bots?.items ?? []
  const visibleContacts = people.filter(item => item.relation === 'contact')
  const visiblePrivateChats = people.filter(item => item.relation === 'stranger')
  const allGroupMembers = Object.values(groupCandidates).flatMap(group => group.items)
  const groupMemberByRef = new Map<string, ArkmeGroupMemberCandidate>()
  for (const item of allGroupMembers) {
    if (!groupMemberByRef.has(item.candidateRef)) groupMemberByRef.set(item.candidateRef, item)
  }
  const selectedCandidates = [...people, ...groupMemberByRef.values()].filter(item => selected.includes(item.candidateRef))
  const selectedCandidateByRef = new Map(selectedCandidates.map(item => [item.candidateRef, item]))
  const selectedBotItems = botItems.filter(item => selectedBots.includes(item.botRef))
  const visibleGroups = groups.filter(item => normalizedQuery === '' || item.displayName.toLocaleLowerCase().includes(normalizedQuery)
    || (groupCandidates[item.sourceRef]?.items ?? []).some(candidate => candidate.displayName.toLocaleLowerCase().includes(normalizedQuery)))
  const visibleBots = botItems.filter(item => normalizedQuery === '' || item.name.toLocaleLowerCase().includes(normalizedQuery)
    || item.description.toLocaleLowerCase().includes(normalizedQuery))
  const matchedMembers = [...people, ...groupMemberByRef.values()]
    .filter(item => item.displayName.toLocaleLowerCase().includes(normalizedQuery))
    .filter((item, index, values) => values.findIndex(value => value.candidateRef === item.candidateRef) === index)
  const matchedGroups = groups.filter(item => item.displayName.toLocaleLowerCase().includes(normalizedQuery))
  const matchedBots = visibleBots
  const effectiveFocus: Focus = isSearchMode ? 'all' : focus
  const selectedCount = selectedCandidateByRef.size + selectedBots.length
  const showStrangerSection = !isSearchMode && !loading && (effectiveFocus === 'privateChat' || (effectiveFocus === 'all' && visiblePrivateChats.length > 0))
  const focusRows: Array<{ focus: Exclude<Focus, 'all'>; label: string; count: number }> = [
    { focus: 'group', label: '群聊', count: groups.length },
    { focus: 'privateChat', label: '陌生人', count: snapshot?.strangerCount ?? 0 },
    { focus: 'bot', label: 'Bot', count: botItems.length },
  ]
  const focusIcon = (value: Exclude<Focus, 'all'>) => value === 'group'
    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M3.5 19c.5-3.3 2.5-5 5.5-5s5 1.7 5.5 5M16 6.5a3 3 0 0 1 0 5.5M16.5 14c2.2.3 3.6 1.8 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
    : value === 'privateChat'
      ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5"/><path d="M8 11h.01M12 11h.01M16 11h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      : <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 7h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.5"/><path d="M12 3v4M8 13h.01M16 13h.01M8 17h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
  const selector = (checked: boolean, disabled = false) => <span aria-hidden style={{
    width: 20, height: 20, borderRadius: 999, flex: 'none', display: 'grid', placeItems: 'center', boxSizing: 'border-box',
    border: `1px solid ${colors.border}`, background: checked ? (disabled ? colors.subtle : colors.text) : 'transparent', color: '#fff', fontSize: 12,
  }}>{checked ? '✓' : ''}</span>
  const sectionTitle = (label: string) => <div style={{ padding: '12px 4px 4px', color: colors.secondary, fontSize: 12 }}>{label}</div>
  const toggleCandidate = (item: ArkmeGroupMemberCandidate) => {
    if (busy || item.disabled === true) return
    setSelected(value => value.includes(item.candidateRef)
      ? value.filter(ref => ref !== item.candidateRef)
      : [...value, item.candidateRef])
  }
  const candidateRow = (item: ArkmeGroupMemberCandidate, compact = false) => {
    const checked = selected.includes(item.candidateRef)
    const disabled = item.disabled === true
    return <button
      key={item.candidateRef}
      type="button"
      disabled={busy || disabled}
      aria-pressed={checked}
      style={{ ...styles.memberRow, padding: compact ? '7px 2px' : '8px 2px', borderBottom: `1px solid ${colors.border}`, borderRadius: 0, opacity: disabled ? .55 : 1 }}
      onClick={() => { toggleCandidate(item) }}
    >
      <Avatar imageRef={item.avatarRef} size={compact ? 28 : 32} />
      <span style={styles.memberMain}><span style={styles.memberName}>{item.displayName}</span></span>
      {item.statusText !== undefined && item.statusText !== '' ? <span style={{ color: colors.secondary, fontSize: 11 }}>{item.statusText}</span> : null}
      {selector(checked || item.alreadyMember === true, disabled)}
    </button>
  }
  const botRow = (item: typeof botItems[number]) => {
    const disabled = item.installed || bots?.canAddBots === false
    const checked = item.installed || selectedBots.includes(item.botRef)
    return <button
      key={item.botRef}
      type="button"
      disabled={busy || disabled}
      onClick={() => { setSelectedBots(value => checked ? value.filter(ref => ref !== item.botRef) : [...value, item.botRef]) }}
      style={{ ...styles.memberRow, padding: '8px 2px', borderBottom: `1px solid ${colors.border}`, borderRadius: 0, opacity: disabled ? .5 : 1 }}
    >
      <span style={styles.avatar}>🤖</span>
      <span style={styles.memberMain}><span style={styles.memberName}>{item.name}</span></span>
      {item.installed ? <span style={{ color: colors.secondary, fontSize: 11 }}>已添加</span> : null}
      {selector(checked, disabled)}
    </button>
  }
  const toggleGroup = (group: ArkmeSourceItem) => {
    if (busy) return
    const expanded = expandedGroups.includes(group.sourceRef)
    setExpandedGroups(value => expanded ? value.filter(ref => ref !== group.sourceRef) : [...value, group.sourceRef])
    if (!expanded && groupCandidates[group.sourceRef] === undefined) loadGroupMembers(group)
  }
  const groupRow = (group: ArkmeSourceItem) => {
    const expanded = expandedGroups.includes(group.sourceRef)
    const bundle = groupCandidates[group.sourceRef]
    const groupItems = (bundle?.items ?? []).filter(item => normalizedQuery === '' || item.displayName.toLocaleLowerCase().includes(normalizedQuery))
    const isLoading = loadingGroups.includes(group.sourceRef)
    const memberCount = bundle?.total ?? group.groupAvatar?.memberCount ?? group.avatarRefs?.length ?? 0
    return <div key={group.sourceRef}>
      <button
        type="button"
        onClick={() => { toggleGroup(group) }}
        style={{ ...styles.memberRow, padding: '8px 2px', borderBottom: expanded ? 0 : `1px solid ${colors.border}`, borderRadius: 0 }}
      >
        <Avatar imageRef={group.avatarRef} />
        <span style={styles.memberMain}><span style={styles.memberName}>{group.displayName}</span></span>
        {memberCount > 0 ? <span style={{ color: colors.secondary, fontSize: 11 }}>{String(memberCount)}人</span> : null}
        <span style={{ color: colors.secondary, fontSize: 22, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .12s ease' }}>›</span>
      </button>
      {expanded ? <div style={{ marginLeft: 14, padding: '2px 0 10px 8px', borderLeft: `1px solid rgba(0,0,0,.08)` }}>
        {isLoading ? <div style={{ ...styles.loading, textAlign: 'left' }}>正在加载群成员</div> : null}
        {!isLoading && bundle?.error !== undefined ? <div style={{ padding: '10px 0', display: 'flex', alignItems: 'center', gap: 8, color: colors.secondary, fontSize: 13 }}><span>{bundle.error}</span><button type="button" style={{ border: 0, background: 'transparent', color: colors.primary, cursor: 'pointer' }} onClick={() => { loadGroupMembers(group) }}>重试</button></div> : null}
        {!isLoading && bundle?.error === undefined && groupItems.length === 0 ? <div style={{ padding: '10px 0', color: colors.secondary, fontSize: 13 }}>{normalizedQuery === '' ? '暂无可选群成员' : '没有找到相关成员'}</div> : null}
        {groupItems.map(item => candidateRow(item, true))}
      </div> : null}
    </div>
  }
  const selectedPreview = selectedCount === 0
    ? <span style={{ color: colors.secondary, fontSize: 13 }}>未选择对象</span>
    : <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      {[...selectedCandidateByRef.values()].slice(0, 5).map(item => <Avatar key={item.candidateRef} imageRef={item.avatarRef} size={24} />)}
      {selectedBotItems.slice(0, Math.max(0, 5 - selectedCandidateByRef.size)).map(item => <span key={item.botRef} style={{ ...styles.avatar, width: 24, height: 24, fontSize: 13 }}>🤖</span>)}
      {selectedCount > 5 ? <span style={{ minWidth: 30, height: 24, padding: '0 6px', borderRadius: 999, background: '#f5f5f5', color: colors.secondary, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>+{String(selectedCount - 5)}</span> : null}
    </span>
  const primaryText = snapshot?.mode === 'approval_invite' && selectedCandidateByRef.size > 0 && selectedBots.length === 0 ? '发送邀请' : '确认添加'
  const buttonText = selectedCount > 0 ? `${primaryText}（${String(selectedCount)}）` : primaryText

  return <div style={{ position: 'absolute', inset: 0, zIndex: 35, background: 'rgba(0,0,0,.24)' }} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) props.onClose()
  }}>
    <section style={{ ...styles.drawer, top: 0, width: 360, maxWidth: '92%', zIndex: 36, background: '#fff' }} role="dialog" aria-modal="true" aria-label="添加成员">
      <div style={{ height: 52, padding: '0 12px', display: 'flex', alignItems: 'center', flex: 'none' }}><h3 style={{ margin: 0, fontSize: 20, lineHeight: '28px', color: colors.text }}>添加成员</h3><span style={{ flex: 1 }} /><button type="button" aria-label="关闭" style={{ ...styles.closeButton, width: 28, height: 28, borderRadius: 0, background: 'transparent' }} onClick={props.onClose}><CloseGlyph /></button></div>
      <div style={{ position: 'relative', margin: '0 12px 8px' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 12, top: 11, color: '#aaa' }}><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2"/><path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        <input style={{ ...styles.dialogInput, height: 40, border: 0, borderRadius: 11, paddingLeft: 36, paddingRight: 30, background: '#f5f5f5' }} value={query} placeholder="搜索" aria-label="搜索成员候选人" disabled={busy} onChange={event => { setQuery(event.target.value) }} />
        {query !== '' ? <button type="button" aria-label="清除搜索" disabled={busy} onClick={() => { setQuery('') }} style={{ position: 'absolute', right: 8, top: 8, width: 24, height: 24, border: 0, background: 'transparent', color: colors.secondary, cursor: 'pointer' }}><CloseGlyph /></button> : null}
      </div>
      <div style={{ overflowY: 'auto', minHeight: 120, flex: 1, padding: '0 12px' }}>
        {!isSearchMode && <><div style={{ padding: '2px 0 8px', fontSize: 14, fontWeight: 600 }}>我的会话</div>{focusRows.map(row => {
          const active = focus === row.focus
          return <button key={row.focus} type="button" onClick={() => { setFocus(current => current === row.focus ? 'all' : row.focus) }} style={{ width: '100%', height: 52, padding: '0 12px', border: 0, borderBottom: `1px solid ${colors.border}`, outline: 0, background: '#fff', display: 'flex', alignItems: 'center', gap: 12, color: active ? colors.text : colors.secondary, position: 'relative', cursor: 'pointer' }}>
            {active && <span style={{ position: 'absolute', left: 0, width: 2, height: 16, borderRadius: 2, background: colors.text }} />}{focusIcon(row.focus)}<strong style={{ fontSize: 14, fontWeight: active ? 700 : 500 }}>{row.label}</strong><span style={{ marginLeft: 'auto', fontSize: 12 }}>{row.count}</span>
          </button>
        })}</>}
        {loading ? <div style={styles.loading}>正在读取可添加对象…</div> : null}
        {isSearchMode && !loading ? <>
          {searchingGroups && matchedMembers.length + matchedGroups.length + matchedBots.length === 0 ? <div style={styles.loading}>正在搜索群成员…</div> : null}
          {matchedMembers.length > 0 ? <>{(matchedGroups.length + matchedBots.length > 0) && sectionTitle('成员')}{matchedMembers.map(item => candidateRow(item))}</> : null}
          {matchedGroups.length > 0 ? <>{(matchedMembers.length + matchedBots.length > 0) && sectionTitle('群聊')}{matchedGroups.map(groupRow)}</> : null}
          {matchedBots.length > 0 ? <>{(matchedMembers.length + matchedGroups.length > 0) && sectionTitle('Bot')}{matchedBots.map(botRow)}</> : null}
          {!searchingGroups && matchedMembers.length + matchedGroups.length + matchedBots.length === 0 ? <div style={styles.empty}>没有找到相关对象</div> : null}
        </> : null}
        {!isSearchMode && !loading && effectiveFocus === 'all' && visibleContacts.length > 0 ? <>{sectionTitle('联系人')}{visibleContacts.map(item => candidateRow(item))}</> : null}
        {showStrangerSection ? <>{sectionTitle('陌生人')}{visiblePrivateChats.length === 0 ? <div style={{ padding: '10px 0', color: colors.secondary, fontSize: 13 }}>暂无陌生人</div> : visiblePrivateChats.map(item => candidateRow(item))}</> : null}
        {!isSearchMode && !loading && (effectiveFocus === 'all' || effectiveFocus === 'group') ? <>{sectionTitle('群聊')}{visibleGroups.length === 0 ? <div style={{ padding: '10px 0', color: colors.secondary, fontSize: 13 }}>暂无群聊</div> : visibleGroups.map(groupRow)}</> : null}
        {!isSearchMode && !loading && (effectiveFocus === 'all' || effectiveFocus === 'bot') ? <>{sectionTitle('Bot')}{visibleBots.length === 0 ? <div style={{ padding: '10px 0', color: colors.secondary, fontSize: 13 }}>当前没有可添加到本群的 Bot</div> : visibleBots.map(botRow)}</> : null}
      </div>
      <div style={{ height: 58, flex: 'none', display: 'flex', alignItems: 'center', padding: '0 14px', borderTop: `1px solid ${colors.border}`, background: '#fff' }}>
        <span style={{ minWidth: 0, flex: 1 }}>{selectedPreview}</span><span style={{ width: 10 }} />
        <button
          type="button"
          style={{ ...styles.dialogButton, width: 126, height: 38, borderRadius: 11, background: selectedCount === 0 ? '#f5f5f5' : colors.text, color: selectedCount === 0 ? '#aaa' : '#fff', opacity: busy ? .55 : 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          disabled={busy || selectedCount === 0}
          onClick={() => {
            setBusy(true)
            const memberRefs = [...selectedCandidateByRef.keys()]
            const memberWrite = memberRefs.length === 0 ? Promise.resolve(undefined) : callArkme<ArkmeGroupMemberAddResult>('group.members.add', { sourceRef: props.source.sourceRef, candidateRefs: memberRefs })
            const botWrites = selectedBots.map(botRef => callArkme('group.bot.add', { sourceRef: props.source.sourceRef, botRef }))
            void Promise.all([memberWrite, ...botWrites])
              .then(([result]) => {
                if (result !== undefined && result.failedCount > 0) props.onError(`已完成 ${String(result.succeededCount)} 人，${String(result.failedCount)} 人失败`)
                props.onAdded()
                props.onClose()
              })
              .catch(caught => { props.onError(errorMessage(caught)) })
              .finally(() => { setBusy(false) })
          }}
        >{busy ? '处理中…' : buttonText}</button>
      </div>
    </section>
  </div>
}

function InviteCollaboratorsDialog(props: {
  source: ArkmeSourceItem
  open: boolean
  onClose: () => void
  onAddMembers: () => void
  onError: (message: string) => void
}) {
  const [preview, setPreview] = useState<ArkmeGroupInvitePreview>()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!props.open) return
    const controller = new AbortController()
    setLoading(true)
    void callArkme<ArkmeGroupInvitePreview>('group.invite-preview', { sourceRef: props.source.sourceRef }, controller.signal)
      .then(setPreview).catch(caught => { props.onError(errorMessage(caught)) }).finally(() => { setLoading(false) })
    return () => { controller.abort() }
  }, [props.open, props.source.sourceRef])
  useEffect(() => () => {
    if (copiedTimerRef.current !== undefined) clearTimeout(copiedTimerRef.current)
  }, [])
  if (!props.open) return null
  const qrUrl = preview === undefined ? '' : qrDataUrl(preview.inviteLink)
  const action = (kind: 'copy' | 'save' | 'add', label: string, onClick: () => void, disabled = false, busy = false) => <button
    type="button" disabled={disabled} onClick={onClick}
    aria-busy={busy || undefined}
    style={{ width: 78, padding: 0, border: 0, background: 'transparent', color: colors.secondary, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .45 : 1 }}
  ><span style={{ width: 48, height: 48, margin: '0 auto 8px', borderRadius: 999, display: 'grid', placeItems: 'center', background: colors.subtle }}>{busy ? <InviteSavingSpinner /> : <InviteActionIcon kind={kind} />}</span><span style={{ fontSize: 12, lineHeight: '18px' }}>{label}</span></button>
  const copyLink = () => {
    if (preview === undefined) return
    void navigator.clipboard.writeText(preview.inviteLink)
      .then(() => {
        if (copiedTimerRef.current !== undefined) clearTimeout(copiedTimerRef.current)
        setCopied(true)
        copiedTimerRef.current = setTimeout(() => { setCopied(false) }, 1800)
      })
      .catch(caught => { props.onError(errorMessage(caught)) })
  }
  const saveQr = () => {
    if (qrUrl === '' || saving) return
    setSaving(true)
    void fetch(qrUrl)
      .then(response => response.blob())
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = `arkme_invite_${String(Date.now())}.png`
        anchor.click()
        URL.revokeObjectURL(objectUrl)
      })
      .catch(caught => { props.onError(errorMessage(caught)) })
      .finally(() => { setSaving(false) })
  }
  return <div style={styles.dialogScrim} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
    <section style={{ ...styles.dialog, width: 420 }} role="dialog" aria-modal="true" aria-label="邀请协作者">
      <div style={{ display: 'flex', alignItems: 'center' }}><h3 style={{ ...styles.dialogTitle, margin: 0, fontSize: 18 }}>邀请协作者</h3><span style={{ flex: 1 }} /><button type="button" aria-label="关闭" style={{ ...styles.closeButton, width: 28, height: 28, padding: 0, borderRadius: 999, background: colors.subtle, color: colors.secondary }} onClick={props.onClose}><CloseGlyph /></button></div>
      <div style={{ height: 10 }} />
      <div style={{ width: 264, margin: '0 auto', padding: '16px 16px 14px', borderRadius: 18, background: colors.panel, boxSizing: 'border-box', boxShadow: '0 10px 22px rgba(0,0,0,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}><Avatar imageRef={props.source.avatarRef} size={32} /><div style={{ marginLeft: 10, minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview?.title ?? props.source.displayName}</div><div style={{ marginTop: 2, fontSize: 12, color: colors.secondary }}>发起人：{preview?.inviterDisplayName ?? 'Arkme'}</div></div></div>
        <div style={{ position: 'relative', width: 176, height: 176, padding: 10, margin: '14px auto 0', border: `1px solid ${colors.border}`, borderRadius: 12, boxSizing: 'border-box', background: '#fff', display: 'grid', placeItems: 'center' }}>{loading ? <span style={styles.loading}>加载中…</span> : qrUrl === '' ? <span style={{ fontSize: 12, color: colors.secondary }}>邀请链接生成失败，请重试</span> : <img src={qrUrl} alt="群聊邀请二维码" style={{ width: 156, height: 156, imageRendering: 'pixelated' }} />}{copied ? <span role="status" aria-live="polite" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', padding: '9px 12px', borderRadius: 4, background: '#fff', boxShadow: '0 3px 12px rgba(0,0,0,.18)', color: colors.text, fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap' }}>邀请链接已复制</span> : null}</div>
        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 11.5, color: colors.secondary }}>{inviteExpireText(preview?.expireAtMillis ?? 0)}</div>
      </div>
      <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: colors.secondary }}>扫码加入，或转发邀请链接</div>
      <div style={{ width: 266, margin: '14px auto 0', display: 'flex', justifyContent: 'space-between' }}>{action('copy', '复制链接', copyLink, preview === undefined)}{action('save', '保存', saveQr, qrUrl === '' || saving, saving)}{action('add', '添加成员', () => { props.onClose(); props.onAddMembers() }, loading)}</div>
    </section>
  </div>
}

function MessageDndSwitch(props: { checked: boolean; busy: boolean; onChange: (checked: boolean) => void }) {
  return <button
    type="button"
    role="switch"
    aria-label="消息免打扰"
    aria-checked={props.checked}
    disabled={props.busy}
    style={{
      ...styles.switch,
      background: props.checked ? colors.primary : arkmeTheme.active,
      opacity: props.busy ? .55 : 1,
      justifyContent: 'flex-start',
    }}
    onClick={event => { event.stopPropagation(); props.onChange(!props.checked) }}
  >
    <span style={{ ...styles.switchThumb, transform: props.checked ? 'translateX(18px)' : 'translateX(0)' }} />
  </button>
}

function GroupSettingsMenu(props: {
  source: ArkmeSourceItem
  open: boolean
  position: { left: number; top: number }
  fallbackRole: ArkmeGroupSettingsSnapshot['selfRole']
  fallbackStatus: ArkmeGroupSettingsSnapshot['selfStatus']
  onClose: () => void
  onRename: () => void
  onSourceUpdated: (source: ArkmeSourceItem) => void
  onError: (message: string) => void
}) {
  const [snapshot, setSnapshot] = useState<ArkmeGroupSettingsSnapshot>()
  const [messageDnd, setMessageDnd] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!props.open) return
    const controller = new AbortController()
    void callArkme<ArkmeGroupSettingsSnapshot>('group.settings', {
      sourceRef: props.source.sourceRef,
    }, controller.signal)
      .then(value => {
        setSnapshot(value)
        setMessageDnd(value.messageDnd)
        props.onSourceUpdated(value.source)
      })
      .catch(caught => { props.onError(errorMessage(caught)) })
    return () => { controller.abort() }
  }, [props.open, props.source.sourceRef])

  const effective = snapshot ?? {
    source: props.source,
    selfRole: props.fallbackRole,
    selfStatus: props.fallbackStatus,
    canRename: props.fallbackRole === 'owner' && props.fallbackStatus === 'active',
    canDissolve: props.fallbackRole === 'owner' && props.fallbackStatus === 'active',
    canLeave: props.fallbackRole !== 'owner' && props.fallbackStatus === 'active',
    messageDnd,
  }

  const leaveOrDissolve = useCallback(async () => {
    const operation = effective.canDissolve ? 'group.dissolve' : 'group.leave'
    const prompt = effective.canDissolve ? '确定要解散群聊吗？' : '确定要退出群聊吗？'
    if (!window.confirm(prompt)) return
    setBusy(true)
    try {
      const result = await callArkme<ArkmeGroupActionResult>(operation, { sourceRef: props.source.sourceRef })
      props.onSourceUpdated(result.source)
      props.onClose()
    } catch (caught) {
      props.onError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }, [effective.canDissolve, props])

  if (!props.open) return null
  return <div style={styles.menuScrim} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) props.onClose()
  }}>
    <div
      style={{ ...styles.popover, left: props.position.left, top: props.position.top }}
      role="menu"
      aria-label="群聊设置"
      onMouseDown={event => { event.stopPropagation() }}
    >
      {effective.canRename && <button
        type="button"
        role="menuitem"
        style={styles.menuRow}
        onMouseEnter={event => { event.currentTarget.style.background = colors.subtle }}
        onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
        onClick={() => {
          props.onRename()
          props.onClose()
        }}
      ><ClientIcon src={icons.rename} /><span>重命名</span></button>}
      <button
        type="button"
        role="menuitem"
        style={{ ...styles.menuRow, ...(effective.canRename ? { marginTop: 6 } : {}) }}
        disabled={busy || (!effective.canLeave && !effective.canDissolve)}
        onMouseEnter={event => { event.currentTarget.style.background = colors.subtle }}
        onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
        onClick={() => { void leaveOrDissolve() }}
      ><ClientIcon src={icons.exit} /><span>{effective.canDissolve ? '解散' : '退出群聊'}</span></button>
      <div style={{ ...styles.menuRow, marginTop: 6 }} role="none">
        <ClientIcon src={icons.notice} />
        <span>消息免打扰</span>
        <MessageDndSwitch
          checked={messageDnd}
          busy={busy}
          onChange={next => {
            const previous = messageDnd
            setMessageDnd(next)
            setBusy(true)
            void callArkme<ArkmeGroupNotificationResult>('group.notification.set', {
              sourceRef: props.source.sourceRef,
              enabled: next,
            })
              .then(result => {
                setMessageDnd(result.messageDnd)
                props.onSourceUpdated({ ...props.source, isMuted: result.messageDnd })
              })
              .catch(caught => { setMessageDnd(previous); props.onError(errorMessage(caught)) })
              .finally(() => { setBusy(false) })
          }}
        />
      </div>
    </div>
  </div>
}

function RenameDialog(props: {
  source: ArkmeSourceItem
  open: boolean
  onClose: () => void
  onSourceUpdated: (source: ArkmeSourceItem) => void
  onError: (message: string) => void
}) {
  const [title, setTitle] = useState(props.source.displayName)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (props.open) setTitle(props.source.displayName) }, [props.open, props.source.displayName])
  if (!props.open) return null
  return <div style={styles.dialogScrim} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) props.onClose()
  }}>
    <section style={styles.dialog} role="dialog" aria-modal="true" aria-label="重命名">
      <h3 style={styles.dialogTitle}>重命名</h3>
      <input
        style={styles.dialogInput}
        value={title}
        maxLength={80}
        autoFocus
        aria-label="群聊名称"
        disabled={busy}
        onChange={event => { setTitle(event.target.value) }}
      />
      <div style={styles.dialogActions}>
        <button type="button" style={{ ...styles.dialogButton, background: colors.subtle, color: colors.text }} disabled={busy} onClick={props.onClose}>取消</button>
        <button
          type="button"
          style={{ ...styles.dialogButton, background: colors.primary, color: arkmeTheme.foreground, opacity: busy || title.trim() === '' ? .55 : 1 }}
          disabled={busy || title.trim() === ''}
          onClick={() => {
            setBusy(true)
            void callArkme<ArkmeGroupActionResult>('group.rename', {
              sourceRef: props.source.sourceRef,
              title,
            })
              .then(result => { props.onSourceUpdated(result.source); props.onClose() })
              .catch(caught => { props.onError(errorMessage(caught)) })
              .finally(() => { setBusy(false) })
          }}
        >保存</button>
      </div>
    </section>
  </div>
}

export function ArkmeGroupChatControls(props: {
  source: ArkmeSourceItem
  overlayHostRef: RefObject<HTMLElement>
  onSourceActivated: (source: ArkmeSourceItem) => void
  onMemberOpen: (member: ArkmeConversationMemberItem) => void
  onMemberContextMenu: (member: ArkmeConversationMemberItem, anchorRect: DOMRect) => void
  onError: (message: string) => void
}) {
  const [membersOpen, setMembersOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [addMembersOpen, setAddMembersOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPosition, setSettingsPosition] = useState({ left: 12, top: 54 })
  const [renameOpen, setRenameOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [selfRole, setSelfRole] = useState<ArkmeGroupSettingsSnapshot['selfRole']>('unknown')
  const [selfStatus, setSelfStatus] = useState<ArkmeGroupSettingsSnapshot['selfStatus']>('unknown')
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  const settingsLoaded = useCallback((settings: Pick<ArkmeGroupSettingsSnapshot, 'selfRole' | 'selfStatus'>) => {
    setSelfRole(settings.selfRole)
    setSelfStatus(settings.selfStatus)
  }, [])

  const openMembers = useCallback(() => {
    setSettingsOpen(false)
    setMembersOpen(true)
    setRefreshToken(value => value + 1)
  }, [])

  const overlayHost = props.overlayHostRef.current

  const toggleSettings = useCallback(() => {
    if (settingsOpen) {
      setSettingsOpen(false)
      return
    }
    const host = props.overlayHostRef.current
    const button = settingsButtonRef.current
    if (host !== null && button !== null) {
      const hostRect = host.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      const menuWidth = 181
      const menuHeight = 120
      setSettingsPosition({
        left: Math.max(12, Math.min(hostRect.width - menuWidth - 12, buttonRect.right - hostRect.left - menuWidth)),
        top: Math.max(8, Math.min(hostRect.height - menuHeight - 12, buttonRect.bottom - hostRect.top + 8)),
      })
    }
    setMembersOpen(false)
    setSettingsOpen(true)
  }, [props.overlayHostRef, settingsOpen])

  return <>
    <div style={styles.headerActions}>
      <IconButton label="查看群成员" onClick={openMembers}><ClientIcon src={icons.members} size={24} /></IconButton>
      <IconButton label="群聊设置" buttonRef={settingsButtonRef} onClick={toggleSettings}><MoreIcon /></IconButton>
    </div>
    {overlayHost !== null && createPortal(<>
      <GroupSettingsMenu
        source={props.source}
        open={settingsOpen}
        position={settingsPosition}
        fallbackRole={selfRole}
        fallbackStatus={selfStatus}
        onClose={() => { setSettingsOpen(false) }}
        onRename={() => { setRenameOpen(true) }}
        onSourceUpdated={props.onSourceActivated}
        onError={props.onError}
      />
      <GroupMembersDrawer
        source={props.source}
        open={membersOpen}
        refreshToken={refreshToken}
        onClose={() => { setMembersOpen(false) }}
        onAdd={() => { setInviteOpen(true) }}
        onMemberOpen={props.onMemberOpen}
        onMemberContextMenu={props.onMemberContextMenu}
        onSettingsLoaded={settingsLoaded}
        onError={props.onError}
      />
      <InviteCollaboratorsDialog
        source={props.source}
        open={inviteOpen}
        onClose={() => { setInviteOpen(false) }}
        onAddMembers={() => { setAddMembersOpen(true) }}
        onError={props.onError}
      />
      <AddMembersDrawer
        source={props.source}
        open={addMembersOpen}
        onClose={() => { setAddMembersOpen(false) }}
        onAdded={() => { setRefreshToken(value => value + 1) }}
        onError={props.onError}
      />
      <RenameDialog
        source={props.source}
        open={renameOpen}
        onClose={() => { setRenameOpen(false) }}
        onSourceUpdated={props.onSourceActivated}
        onError={props.onError}
      />
    </>, overlayHost)}
  </>
}
