export type RecordingPickerBackend = 'desktop' | 'browser' | 'input'
export type RecordingPickerResult<T> =
  | { status: 'selected'; value: T }
  | { status: 'busy' | 'cancelled' }
  | { status: 'error'; message: string }

type PickerContext = Record<string, unknown>

export function recordingPickerStack(): string | undefined {
  return new Error().stack?.split('\n').slice(1, 7).join('\n')
    .replace(/(?:https?|file):\/\/[^\s)]+/g, url => `bundle${/:[0-9]+:[0-9]+$/.exec(url)?.[0] ?? ''}`)
}

/** One OS chooser per owner. Diagnostics intentionally contain no file paths or names. */
export class RecordingFilePicker {
  private active: { id: string; started: number; interruption?: string } | undefined
  private sequence = 0
  constructor(private readonly context: () => PickerContext = () => ({})) {}

  event(event: string, details: PickerContext = {}): void {
    try { console.info('[RecordingFilePicker]', JSON.stringify({
      event, requestId: this.active?.id, at: new Date().toISOString(),
      elapsedMillis: this.active ? Math.round(performance.now() - this.active.started) : undefined,
      ...this.context(), ...details,
    })) } catch { /* Diagnostics must never prevent the chooser from opening. */ }
  }

  interrupt(reason: string): void {
    if (this.active) this.active.interruption = reason
    this.event('owner-interrupted', { reason })
  }

  async run<T>(backend: RecordingPickerBackend, choose: () => Promise<T>): Promise<RecordingPickerResult<T>> {
    if (this.active) { this.event('duplicate-suppressed', { backend }); return { status: 'busy' } }
    this.active = { id: `${Date.now().toString(36)}-${++this.sequence}`, started: performance.now() }
    const request = this.active
    const observers: Array<() => void> = []
    if (typeof window !== 'undefined') {
      for (const name of ['blur', 'focus', 'pagehide'] as const) {
        const listener = () => {
          if (name === 'pagehide') request.interruption = name
          this.event(`window-${name}`)
        }
        window.addEventListener(name, listener)
        observers.push(() => window.removeEventListener(name, listener))
      }
      const listener = () => this.event('visibility-change', { visibility: document.visibilityState })
      document.addEventListener('visibilitychange', listener)
      observers.push(() => document.removeEventListener('visibilitychange', listener))
    }
    this.event('requested', { backend })
    try {
      const value = await choose()
      this.event('resolved', { backend, count: Array.isArray(value) ? value.length : undefined })
      return { status: 'selected', value }
    } catch (reason) {
      // DOMException may originate in another realm; instanceof Error loses its name there.
      const error = reason as { name?: unknown; message?: unknown } | null
      const name = typeof error?.name === 'string' ? error.name : 'Error'
      const message = (typeof error?.message === 'string' ? error.message : '无法选择文件')
        .replace(/(?:file:\/\/|\/(?:Users|Volumes|home|private)\/|[A-Za-z]:\\)[^\r\n"]+/g, '[path]')
      this.event('rejected', { backend, errorName: name, errorMessage: message, interruption: request.interruption,
        cancellationOwner: name === 'AbortError' ? 'unknown' : undefined })
      if (name === 'AbortError' && !request.interruption) return { status: 'cancelled' }
      return { status: 'error', message: name === 'AbortError'
        ? '文件选择器意外关闭，请重试' : `无法打开文件选择器：${message}` }
    } finally {
      observers.forEach(dispose => dispose())
      this.active = undefined
    }
  }
}
