import type { ReactNode } from 'react'
import type { TeamWorldPreview } from '../team-world-contract.js'
import { tr } from './locale.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { arkmeIntlLocale } from './locale.js'

/** Visual recipe shared only by the World management surfaces. */
export function WorldManagementStyles() { return <style>{`
.wm { color:${c.text}; font-size:13px; line-height:1.55; min-width:0; }
.wm *, .wm *::before, .wm *::after { box-sizing:border-box; }
.wm button, .wm input, .wm textarea { font:inherit; }
.wm button { cursor:pointer; }
.wm button:disabled { cursor:default; opacity:.45; }
.wm button:focus-visible, .wm input:focus-visible, .wm textarea:focus-visible { outline:2px solid ${c.accent}; outline-offset:3px; }
.wm button.wm-button { min-height:32px; padding:6px 11px; display:inline-flex; align-items:center; justify-content:center; gap:6px; border:1px solid ${c.border}; border-radius:8px; background:${c.base}; color:${c.text}; font-size:12px; white-space:nowrap; }
.wm button.wm-button:hover:not(:disabled) { background:${c.hover}; }
.wm button.wm-button[data-kind=primary] { border-color:transparent; background:${c.primaryAction}; color:${c.onPrimaryAction}; }
.wm button.wm-button[data-kind=quiet] { border-color:transparent; background:transparent; color:${c.secondary}; }
.wm button.wm-button[data-kind=danger] { color:${c.danger}; }
.wm button.wm-icon-button { width:32px; padding:0; flex:none; }
.wm-toolbar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:20px; }
.wm-tabs { display:flex; align-items:stretch; gap:24px; min-width:0; border-bottom:1px solid ${c.borderSoft}; }
.wm button.wm-tab { padding:12px 0; border:0; border-bottom:2px solid transparent; background:transparent; color:${c.secondary}; font-size:13px; white-space:nowrap; }
.wm button.wm-tab[aria-pressed=true], .wm button.wm-tab[aria-current=page] { color:${c.text}; font-weight:600; border-bottom-color:${c.accent}; }
.wm-muted { color:${c.secondary}; font-size:12px; }
.wm-caption { color:${c.tertiary}; font-size:11px; }
.wm-title { margin:0; font-size:14px; font-weight:600; line-height:1.5; overflow-wrap:anywhere; }
.wm-heading { display:flex; align-items:center; gap:9px; min-width:0; }
.wm-heading > svg { flex:none; color:${c.secondary}; }
.wm-spread { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.wm-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.wm-badge { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:6px; background:${c.layer2}; color:${c.secondary}; font-size:11px; white-space:nowrap; font-weight:400; }
.wm-badge[data-tone=info] { color:${c.accent}; background:${c.accentSoft}; }
.wm-badge[data-tone=warning] { color:${c.warning}; background:${c.warningSoft}; }
.wm-stack { display:grid; gap:14px; }
.wm-card { min-width:0; padding:20px 0; border:0; border-bottom:1px solid ${c.borderSoft}; background:${c.base}; }
.wm-card > header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.wm-card-body { margin:14px 0 18px; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.8; font-size:14px; }
.wm-card-footer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding-top:14px; border-top:1px solid ${c.borderSoft}; }
.wm-attachments { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
.wm button.wm-attachment { min-height:42px; border-style:dashed; background:${c.layer1}; }
.wm-image { margin:12px 0; border:1px solid ${c.borderSoft}; border-radius:10px; overflow:hidden; background:${c.layer1}; }
.wm-image img { display:block; max-width:100%; max-height:440px; object-fit:contain; margin:auto; }
.wm-image footer { padding:8px 10px; text-align:right; }
.wm-editor { margin-top:16px; padding-top:16px; border-top:1px solid ${c.borderSoft}; }
.wm-editor textarea { display:block; resize:vertical; width:100%; min-height:140px; border:1px solid ${c.border}; border-radius:10px; padding:12px; background:${c.input}; color:${c.text}; line-height:1.7; margin:8px 0 12px; }
.wm-notice { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border-radius:10px; background:${c.layer1}; color:${c.secondary}; font-size:12px; margin:12px 0; }
.wm-notice[role=alert] { color:${c.danger}; background:${c.dangerSoft}; }
.wm-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; min-height:220px; padding:32px 24px; color:${c.tertiary}; }
.wm-empty-icon { width:48px; height:48px; border-radius:14px; background:${c.layer1}; display:grid; place-items:center; margin-bottom:16px; }
.wm-empty strong { font-size:14px; font-weight:500; color:${c.secondary}; }
.wm-empty p { margin:8px 0 0; max-width:260px; font-size:12px; line-height:1.7; }
.wm-feedback { display:block; min-height:360px; }
.wm-feedback-list { min-width:0; max-width:700px; }
.wm-feedback-scroll { display:grid; gap:16px; margin-top:20px; }
.wm-feedback-group { min-width:0; padding:20px; border:1px dashed ${c.border}; border-radius:14px; background:${c.layer1}; }
.wm-feedback-original > header { display:flex; align-items:center; gap:10px; }
.wm-feedback-original[role=button] { cursor:pointer; }
.wm-feedback-original[role=button]:focus-visible { outline:2px solid ${c.accent}; outline-offset:4px; border-radius:6px; }
.wm-feedback-original > header small { color:${c.tertiary}; font-size:11px; }
.wm-feedback-original > header .wm-badge { margin-left:auto; }
.wm-feedback-original .wm-preview-images[data-single=true] .wm-preview-tile { width:142px; height:118px; }
.wm-group-events { margin-top:18px; border-top:1px solid ${c.borderSoft}; padding-top:14px; }
.wm-group-events > h3 { margin:0 0 4px; font-size:12px; font-weight:500; color:${c.secondary}; }
.wm-feedback-card { position:relative; border-bottom:1px solid ${c.borderSoft}; }
.wm-feedback-card:last-child { border-bottom:0; }
.wm-comment-unread { position:absolute; right:110px; top:25px; }
.wm-feedback-card [data-world-compact] > p, .wm-feedback-card [data-world-compact] > h2,
.wm-feedback-card [data-world-compact] > div, .wm-feedback-card [data-world-compact] > button { margin-left:38px; }
.wm-event-avatar { width:28px; height:28px; display:grid; place-items:center; flex:none; border-radius:50%; background:${c.layer2}; color:${c.tertiary}; font-size:11px; }
.wm-feedback-context { display:flex; align-items:center; gap:8px; min-width:0; color:${c.tertiary}; font-size:11px; line-height:1.6; margin:8px 0; }
.wm-feedback-context > span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wm-feedback-overlay { position:fixed; inset:0; z-index:10; pointer-events:none; }
.wm-feedback-overlay > [data-arkme-note-detail] { pointer-events:auto; }
.wm .wm-feedback-row { display:flex; align-items:center; gap:10px; width:100%; text-align:left; border:0; border-bottom:1px solid ${c.borderSoft}; background:transparent; color:${c.text}; padding:14px 0; cursor:pointer; }
.wm .wm-feedback-row:last-child { border-bottom:0; }
.wm .wm-feedback-row:hover { background:${c.hover}; }
.wm .wm-feedback-row[aria-pressed=true] { background:${c.accentSoft}; box-shadow:inset 2px 0 ${c.accent}; }
.wm-event-icon { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; flex:none; color:${c.secondary}; background:${c.layer1}; }
.wm-feedback-row[aria-pressed=true] .wm-event-icon { background:${c.base}; color:${c.accent}; }
.wm-event-main { min-width:0; flex:1; display:grid; gap:4px; }
.wm-event-main strong { font-size:13px; font-weight:500; overflow-wrap:anywhere; }
.wm-content-preview { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; color:${c.secondary}; font-size:12px; line-height:1.65; overflow-wrap:anywhere; }
.wm-detail-action { font-size:15px; font-weight:500; margin:20px 0 0; overflow-wrap:anywhere; }
.wm-activity-row { display:block; width:100%; text-align:left; padding:18px 0; border:0; border-bottom:1px solid ${c.borderSoft}; color:${c.text}; background:transparent; }
.wm-activity-row:hover:not(:disabled) { background:${c.hover}; }
.wm-activity-row .wm-content-preview { margin-top:7px; }
.wm-history-action { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:14px; }
.wm-unread { display:inline-block; width:6px; height:6px; border-radius:50%; background:${c.accent}; flex:none; }
.wm-list-footer { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; padding:12px 16px; }
.wm-archive { padding:16px; border:1px solid ${c.borderSoft}; border-radius:10px; margin-top:18px; background:${c.base}; }
.wm-archive .wm-archive-count { margin:16px 0 12px; font-size:12px; color:${c.secondary}; }
.wm-history { list-style:none; margin:16px 0; padding:0; }
.wm-history > li { padding:16px 0; border-bottom:1px solid ${c.borderSoft}; }
.wm-history p { margin:10px 0; }
.wm .wm-month { border:1px solid ${c.border}; border-radius:8px; padding:6px 9px; background:${c.base}; color:${c.text}; font-size:12px; }
.wm-preview-images { display:flex; gap:8px; margin:10px 0; max-width:480px; }
.wm-preview-tile { position:relative; width:112px; height:88px; overflow:hidden; border-radius:8px; background:${c.layer1}; }
.wm-preview-images[data-single=true] .wm-preview-tile { width:220px; height:140px; }
.wm-preview-images[data-detail=true][data-single=true] .wm-preview-tile { width:360px; height:220px; max-width:100%; }
.wm-preview-image { display:block; width:100%; height:100%; }
.wm-preview-image img { display:block; width:100%; height:100%; object-fit:cover; }
.wm-preview-large { display:flex; align-items:center; justify-content:center; }
.wm-preview-large img { object-fit:contain; }
.wm-image-placeholder { display:block; width:100%; height:100%; background:${c.layer2}; }
.wm .wm-image-open { position:absolute; inset:0; border:0; background:transparent; padding:0; }
.wm-image-open span { display:grid; place-items:center; width:100%; height:100%; background:#0006; color:white; font-size:20px; }
.wm-preview-image .wm-button { position:relative; z-index:2; white-space:normal; }
.wm-content-summary { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
.wm .wm-feedback-row:focus-visible { outline:2px solid ${c.accent}; outline-offset:2px; }
.wm-feedback-row[aria-disabled=true] { pointer-events:none; opacity:.6; }
@media(max-width:820px) { .wm-card { padding:16px; } .wm-tabs { gap:20px; } }
`}</style> }

export function WorldEmpty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return <div className="wm-empty"><span className="wm-empty-icon" aria-hidden>{icon}</span><strong>{title}</strong>{children && <p>{children}</p>}</div>
}
export function worldManagementTime(at: number) {
  return new Intl.DateTimeFormat(arkmeIntlLocale(), { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(at)
}

export function TeamWorldContentPreview({ preview }: { preview?: TeamWorldPreview | undefined }) {
  if (!preview) return <span className="wm-content-preview">{tr('当前无权查看原稿')}</span>
  const excerpt = [preview.title, preview.text].filter(Boolean).join(' · ')
  return <span className="wm-content-preview">{tr('当前原稿')} · {excerpt || tr('图片内容')}</span>
}
