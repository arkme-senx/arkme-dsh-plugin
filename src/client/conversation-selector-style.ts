/** Native DSH menu metrics, shared by both topic-menu entry points and the session adapter. */
export const CONVERSATION_MENU_LAYOUT = {
  width: 320,
  maxHeight: 560,
  paddingY: 8,
  paddingX: 10,
  rowHeight: 32,
  rowGap: 2,
  titleFontSize: 14,
  secondaryFontSize: 12,
  lineHeight: '20px',
  listBottomPadding: 16,
  fadeHeight: 24,
  createHeight: 38,
  hoverGap: 8,
  viewportInset: 12,
  scrollbarWidth: 8,
  scrollbarContentPadding: 2,
  scrollbarLingerMs: 2000,
} as const

/** Keep the current selection distinct from a transient hover in both menus. */
export const CONVERSATION_MENU_COLORS = {
  selected: '#eef1f8',
  hover: 'var(--dsw-alias-interactive-bg-hover, #f3f4f7)',
} as const

export const CONVERSATION_MENU_SURFACE = {
  background: 'var(--dsw-specific-sidebar-fill, #f9fafb)',
  border: '1px solid var(--dsw-alias-border-l3, #e5e7eb)',
  borderRadius: 10,
  boxShadow: '0 10px 32px #0000001f',
} as const

/** Shared by the native DSH adapter and the self-topic selector, including focus feedback. */
export const CONVERSATION_SELECTOR_CSS = `
/* Both menus use the native scrollbar tokens and a stable gutter. The list's
   own variables deliberately override the native sidebar's ancestor quietBars. */
[data-arkme-menu-scroll] {
  --dsh-scrollbar-thumb: transparent;
  --dsh-scrollbar-thumb-hover: transparent;
  scrollbar-gutter: stable;
  padding-right: ${CONVERSATION_MENU_LAYOUT.scrollbarContentPadding}px;
  padding-bottom: ${CONVERSATION_MENU_LAYOUT.listBottomPadding}px;
}
[data-arkme-menu-scrollbars="visible"] [data-arkme-menu-scroll] {
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
[data-arkme-menu-scroll]::-webkit-scrollbar { width: ${CONVERSATION_MENU_LAYOUT.scrollbarWidth}px; height: ${CONVERSATION_MENU_LAYOUT.scrollbarWidth}px; }
[data-arkme-menu-scroll]::-webkit-scrollbar-thumb { background: var(--dsh-scrollbar-thumb); border-radius: 4px; }
[data-arkme-menu-scroll]::-webkit-scrollbar-thumb:hover { background: var(--dsh-scrollbar-thumb-hover); }
[data-arkme-menu-scroll]::-webkit-scrollbar-track, [data-arkme-menu-scroll]::-webkit-scrollbar-corner { background: transparent; }
@supports not selector(::-webkit-scrollbar) {
  [data-arkme-menu-scroll] { scrollbar-width: thin; scrollbar-color: var(--dsh-scrollbar-thumb) transparent; }
}
/* Match DSH's solid selector footer and its native New Session / View Options controls. */
:is([data-arkme-workspace], [data-arkme-self-topic-menu]) .arkme-self-topic-create-button { flex: 1; }
:is([data-arkme-workspace], [data-arkme-self-topic-menu]) .arkme-self-topic-create-button,
[data-arkme-session-create] {
  min-width: 0;
  height: 38px;
  border: 1px solid var(--dsw-alias-border-l2, #dfe1e5);
  border-radius: 12px;
  background: var(--dsw-alias-button-elevated-fill, #fff);
  color: var(--dsw-alias-label-primary, #171923);
  padding: 8px 16px;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  white-space: nowrap;
}
:is([data-arkme-workspace], [data-arkme-self-topic-menu]) .arkme-self-topic-create-button:hover:not(:disabled),
[data-arkme-session-create]:hover:not(:disabled) {
  background: var(--dsw-alias-button-floating-hover, #f3f4f7);
  border-color: var(--dsw-alias-border-l2, #d9dade);
}
:is([data-arkme-workspace], [data-arkme-self-topic-menu]) .arkme-dsh-view-options-button,
[data-arkme-session-tools-actions] button {
  corner-shape: round;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
:is([data-arkme-workspace], [data-arkme-self-topic-menu]) .arkme-dsh-view-options-button:hover,
[data-arkme-session-tools-actions] button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
  [data-arkme-conversation-selector] {
    display: inline-flex; align-items: stretch; gap: 0; min-width: 0; max-width: 100%; height: 30px;
    border: 1px solid var(--dsw-alias-border-l3, #d4d6da); border-radius: 10px; padding: 0; margin-left: 0; box-sizing: border-box;
    color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-button-elevated-fill, #fff); font: inherit;
    font-size: 16px; font-weight: 600; line-height: 28px; overflow: hidden; cursor: pointer; outline: none;
  }
  [data-arkme-conversation-selector] > span:first-child { padding: 0 10px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  [data-arkme-conversation-selector] > span:last-child {
    color: var(--dsw-alias-label-secondary, #626872); flex: none; width: 28px;
    border-left: 1px solid var(--dsw-alias-border-l3, #d4d6da); display: flex; align-items: center; justify-content: center;
  }
  [data-arkme-conversation-selector][aria-expanded="true"] svg { transform: rotate(180deg); }
  [data-arkme-conversation-selector]:hover, [data-arkme-conversation-selector][aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover, #f3f4f6); }
  [data-arkme-conversation-selector]:focus-visible { outline: 2px solid #4c70ef; outline-offset: -2px; }
`
