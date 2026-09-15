export type ArkmeAppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'failed'

export interface ArkmeAppUpdateSnapshot {
  status: ArkmeAppUpdateStatus
  currentVersion: string
  currentVersionCode: number
  canAutoInstall: boolean
  latestVersion?: string
  latestVersionCode?: number
  releaseNotes?: string
  checkedAtMillis?: number
  noUpdateAvailable?: boolean
  error?: string
  failureStage?: 'check' | 'download' | 'install'
  downloadedBytes?: number
  totalBytes?: number
}

export interface ArkmeAppUpdateStoreSnapshot {
  status?: ArkmeAppUpdateSnapshot
  error: string
}

interface ArkmeDesktopUpdateBridge {
  status: () => Promise<ArkmeAppUpdateSnapshot | null>
  onChanged: (listener: (state: ArkmeAppUpdateSnapshot | null) => void) => () => void
  open: () => Promise<boolean>
}

interface ArkmeDesktopScope {
  arkmeDesktop?: {
    appUpdateUi?: boolean
    update?: ArkmeDesktopUpdateBridge
  }
}

function updateBridge(): ArkmeDesktopUpdateBridge | undefined {
  const desktop = (globalThis as unknown as ArkmeDesktopScope).arkmeDesktop
  if (desktop?.appUpdateUi !== true) return undefined
  const update = desktop.update
  return update !== undefined
    && typeof update.status === 'function'
    && typeof update.onChanged === 'function'
    && typeof update.open === 'function'
    ? update
    : undefined
}

export class ArkmeAppUpdateStore {
  private readonly listeners = new Set<() => void>()
  private snapshot: ArkmeAppUpdateStoreSnapshot = { error: '' }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ArkmeAppUpdateStoreSnapshot => this.snapshot

  start(): () => void {
    const bridge = updateBridge()
    if (bridge === undefined) {
      this.setSnapshot({ error: '请升级 Arkme 客户端' })
      return () => undefined
    }

    let active = true
    let changeRevision = 0
    const initialRevision = changeRevision
    const unsubscribe = bridge.onChanged(status => {
      if (!active) return
      changeRevision += 1
      this.setSnapshot({ ...(status === null ? {} : { status }), error: '' })
    })
    void bridge.status().then(status => {
      if (!active || changeRevision !== initialRevision) return
      this.setSnapshot({ ...(status === null ? {} : { status }), error: '' })
    }).catch(error => {
      if (!active || changeRevision !== initialRevision) return
      this.setSnapshot({ ...this.snapshot, error: error instanceof Error ? error.message : String(error) })
    })

    return () => {
      if (!active) return
      active = false
      unsubscribe()
    }
  }

  async open(): Promise<boolean> {
    const bridge = updateBridge()
    if (bridge === undefined) {
      this.setSnapshot({ ...this.snapshot, error: '请升级 Arkme 客户端' })
      return false
    }
    try {
      const opened = await bridge.open()
      this.setSnapshot({ ...this.snapshot, error: opened ? '' : '无法打开 APP 更新' })
      return opened
    } catch (error) {
      this.setSnapshot({ ...this.snapshot, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  private setSnapshot(snapshot: ArkmeAppUpdateStoreSnapshot): void {
    this.snapshot = snapshot
    for (const listener of [...this.listeners]) listener()
  }
}

export const arkmeAppUpdateStore = new ArkmeAppUpdateStore()
