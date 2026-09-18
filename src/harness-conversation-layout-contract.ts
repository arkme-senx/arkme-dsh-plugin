/** Optional, presentation-only exports from the installed Harness runtime. */
export const HARNESS_LAYOUT_MODULES = {
  width: { package: '@deepseek-ai/dsh-client-ui-conversation', id: '@senguoyun/dsh-arkme/native-width', path: '/arkme-self/native-width.js' },
  navigation: { package: '@deepseek-ai/dsh-client-ui-chat', id: '@senguoyun/dsh-arkme/native-turn-navigation', path: '/arkme-self/native-turn-navigation.js' },
} as const
export type HarnessLayoutPart = keyof typeof HARNESS_LAYOUT_MODULES
export const ARKME_WIDE_CONVERSATION_MIN = 900
