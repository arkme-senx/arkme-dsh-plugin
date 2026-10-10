import type { DshRemoteSessionPersistenceLike } from './host.js'

type Snapshot = Awaited<ReturnType<DshRemoteSessionPersistenceLike['listSnapshots']>>[number]
type History = Awaited<ReturnType<DshRemoteSessionPersistenceLike['readFrom']>>
interface HandlePersistence {
  list(options?: { signal?: AbortSignal }): Promise<readonly Snapshot[]>
  open(id: string, access: 'read', options?: { signal?: AbortSignal }): Promise<{
    header: History['meta']
    read(offset: number, length: number | undefined, options?: { signal?: AbortSignal }): Promise<{
      events: readonly History['events'][number][]
    }>
    close(): Promise<void>
  }>
}

/** Preserve legacy backends; adapt the public handle API introduced in DSH 0.1.5. */
export function adaptSessionPersistence(value: unknown): DshRemoteSessionPersistenceLike | undefined {
  if (value == null) return undefined
  const service = value as Partial<DshRemoteSessionPersistenceLike & HandlePersistence>
  if (typeof service.listSnapshots === 'function' && typeof service.readFrom === 'function') {
    return service as DshRemoteSessionPersistenceLike
  }
  if (typeof service.list !== 'function' || typeof service.open !== 'function') {
    const unsupported = async (): Promise<never> => {
      throw new Error('Unsupported DSH session persistence API: expected listSnapshots/readFrom or list/open')
    }
    return { listSnapshots: unsupported, readFrom: unsupported }
  }
  const persistence = service as HandlePersistence
  return {
    listSnapshots: async signal => [...await persistence.list(signal === undefined ? undefined : { signal })],
    readFrom: async (id, offset, signal) => {
      signal?.throwIfAborted()
      const options = signal === undefined ? undefined : { signal }
      const handle = await persistence.open(id, 'read', options)
      try {
        signal?.throwIfAborted()
        const { events } = await handle.read(offset, undefined, options)
        signal?.throwIfAborted()
        return { meta: handle.header, events: [...events] }
      } finally {
        await handle.close()
      }
    },
  }
}
