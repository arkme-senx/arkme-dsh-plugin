/** Local, explicit composer action. Never exposed as an agent tool. */
export interface ArkmeDesktopScreenshotCapability {
  available: boolean
  reason?: string
}

export type ArkmeDesktopScreenshotResult =
  | { status: 'cancelled' }
  | { status: 'captured'; fileName: string; mimeType: 'image/png'; contentBase64: string }
