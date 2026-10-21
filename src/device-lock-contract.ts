/** Safe Host/SDK projection. Authentication evidence and session secrets stay in the native owner. */
export interface ArkmeDeviceLockSnapshot {
  available: boolean
  locked: boolean
  sessionEnded: boolean
  message: string
  operationState?: 'awaiting_confirmation' | 'awaiting_execution' | 'reconciling' | 'completed' | 'closed'
}
export interface ArkmeDeviceLockPort {
  deviceLockStatus(): Promise<ArkmeDeviceLockSnapshot>
  lockDevice(): Promise<ArkmeDeviceLockSnapshot>
  requestDeviceUnlock(): Promise<ArkmeDeviceLockSnapshot>
}
