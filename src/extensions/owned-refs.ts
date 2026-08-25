import { randomUUID } from 'node:crypto'

export interface ArkmeOwnedCordisTarget {
  kind: 'cordis'
  sourceKey: string
  agentId: string
  pluginId: string
  packageId: string
}

export interface ArkmeOwnedProfileTarget {
  kind: 'profile-directory' | 'profile-tarball' | 'profile-installed'
  sourceKey: string
  packageName: string
  sourcePath: string
  specDigest: string
  artifactContractVersion: 2 | 3
}

export type ArkmeOwnedExtensionTarget = ArkmeOwnedCordisTarget | ArkmeOwnedProfileTarget

interface OwnedReferenceEntry {
  userId: number
  target: ArkmeOwnedExtensionTarget
  expiresAtMillis: number
}

/** Short-lived account-bound references for browser and SDK extension actions. */
export class ArkmeOwnedExtensionRefs {
  private readonly entries = new Map<string, OwnedReferenceEntry>()

  constructor(private readonly options: {
    ttlMillis?: number
    maxEntries?: number
    now?: () => number
  } = {}) {}

  issue(userId: number, target: ArkmeOwnedExtensionTarget): string {
    this.prune()
    const ref = `owned_${randomUUID()}`
    this.entries.set(ref, {
      userId,
      target: { ...target },
      expiresAtMillis: this.now() + (this.options.ttlMillis ?? 10 * 60_000),
    })
    const maxEntries = this.options.maxEntries ?? 1_000
    while (this.entries.size > maxEntries) this.entries.delete(this.entries.keys().next().value as string)
    return ref
  }

  resolve(userId: number, ref: string): ArkmeOwnedExtensionTarget {
    const entry = this.entries.get(ref)
    if (entry === undefined) throw new Error('扩展引用不存在或已失效')
    if (entry.expiresAtMillis <= this.now()) {
      this.entries.delete(ref)
      throw new Error('扩展引用已过期，请刷新列表')
    }
    if (entry.userId !== userId) throw new Error('扩展引用不属于当前账号')
    return { ...entry.target }
  }

  clearUser(userId: number): void {
    for (const [ref, entry] of this.entries) if (entry.userId === userId) this.entries.delete(ref)
  }

  private prune(): void {
    const now = this.now()
    for (const [ref, entry] of this.entries) if (entry.expiresAtMillis <= now) this.entries.delete(ref)
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}
