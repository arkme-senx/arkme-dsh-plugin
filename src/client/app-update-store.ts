export type ArkmeAppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'failed'

export interface ArkmeAppUpdateSnapshot {
  status: ArkmeAppUpdateStatus
  currentVersion: string
  noUpdateAvailable?: boolean
  latestVersion?: string
  releaseNotes?: string
  error?: string
  downloadedBytes?: number
  totalBytes?: number
  downloadedFilePath?: string
}

export interface ArkmeAppUpdateStoreSnapshot {
  checked: boolean
  busy: boolean
  status?: ArkmeAppUpdateSnapshot
  error: string
}

const APP_UPDATE_STATUS_POLL_INTERVAL_MS = 1_000

interface ArkmeDesktopUpdateBridge {
  status: () => Promise<ArkmeAppUpdateSnapshot | null>
  check: () => Promise<ArkmeAppUpdateSnapshot | null>
  download: () => Promise<ArkmeAppUpdateSnapshot | null>
  showInFolder: () => Promise<boolean>
}

interface ArkmeDesktopScope {
  arkmeDesktop?: { update?: ArkmeDesktopUpdateBridge }
}

function updateBridge(): ArkmeDesktopUpdateBridge | undefined {
  return (globalThis as unknown as ArkmeDesktopScope).arkmeDesktop?.update
}

export class ArkmeAppUpdateStore {
  private readonly listeners = new Set<() => void>()
  private snapshot: ArkmeAppUpdateStoreSnapshot = { checked: false, busy: false, error: '' }
  private pending: Promise<ArkmeAppUpdateSnapshot | undefined> | undefined
  private statusPoller: ReturnType<typeof setInterval> | undefined

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ArkmeAppUpdateStoreSnapshot => this.snapshot

  start(): () => void {
    void this.refresh(true)
    this.statusPoller = setInterval(() => {
      const status = this.snapshot.status?.status
      if (status === 'checking' || status === 'downloading') void this.refresh(false)
    }, APP_UPDATE_STATUS_POLL_INTERVAL_MS)
    return () => {
      if (this.statusPoller !== undefined) clearInterval(this.statusPoller)
      this.statusPoller = undefined
    }
  }

  async refresh(check = false): Promise<ArkmeAppUpdateSnapshot | undefined> {
    if (this.pending !== undefined) return await this.pending
    const bridge = updateBridge()
    if (bridge === undefined) {
      this.setSnapshot({ checked: true, busy: false, error: 'APP 更新只在 Arkme 桌面端可用' })
      return undefined
    }
    this.setSnapshot({ ...this.snapshot, busy: check, error: '' })
    const task = (check ? bridge.check() : bridge.status())
      .then(status => {
        const normalized = status ?? undefined
        this.setSnapshot({ checked: true, busy: false, ...(normalized === undefined ? {} : { status: normalized }), error: '' })
        return normalized
      })
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        this.setSnapshot({ ...this.snapshot, checked: true, busy: false, error: message })
        return undefined
      })
      .finally(() => { this.pending = undefined })
    this.pending = task
    return await task
  }

  async download(): Promise<ArkmeAppUpdateSnapshot | undefined> {
    const previous = this.snapshot.status
    const {
      status: _status,
      downloadedBytes: _downloadedBytes,
      totalBytes: _totalBytes,
      downloadedFilePath: _downloadedFilePath,
      ...previousDetails
    } = previous ?? {}
    this.setSnapshot({
      ...this.snapshot,
      status: {
        ...previousDetails,
        status: 'downloading',
        currentVersion: previous?.currentVersion ?? '',
        downloadedBytes: 0,
      },
      error: '',
    })
    return await this.call('download')
  }

  async showDownloadedFile(): Promise<void> {
    const bridge = updateBridge()
    if (bridge === undefined) {
      this.setSnapshot({ ...this.snapshot, checked: true, busy: false, error: 'APP 更新只在 Arkme 桌面端可用' })
      return
    }
    try {
      if (!await bridge.showInFolder()) {
        this.setSnapshot({ ...this.snapshot, error: '未找到已下载的 APP 安装包，请重新下载' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setSnapshot({ ...this.snapshot, error: message })
    }
  }

  private async call(operation: 'download'): Promise<ArkmeAppUpdateSnapshot | undefined> {
    const bridge = updateBridge()
    if (bridge === undefined) {
      this.setSnapshot({ ...this.snapshot, checked: true, busy: false, error: 'APP 更新只在 Arkme 桌面端可用' })
      return undefined
    }
    this.setSnapshot({ ...this.snapshot, busy: true, error: '' })
    try {
      const status = await bridge[operation]()
      const normalized = status ?? undefined
      this.setSnapshot({ ...this.snapshot, checked: true, busy: false, ...(normalized === undefined ? {} : { status: normalized }), error: '' })
      return normalized
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setSnapshot({ ...this.snapshot, checked: true, busy: false, error: message })
      return undefined
    }
  }

  private setSnapshot(snapshot: ArkmeAppUpdateStoreSnapshot): void {
    this.snapshot = snapshot
    for (const listener of [...this.listeners]) listener()
  }
}

export const arkmeAppUpdateStore = new ArkmeAppUpdateStore()
