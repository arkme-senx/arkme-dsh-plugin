import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  ArkmeGroupActionResult,
  ArkmeGroupMemberItem,
  ArkmeGroupMemberList,
  ArkmeGroupNotificationResult,
  ArkmeGroupSettingsSnapshot,
  ArkmeOpenPrivateChatResult,
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
    display: 'grid', placeItems: 'center', cursor: 'pointer',
  },
  icon: { width: 20, height: 20, display: 'block', filter: 'brightness(0)', opacity: .84 },
  drawer: {
    position: 'absolute', top: 56, right: 0, bottom: 0, zIndex: 8, width: 262, maxWidth: '86%',
    display: 'flex', flexDirection: 'column', background: colors.panel,
    boxShadow: '0 4px 10px rgba(0,0,0,.1)',
  },
  drawerHeader: {
    flex: 'none', height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px 0 18px', borderBottom: `1px solid ${colors.border}`, boxSizing: 'border-box',
  },
  drawerTitle: { margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 600, color: colors.text },
  closeButton: {
    width: 30, height: 30, border: 0, borderRadius: 4, background: 'transparent',
    color: colors.secondary, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 20,
  },
  drawerBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 8px 18px' },
  memberRow: {
    width: '100%', border: 0, background: 'transparent', borderRadius: 10, padding: '7px 6px',
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
  cardScrim: {
    position: 'absolute', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center',
    background: 'rgba(15,23,42,.18)', padding: 20,
  },
  card: {
    width: 344, maxWidth: '100%', borderRadius: 24, background: colors.panel,
    boxShadow: '0 24px 72px rgba(15,23,42,.2)', overflow: 'hidden',
  },
  cardContent: { padding: '26px 24px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  cardName: {
    maxWidth: 296, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 18, lineHeight: '26px', fontWeight: 600, color: colors.text,
  },
  cardSubtitle: {
    maxWidth: 296, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: colors.secondary, fontSize: 12, lineHeight: '17px',
  },
  cardActions: { display: 'flex', padding: '0 18px 20px' },
  cardButton: {
    flex: 1, height: 38, border: 0, borderRadius: 999, background: colors.primary,
    color: arkmeTheme.foreground, fontSize: 14, cursor: 'pointer',
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

function roleLabel(member: ArkmeGroupMemberItem): string {
  if (member.role === 'owner') return '发起人'
  if (member.role === 'admin') return '管理员'
  return ''
}

function memberCardSubtitle(member: ArkmeGroupMemberItem): string {
  const displayName = member.displayName.trim()
  const memberName = member.memberName?.trim() ?? ''
  if (memberName !== '' && memberName !== displayName) return `主题内昵称：${memberName}`
  const secondaryName = member.secondaryName?.trim() ?? ''
  return secondaryName !== '' && secondaryName !== displayName ? secondaryName : ''
}

function ClientIcon({ src, size = 20 }: { src: string; size?: number }) {
  return <img src={src} alt="" draggable={false} style={{ ...styles.icon, width: size, height: size }} />
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
  onMemberOpen: (member: ArkmeGroupMemberItem) => void
  onSettingsLoaded: (settings: Pick<ArkmeGroupSettingsSnapshot, 'selfRole' | 'selfStatus'>) => void
  onError: (message: string) => void
}) {
  const [snapshot, setSnapshot] = useState<ArkmeGroupMemberList>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!props.open) return
    const controller = new AbortController()
    setLoading(true)
    void callArkme<ArkmeGroupMemberList>('group.members', {
      sourceRef: props.source.sourceRef,
      activeOnly: true,
    }, controller.signal)
      .then(value => {
        setSnapshot(value)
        props.onSettingsLoaded({ selfRole: value.selfRole, selfStatus: value.selfStatus })
      })
      .catch(caught => { props.onError(errorMessage(caught)) })
      .finally(() => { setLoading(false) })
    return () => { controller.abort() }
  }, [props.open, props.refreshToken, props.source.sourceRef])

  if (!props.open) return null
  const items = snapshot?.items ?? []
  return <aside style={styles.drawer} aria-label="群成员">
    <div style={styles.drawerHeader}>
      <h3 style={styles.drawerTitle}>群成员{snapshot === undefined ? '' : `（${snapshot.activeCount}）`}</h3>
      <button type="button" style={styles.closeButton} aria-label="关闭群成员" onClick={props.onClose}>×</button>
    </div>
    <div style={styles.drawerBody}>
      {loading && items.length === 0 ? <div style={styles.loading}>正在读取群成员…</div> : null}
      {!loading && items.length === 0 ? <div style={styles.empty}>暂无群成员</div> : null}
      {items.map(member => {
        const badge = roleLabel(member)
        return <button
          key={member.userId}
          type="button"
          style={styles.memberRow}
          onMouseEnter={event => {
            event.currentTarget.style.background = colors.subtle
          }}
          onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
          onClick={() => { props.onMemberOpen(member) }}
        >
          <Avatar imageRef={member.avatarRef} />
          <span style={styles.memberMain}>
            <span style={styles.memberNameLine}>
              <span style={styles.memberName}>{member.displayName}</span>
              {badge !== '' && <span style={styles.badge}>{badge}</span>}
            </span>
          </span>
        </button>
      })}
    </div>
  </aside>
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

