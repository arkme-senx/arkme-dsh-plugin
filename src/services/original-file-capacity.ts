import { lstat, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

interface CapacityState {
  bytes: number | undefined
  checkedAt: number
  reserved: number
  queued: number
  tail: Promise<void>
}
const states = new Map<string, CapacityState>()
const RECONCILE_AFTER_MS = 5 * 60_000

export interface OriginalCapacityReservation {
  publish(write: (account: (delta: number) => void) => Promise<void>): Promise<void>
  release(): Promise<void>
}

/** One shared accounting index per Host/account directory. Reconcile on first
 * use and on a later write after five minutes; there is no polling timer.
 * Cache publishing and reservations share a queue across MediaService/export. */
export class OriginalFileCapacity {
  constructor(private readonly directory: string, private readonly maximum: number) {}

  private state(): CapacityState {
    const key = `${this.maximum}:${this.directory}`
    let state = states.get(key)
    if (state) return state
    for (const [oldKey, old] of states) {
      if (states.size < 64) break
      if (!old.queued && !old.reserved) states.delete(oldKey)
    }
    if (states.size >= 64) throw new Error('too many active original caches')
    state = { bytes: undefined, checkedAt: 0, reserved: 0, queued: 0, tail: Promise.resolve() }
    states.set(key, state)
    return state
  }

  private async exclusive<T>(state: CapacityState, work: () => Promise<T>): Promise<T> {
    const previous = state.tail
    let release!: () => void
    state.tail = new Promise(resolve => { release = resolve })
    state.queued++
    await previous
    try { return await work() }
    finally { state.queued--; release() }
  }

  private async inventory() {
    const rows: Array<{ name: string; size: number; at: number }> = []
    let bytes = 0
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.blob$/.test(name)) continue
      try {
        const stat = await lstat(join(this.directory, name))
        if (!stat.isFile()) continue
        bytes += stat.size
        rows.push({ name, size: stat.size, at: stat.mtimeMs })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return { bytes, rows }
  }

  async reserve(bytes: number, keep: string): Promise<OriginalCapacityReservation> {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > this.maximum) throw new Error('invalid original reservation')
    const state = this.state()
    await this.exclusive(state, async () => {
      let snapshot: Awaited<ReturnType<OriginalFileCapacity['inventory']>> | undefined
      if (state.bytes === undefined || Date.now() - state.checkedAt >= RECONCILE_AFTER_MS) {
        snapshot = await this.inventory()
        state.bytes = snapshot.bytes
        state.checkedAt = Date.now()
      }
      if (state.bytes + state.reserved + bytes > this.maximum) {
        snapshot ??= await this.inventory()
        state.bytes = snapshot.bytes
        state.checkedAt = Date.now()
        snapshot.rows.sort((a, b) => a.at - b.at)
        for (const row of snapshot.rows) {
          if (state.bytes + state.reserved + bytes <= this.maximum) break
          if (row.name === keep) continue
          try {
            await unlink(join(this.directory, row.name))
            state.bytes -= row.size
            await unlink(join(this.directory, row.name.slice(0, -5) + '.json')).catch(() => {})
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') state.bytes -= row.size
          }
        }
      }
      if (state.bytes + state.reserved + bytes > this.maximum) throw new Error('original cache capacity reached')
      state.reserved += bytes
    })
    let active = true
    const release = async () => this.exclusive(state, async () => {
      if (active) { active = false; state.reserved -= bytes }
    })
    return {
      release,
      publish: write => this.exclusive(state, async () => {
        if (!active) throw new Error('original capture canceled')
        try { await write(delta => { state.bytes = Math.max(0, (state.bytes ?? 0) + delta) }) }
        finally { active = false; state.reserved -= bytes }
      }),
    }
  }
}
