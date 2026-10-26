import type {CSSProperties} from 'react'
import {arkmeTheme} from './arkme-theme.js'
const colors = {
  panel: arkmeTheme.base,
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  border: arkmeTheme.border,
  danger: arkmeTheme.danger,
}
export const forwardTargetStyles:Record<string,CSSProperties>={
  forwardTargetBackdrop: {
    position: 'absolute', inset: 0, zIndex: 70, display: 'grid', placeItems: 'center',
    padding: 48, boxSizing: 'border-box', background: 'rgba(19,22,26,.30)',
  },
  forwardTargetDialog: {
    width: 'min(520px, 100%)', height: 'min(660px, 100%)', minHeight: 'min(520px, 100%)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: `1px solid ${colors.border}`, borderRadius: 16, background: arkmeTheme.base,
    boxShadow: '0 22px 64px rgba(20,23,31,.24)',
  },
  forwardTargetHeader: {
    height: 54, flex: 'none', display: 'grid', gridTemplateColumns: '54px 1fr 54px', alignItems: 'center', padding: 0,
    boxSizing: 'border-box',
  },
  forwardTargetTitle: { minWidth: 0, margin: 0, textAlign: 'center', color: colors.text, fontSize: 16, lineHeight: '22px', fontWeight: 600 },
  forwardTargetClose: { width: 44, height: 44, border: 0, borderRadius: 10, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer', fontSize: 30, lineHeight: '30px' },
  forwardTargetSearchWrap: {
    margin: '4px 18px 12px', height: 38, flex: 'none',
  },
  forwardTargetBody: { flex: 1, minHeight: 0, overflowY: 'auto' },
  forwardTargetList: { margin: 0, padding: '4px 18px 18px', listStyle: 'none' },
  forwardTargetRow: {
    position: 'relative',
    width: '100%', minHeight: 56, display: 'grid', gridTemplateColumns: '20px 36px minmax(0, 1fr) auto', alignItems: 'center', gap: 10, padding: '9px 8px',
    boxSizing: 'border-box', border: 0, borderRadius: 8, background: 'transparent', color: colors.text,
    cursor: 'pointer', textAlign: 'left', font: 'inherit',
  },
  forwardTargetRowSelected: {},
  forwardTargetCheck: {
    width: 20, height: 20, display: 'grid', placeItems: 'center', borderRadius: 999, border: `1px solid ${arkmeTheme.tertiary}`,
    color: 'transparent', boxSizing: 'border-box', fontSize: 15, lineHeight: 1,
    opacity: .4,
  },
  forwardTargetCheckSelected: { borderColor: arkmeTheme.text, background: arkmeTheme.text, color: arkmeTheme.base, opacity: 1 },
  forwardTargetText: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  forwardTargetName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '22px', fontWeight: 500 },
  forwardTargetMeta: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  forwardTargetTime: { color: arkmeTheme.caption, fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap' },
  forwardTargetStatus: { padding: '16px 18px 28px', color: colors.secondary, textAlign: 'center', fontSize: 12, lineHeight: '18px' },
  forwardTargetFooter: {
    flex: 'none', padding: '10px 16px 14px', borderTop: `1px solid ${colors.border}`, boxSizing: 'border-box',
    background: arkmeTheme.base,
  },
  forwardTargetRecipients: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 30, padding: '0 2px', color: colors.text, fontSize: 14, lineHeight: '20px', fontWeight: 600 },
  forwardTargetAvatarStack: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' },
  forwardTargetFooterDivider: { height: 1, margin: '8px 2px 0', background: colors.border },
  forwardTargetPreview: {
    position: 'relative', minHeight: 34, display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr) 28px', alignItems: 'center', gap: 8,
    padding: '0 2px 2px', marginTop: 6, boxSizing: 'border-box',
  },
  forwardTargetPreviewIcon: { width: 26, height: 32, color: colors.secondary, display: 'grid', placeItems: 'center' },
  forwardTargetPreviewText: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  forwardTargetPreviewTitle: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.text, fontSize: 12, lineHeight: '16px', fontWeight: 400 },
  forwardTargetPreviewSubtitle: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '16px' },
  forwardTargetPreviewClose: {
    width: 28, height: 28, borderRadius: 14, border: 0, background: 'transparent',
    color: arkmeTheme.tertiary, display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0,
  },
  forwardTargetComposer: {
    position: 'relative', minHeight: 54, marginTop: 6, boxSizing: 'border-box', borderRadius: 12, background: arkmeTheme.layer2,
  },
  forwardTargetCommentInput: {
    width: '100%', minWidth: 0, minHeight: 54, maxHeight: 102, resize: 'none', border: 0, outline: 'none',
    padding: '17px 66px 17px 16px', boxSizing: 'border-box', background: 'transparent', color: colors.text,
    fontSize: 14, lineHeight: '20px', fontFamily: 'inherit',
  },
  forwardTargetSend: {
    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
    width: 40, height: 40, border: 0, borderRadius: 999, display: 'grid', placeItems: 'center',
    background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, cursor: 'pointer', padding: 0,
  },
  forwardTargetSendDisabled: { opacity: .45, cursor: 'default' },
  forwardTargetSendError: { margin: '8px 2px 0', color: colors.danger, fontSize: 12, lineHeight: '16px' },
}