function MemberCard(props: {
  member: ArkmeGroupMemberItem
  busy: boolean
  onClose: () => void
  onSend: () => void
}) {
  const member = props.member
  const subtitle = memberCardSubtitle(member)
  return <div style={styles.cardScrim} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) props.onClose()
  }}>
    <section style={styles.card} role="dialog" aria-modal="true" aria-label={`${member.displayName} 的用户卡片`}>
      <div style={styles.cardContent}>
        <Avatar imageRef={member.avatarRef} size={72} />
        <h3 style={styles.cardName}>{member.displayName}</h3>
        {subtitle !== '' && <div style={styles.cardSubtitle}>{subtitle}</div>}
      </div>
      <div style={styles.cardActions}>
        <button
          type="button"
          style={{ ...styles.cardButton, opacity: props.busy || member.isSelf ? .55 : 1 }}
          disabled={props.busy || member.isSelf}
          onClick={props.onSend}
        >发送消息</button>
      </div>
    </section>
  </div>
}

export function ArkmeGroupChatControls(props: {
  source: ArkmeSourceItem
  overlayHostRef: RefObject<HTMLElement>
  onSourceActivated: (source: ArkmeSourceItem) => void
  onError: (message: string) => void
}) {
  const [membersOpen, setMembersOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPosition, setSettingsPosition] = useState({ left: 12, top: 54 })
  const [renameOpen, setRenameOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [memberCard, setMemberCard] = useState<ArkmeGroupMemberItem>()
  const [privateChatBusy, setPrivateChatBusy] = useState(false)
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

  const openPrivateChat = useCallback((member: ArkmeGroupMemberItem) => {
    if (member.isSelf || privateChatBusy) return
    setPrivateChatBusy(true)
    void callArkme<ArkmeOpenPrivateChatResult>('chat.private.open', {
      peerUserId: member.userId,
      displayName: member.displayName,
    })
      .then(result => {
        props.onSourceActivated(result.source)
        setMemberCard(undefined)
        setMembersOpen(false)
      })
      .catch(caught => { props.onError(errorMessage(caught)) })
      .finally(() => { setPrivateChatBusy(false) })
  }, [privateChatBusy, props])

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
    setMemberCard(undefined)
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
        onClose={() => { setMembersOpen(false); setMemberCard(undefined) }}
        onMemberOpen={setMemberCard}
        onSettingsLoaded={settingsLoaded}
        onError={props.onError}
      />
      {memberCard !== undefined && <MemberCard
        member={memberCard}
        busy={privateChatBusy}
        onClose={() => { setMemberCard(undefined) }}
        onSend={() => { openPrivateChat(memberCard) }}
      />}
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
