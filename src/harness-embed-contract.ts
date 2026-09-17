export const ARKME_HARNESS_EMBED_PATH = '/arkme-self/harness-frame'

export const HARNESS_SESSION_CLIENT_ID = '@senguoyun/dsh-arkme/harness-session'
export const HARNESS_SESSION_CLIENT_PATH = '/arkme-self/harness-session-client.js'
export const ARKME_HARNESS_MODEL_CLIENT_PATH = '/arkme-self/harness-model-client.js'
export const ARKME_HARNESS_ONBOARDING_CLIENT_PATH = '/arkme-self/harness-onboarding-client.js'
export const ARKME_HARNESS_TRAJECTORY_CLIENT_PATH = '/arkme-self/harness-trajectory-client.js'
export const ARKME_HARNESS_SIDEBAR_CLIENT_PATH = '/arkme-self/harness-sidebar-client.js'

/** Same-origin bridge owned and disposed by the embedded session client. */
export const HARNESS_SESSION_NAVIGATION_KEY = '__arkmeHarnessSessionNavigation'
export type HarnessSessionWindow = Window & {
  [HARNESS_SESSION_NAVIGATION_KEY]?: { open(sessionId: string): void; has(sessionId: string): Promise<boolean> }
}
export const ARKME_NATIVE_SELECTION_CLIENT_ID = '@senguoyun/dsh-arkme/harness-native-selection'
export const ARKME_NATIVE_SELECTION_CLIENT_PATH = '/arkme-self/harness-native-selection-client.js'
