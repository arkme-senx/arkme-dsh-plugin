export class ArkmeCallTourSession {
  private readonly attempted = new Set<string>()

  constructor(private readonly getStorage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined = () => typeof window === 'undefined' ? undefined : window.localStorage) {}

  tryStart(account: string): boolean {
    if (this.attempted.has(account)) return false
    try {
      if (this.getStorage()?.getItem(`dsh-arkme:call-tour:v1:${account}`) === 'done') return false
    } catch { /* Retain page-session behavior when storage is unavailable. */ }
    this.attempted.add(account)
    return true
  }

  finish(account: string): void {
    this.attempted.add(account)
    try { this.getStorage()?.setItem(`dsh-arkme:call-tour:v1:${account}`, 'done') }
    catch { /* The in-memory attempt still prevents repeating the guide. */ }
  }
}

export const arkmeCallTourSession = new ArkmeCallTourSession()
