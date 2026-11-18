/** Safe account-scoped views. References contain no usable credentials. */
export interface LoginDevice {
  id: string
  ref: string
  name: string
  platform: string
  isCurrent: boolean
  presence: 'online' | 'offline' | 'unknown'
  lastActiveAt: number | null
  canLogout: boolean
  canForget: boolean
  notificationsSupported: boolean
}
export interface LoginDevicePage {
  accountScope: string
  items: LoginDevice[]
  total: number
  countComplete: boolean
  cursor?: string
  observedAt: number
}
export interface LoginEventPage {
  accountScope: string
  items: Array<{ id: string; at: number; name: string; kind: string; method: string }>
  cursor?: string
  coverageStart: number
}
export interface DeviceConfirmation {
  accountScope: string
  ticket: string
  kind: 'logout' | 'forget'
  name: string
  expiresAt: number
}
export interface DeviceOperation {
  accountScope: string
  ticket: string
  kind: 'logout' | 'forget'
  state: 'applied' | 'unknown'
  cleanup: 'pending' | 'complete' | 'not-applicable'
}
export interface DeviceNotifications {
  name: string
  accountScope: string
  messages: boolean
  calls: boolean
  revision: number
  supported: boolean
}
export type LoginDeviceRequest =
  | { action: 'list' | 'trusted' | 'events'; accountScope: string; cursor?: string }
  | { action: 'prepare'; accountScope: string; ref: string; kind: 'logout' | 'forget' }
  | { action: 'confirm' | 'operation'; accountScope: string; ticket: string }
  | { action: 'notifications'; accountScope: string; ref: string }
  | { action: 'set-notifications'; accountScope: string; ref: string; messages: boolean; calls: boolean; revision: number; requestId: string }
export type LoginDeviceResult = LoginDevicePage | LoginEventPage | DeviceConfirmation | DeviceOperation | DeviceNotifications
export interface LoginDevicePort {
  loginDevices(request: LoginDeviceRequest, signal?: AbortSignal): Promise<LoginDeviceResult>
}
