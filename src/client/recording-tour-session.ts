export class ArkmeRecordingTourSession {
  private readonly attempted = new Set<string>()

  constructor(private readonly getStorage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined = () => typeof window === 'undefined' ? undefined : window.localStorage) {}

  tryStart(accountKey: string): boolean {
    if (this.attempted.has(accountKey)) return false
    try {
      if (this.getStorage()?.getItem(`dsh-arkme:recording-tour:v1:${accountKey}`) === 'done') return false
    } catch { /* Privacy settings can make even reading localStorage throw. */ }
    this.attempted.add(accountKey)
    return true
  }

  finish(accountKey: string): void {
    this.attempted.add(accountKey)
    try { this.getStorage()?.setItem(`dsh-arkme:recording-tour:v1:${accountKey}`, 'done') }
    catch { /* Keep the page-session memory when persistent storage is unavailable. */ }
  }
}

export const arkmeRecordingTourSession = new ArkmeRecordingTourSession()
