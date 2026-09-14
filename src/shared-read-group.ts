interface ReadFlight<T> {
  controller: AbortController
  promise: Promise<T>
  consumers: number
}

/** Coalesce composite reads without occupying a transport scheduler permit. */
export class SharedReadGroup<T> {
  private readonly flights = new Map<string, ReadFlight<T>>()
  private readonly active = new Set<ReadFlight<T>>()

  async run(key: string, operation: (signal: AbortSignal, isCurrent: () => boolean) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    let flight = this.flights.get(key)
    if (flight === undefined) {
      const controller = new AbortController()
      const created: ReadFlight<T> = {
        controller,
        consumers: 0,
        promise: Promise.resolve().then(async () => {
          controller.signal.throwIfAborted()
          return await operation(controller.signal, () => this.flights.get(key) === created && !controller.signal.aborted)
        }).finally(() => {
          this.active.delete(created)
          if (this.flights.get(key) === created) this.flights.delete(key)
        }),
      }
      this.active.add(created)
      this.flights.set(key, created)
      flight = created
    }
    const current = flight
    current.consumers += 1
    try {
      if (signal === undefined) return await current.promise
      return await new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        void current.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      })
    } finally {
      current.consumers -= 1
      if (current.consumers === 0) {
        if (this.flights.get(key) === current) this.flights.delete(key)
        current.controller.abort()
      }
    }
  }

  /** Existing readers may finish, but an invalidated flight cannot publish or accept new readers. */
  invalidate(matches: (key: string) => boolean): void {
    for (const key of this.flights.keys()) if (matches(key)) this.flights.delete(key)
  }

  clear(): void {
    for (const flight of this.active) flight.controller.abort()
    this.active.clear()
    this.flights.clear()
  }
}
