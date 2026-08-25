/**
 * Arkme semantic colors. DSH owns the active light/dark/system preference and
 * swaps every referenced token when `data-ds-dark-theme` changes on `<body>`.
 * Arkme deliberately has no second theme store or independent toggle.
 */
export const arkmeTheme = {
  base: 'var(--dsw-alias-bg-base, #ffffff)',
  layer1: 'var(--dsw-alias-bg-layer-1, #f8f9fa)',
  layer2: 'var(--dsw-alias-bg-layer-2, #f3f4f6)',
  layer3: 'var(--dsw-alias-bg-layer-3, #ffffff)',
  sidebar: 'var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, #f8f9fa))',
  input: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-2, #ffffff))',
  menu: 'var(--dsw-specific-menu, var(--dsw-alias-bg-layer-3, #ffffff))',
  messageOwn: 'var(--arkme-chat-self-bubble, var(--dsw-alias-state-business-tertiary, #eef1f8))',
  messageOther: 'var(--dsw-specific-bubble, var(--dsw-alias-bg-layer-2, #f0f2f5))',
  memberRecordOther: 'var(--arkme-member-record-other-bubble, var(--dsw-specific-bubble-highlight, var(--dsw-alias-bg-layer-3, #e1e5ee)))',
  subtle: 'var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1, #f5f6f8))',
  elevated: 'var(--dsw-alias-button-elevated-fill, var(--dsw-alias-bg-layer-2, #ffffff))',
  primaryAction: 'var(--dsw-alias-button-primary-fill, #17191c)',
  onPrimaryAction: 'var(--dsw-alias-label-primary-inverted, #ffffff)',
  hover: 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))',
  active: 'var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.10))',
  text: 'var(--dsw-alias-label-primary, #17191c)',
  secondary: 'var(--dsw-alias-label-secondary, #68707c)',
  tertiary: 'var(--dsw-alias-label-tertiary, #9097a1)',
  caption: 'var(--dsw-alias-label-caption, #a3a8ae)',
  foreground: 'var(--dsw-static-neutral-bluish-00, #ffffff)',
  border: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.10))',
  borderSoft: 'var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04))',
  accent: 'var(--dsw-alias-state-business-primary, #8295e8)',
  accentSoft: 'var(--dsw-alias-state-business-tertiary, #f1f2f6)',
  info: 'var(--dsw-alias-state-business-primary, #3964fe)',
  infoSoft: 'var(--dsw-alias-state-business-tertiary, #e9f0ff)',
  danger: 'var(--dsw-alias-state-error-primary, #c2413b)',
  dangerSoft: 'var(--dsw-alias-interactive-bg-hover-danger, rgba(194, 65, 59, 0.10))',
  warning: 'var(--dsw-alias-state-warn-label, #a16207)',
  warningSoft: 'var(--dsw-alias-state-warn-tertiary, #fff8e6)',
  shadow: 'var(--dsw-shadow-lv2, 0 4px 16px rgba(0, 0, 0, 0.12))',
} as const

export type ArkmeThemeToken = keyof typeof arkmeTheme
