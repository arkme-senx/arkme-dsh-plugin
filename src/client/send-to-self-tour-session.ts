export class ArkmeSendToSelfTourSession {
  private readonly attempted = new Set<string>()

  constructor(private readonly getStorage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined = () =>
    typeof window === 'undefined' ? undefined : window.localStorage) {}

  tryStart(account: string): boolean {
    if (this.attempted.has(account)) return false
    try {
      if (this.getStorage()?.getItem(`dsh-arkme:send-to-self-tour:v1:${account}`) === 'done') return false
    } catch { /* Fall back to the page session when storage is unavailable. */ }
    this.attempted.add(account)
    return true
  }

  finish(account: string): void {
    this.attempted.add(account)
    try { this.getStorage()?.setItem(`dsh-arkme:send-to-self-tour:v1:${account}`, 'done') }
    catch { /* The in-memory attempt still prevents repeated interruptions. */ }
  }
}

export const arkmeSendToSelfTourSession = new ArkmeSendToSelfTourSession()
