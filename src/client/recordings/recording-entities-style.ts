export const RECORDING_ENTITY_STYLE = `
.arkme-entity-panel { font-size: 13px; }
.arkme-entity-panel button { font: inherit; color: inherit; cursor: pointer; border: 0; background: transparent; border-radius: 6px; padding: 7px 9px; }
.arkme-entity-panel button:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
.arkme-entity-panel button:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
.arkme-entity-panel button:disabled { cursor: default; opacity: .55; }
.arkme-entity-panel header { padding-top: max(32px, env(safe-area-inset-top)) !important; padding-bottom: 16px !important; }
.arkme-entity-status { margin: 0 10px 10px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, currentColor 6%, transparent); font-size: 12px; line-height: 1.5; }
.arkme-entity-status-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.arkme-entity-status button { flex-shrink: 0; padding: 3px 0; text-decoration: underline; }
.arkme-entity-status p { margin: 5px 0 0; }
.arkme-entity-types { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 10px; border-block: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
.arkme-entity-types button[aria-pressed=true] { background: color-mix(in srgb, currentColor 12%, transparent); font-weight: 600; }
.arkme-entity-items { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 8px; }
.arkme-entity-item { border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
.arkme-entity-item-title { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; min-height: 60px; }
.arkme-entity-item-title[aria-expanded=true] { background: color-mix(in srgb, currentColor 9%, transparent); }
.arkme-entity-item-title strong { display: block; overflow-wrap: anywhere; }
.arkme-entity-item-title small { display: block; opacity: .65; margin-top: 4px; }
.arkme-entity-item-title > span:last-child { flex-shrink: 0; font-size: 11px; opacity: .7; }
.arkme-entity-occurrences { padding: 0 5px 10px; }
.arkme-entity-occurrence { display: grid; gap: 5px; width: 100%; text-align: left; margin-block: 4px; border-left: 2px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 0 6px 6px 0; }
.arkme-entity-occurrences time { opacity: .65; font-variant-numeric: tabular-nums; font-size: 11px; }
.arkme-entity-occurrences span { overflow-wrap: anywhere; line-height: 1.65; }
 .arkme-entity-more { text-align: center; padding: 8px; }
.arkme-entity-participants { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 5px; padding: 0 5px 8px; font-size: 11px; line-height: 1.5; }
.arkme-entity-panel .arkme-entity-participants button { padding: 3px 5px; }
.arkme-entity-participants button[aria-pressed=true] { background: color-mix(in srgb, currentColor 12%, transparent); }
.arkme-entity-participants small, .arkme-entity-participants > span { opacity: .65; font-size: inherit; }
.arkme-entity-hint { margin: 0 18px 10px; font-size: 12px; opacity: .65; line-height: 1.5; }
.arkme-entity-mention { border-bottom: 1px solid color-mix(in srgb, currentColor 7%, transparent); padding-bottom: 4px; }
.arkme-entity-occurrence small { opacity: .7; font-size: 11px; }
.arkme-entity-panel .arkme-entity-feedback-toggle { padding: 2px 9px; font-size: 11px; opacity: .7; }
.arkme-entity-feedback-actions { padding: 4px 8px; border-radius: 6px; background: color-mix(in srgb, currentColor 4%, transparent); }
.arkme-entity-feedback-actions p { font-size: 11px; opacity: .7; margin: 3px 0; }
.arkme-entity-feedback-status { padding: 6px 18px; font-size: 12px; background: color-mix(in srgb, currentColor 5%, transparent); }
.arkme-entity-feedback-status p { margin: 3px 0; }
`
