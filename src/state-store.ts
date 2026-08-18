import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { JotmoPendingWrite } from './types.js'

interface PersistedState {
  version: 1
  uniqueCode: string
  pendingByUser: Record<string, JotmoPendingWrite[]>
}

function emptyState(): PersistedState {
  return {
    version: 1,
    uniqueCode: randomUUID(),
    pendingByUser: {},
  }
}

function normalizedPending(value: unknown): JotmoPendingWrite[] {
  if (!Array.isArray(value)) return []
  const result: JotmoPendingWrite[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const source = item as Record<string, unknown>
    if (typeof source.recordUid !== 'string' || source.recordUid.trim() === '') continue
    if (typeof source.textContent !== 'string' || source.textContent.trim() === '') continue
    result.push({
      recordUid: source.recordUid,
      textContent: source.textContent,
      createdAtMillis: typeof source.createdAtMillis === 'number' ? source.createdAtMillis : 0,
      sendAtMillis: typeof source.sendAtMillis === 'number' ? source.sendAtMillis : 0,
      attempts: typeof source.attempts === 'number' ? source.attempts : 0,
      ...(typeof source.lastError === 'string' && source.lastError !== ''
        ? { lastError: source.lastError }
        : {}),
    })
  }
  return result
}

function parseState(raw: string): PersistedState {
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object') return emptyState()
  const source = parsed as Record<string, unknown>
  const pendingByUser: Record<string, JotmoPendingWrite[]> = {}
  if (source.pendingByUser !== null && typeof source.pendingByUser === 'object') {
    for (const [userId, pending] of Object.entries(source.pendingByUser as Record<string, unknown>)) {
      pendingByUser[userId] = normalizedPending(pending)
    }
  }
  return {
    version: 1,
    uniqueCode: typeof source.uniqueCode === 'string' && source.uniqueCode.trim() !== ''
      ? source.uniqueCode
      : randomUUID(),
    pendingByUser,
  }
}

export class JotmoStateStore {
  private readonly path: string
  private state: PersistedState | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(directory: string) {
    this.path = join(directory, 'state.json')
  }

  async uniqueCode(): Promise<string> {
    return await this.read(state => state.uniqueCode)
  }

  async listPending(userId: number): Promise<JotmoPendingWrite[]> {
    return await this.read(state => [...(state.pendingByUser[String(userId)] ?? [])])
  }

  async putPending(userId: number, pending: JotmoPendingWrite): Promise<void> {
    await this.update(state => {
      const key = String(userId)
      const current = state.pendingByUser[key] ?? []
      const next = current.filter(item => item.recordUid !== pending.recordUid)
      next.push(pending)
      state.pendingByUser[key] = next
    })
  }

  async markAttempt(userId: number, recordUid: string, error: string): Promise<void> {
    await this.update(state => {
      const pending = state.pendingByUser[String(userId)] ?? []
      const item = pending.find(candidate => candidate.recordUid === recordUid)
      if (item === undefined) return
      item.attempts += 1
      item.lastError = error.slice(0, 500)
    })
  }

  async removePending(userId: number, recordUid: string): Promise<void> {
    await this.update(state => {
      const key = String(userId)
      const next = (state.pendingByUser[key] ?? []).filter(item => item.recordUid !== recordUid)
      if (next.length === 0) {
        delete state.pendingByUser[key]
      } else {
        state.pendingByUser[key] = next
      }
    })
  }

  private async read<T>(reader: (state: PersistedState) => T): Promise<T> {
    let result!: T
    await this.serial(async () => {
      const state = await this.load()
      result = reader(state)
    })
    return result
  }

  private async update(mutator: (state: PersistedState) => void): Promise<void> {
    await this.serial(async () => {
      const state = await this.load()
      mutator(state)
      await this.write(state)
    })
  }

  private async serial(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work, work)
    this.queue = next.then(() => undefined, () => undefined)
    await next
  }

  private async load(): Promise<PersistedState> {
    if (this.state !== undefined) return this.state
    try {
      this.state = parseState(await readFile(this.path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.state = emptyState()
      await this.write(this.state)
    }
    return this.state
  }

  private async write(state: PersistedState): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 })
    await chmod(temporary, 0o600)
    await rename(temporary, this.path)
    await chmod(this.path, 0o600)
    this.state = state
  }
}
