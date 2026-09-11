import { homeTourDiagnostic } from './home-tour-diagnostics.js'
import type { ArkmeAuthSnapshot } from '../types.js'

type HomeTourStorage = Pick<Storage, 'getItem' | 'setItem'>

export function homeTourAccountKey(auth: ArkmeAuthSnapshot | undefined): string | undefined {
  return auth?.status === 'authenticated' && Number.isSafeInteger(auth.userId) && auth.userId! > 0
    ? `${auth.environment}:${String(auth.userId)}` : undefined
}

export class ArkmeHomeTourSession {
  private readonly attempted = new Set<string>()

  constructor(private readonly getStorage: () => HomeTourStorage | undefined = () => typeof window === 'undefined' ? undefined : window.localStorage) {}

  tryStart(accountKey: string): boolean {
    if (this.attempted.has(accountKey)) { homeTourDiagnostic('start-denied', { accountKey, reason: 'page-attempted' }); return false }
    try {
      if (this.getStorage()?.getItem(`dsh-arkme:home-tour:v1:${accountKey}`) === 'done') { homeTourDiagnostic('start-denied', { accountKey, reason: 'stored-done' }); return false }
    } catch { homeTourDiagnostic('storage-read-unavailable', { accountKey }) }
    this.attempted.add(accountKey)
    homeTourDiagnostic('start-allowed', { accountKey })
    return true
  }

  finish(accountKey: string): void {
    homeTourDiagnostic('finish-recorded', { accountKey })
    this.attempted.add(accountKey)
    try { this.getStorage()?.setItem(`dsh-arkme:home-tour:v1:${accountKey}`, 'done') }
    catch { homeTourDiagnostic('storage-write-unavailable', { accountKey }) }
  }
}

export const arkmeHomeTourSession = new ArkmeHomeTourSession()
