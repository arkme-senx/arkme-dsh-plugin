import { Component, type ErrorInfo, type ReactNode } from 'react'

interface NavigationState {
  mode: string
  selectedSource?: { sourceKey?: string; sourceRef: string; kind: string }
  selectedBot?: { botRef: string }
  calendarOpen?: boolean
}

/** Renderer-local labels correlate switches without logging names, refs or message bodies. */
export class WorkspaceNavigationTrace {
  private labels = new Map<string, number>()
  private nextLabel = 0
  private previous = ''
  private entries: Array<{ at: string; mode: string; source: number | null; kind: string | undefined; calendar: boolean }> = []
  record(state: NavigationState): void {
    const key = state.selectedSource
      ? `${state.selectedSource.kind}:${state.selectedSource.sourceKey ?? state.selectedSource.sourceRef}`
      : state.selectedBot ? `bot:${state.selectedBot.botRef}` : undefined
    let source = key === undefined ? null : this.labels.get(key)
    if (key !== undefined && source === undefined) {
      source = ++this.nextLabel
      this.labels.set(key, source)
      if (this.labels.size > 128) this.labels.delete(this.labels.keys().next().value!)
    }
    const value = { mode: state.mode, source: source ?? null,
      kind: state.selectedSource?.kind, calendar: state.calendarOpen === true }
    const signature = JSON.stringify(value)
    if (signature === this.previous) return
    this.previous = signature
    this.entries.push({ at: new Date().toISOString(), ...value })
    if (this.entries.length > 12) this.entries.shift()
  }
  snapshot() { return this.entries.map(entry => ({ ...entry })) }
}

let crashSequence = 0
function stackFrames(stack: string): string {
  // Drop free-form error messages; retain frames and remove URL query/fragment values.
  return stack.split('\n').filter(line => /^\s+at\s/.test(line))
    .map(line => line.replace(/(https?:\/\/[^\s?#)]+)[?#]([^\s)]*)/g,
      (_match, path: string, query: string) => path + (query.match(/:\d+:\d+$/)?.[0] ?? '')))
    .join('\n').slice(0, 16000)
}

export function reportWorkspaceCrash(error: unknown, info: ErrorInfo, trace: WorkspaceNavigationTrace): void {
  try {
    const id = `${Date.now()}-${++crashSequence}`
    const errorStack = error instanceof Error ? stackFrames(error.stack ?? '') : ''
    const componentStack = stackFrames(info.componentStack ?? '')
    console.error('[ArkmeWorkspaceCrash]', JSON.stringify({ id, event: 'crash',
      name: error instanceof Error ? error.name : typeof error,
      maximumUpdateDepth: error instanceof Error && /Maximum update depth|Minified React error #185/.test(error.message),
      navigation: trace.snapshot() }))
    // The desktop logger caps each console message at 4,000 characters.
    for (const [kind, stack] of [['error-stack', errorStack], ['component-stack', componentStack]] as const) {
      const parts = Math.ceil(stack.length / 800)
      for (let index = 0; index < parts; index++) {
        console.error('[ArkmeWorkspaceCrash]', JSON.stringify({ id, event: kind, part: index + 1, parts,
          text: stack.slice(index * 800, (index + 1) * 800) }))
      }
    }
  } catch { /* Preserve the original failure even when diagnostic output is unavailable. */ }
}

/** Report the component stack, then pass the same failure to the existing Harness boundary. */
export class WorkspaceCrashDiagnostics extends Component<{ children: ReactNode; trace: WorkspaceNavigationTrace }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportWorkspaceCrash(error, info, this.props.trace)
    throw error
  }
  render() { return this.state.failed ? null : this.props.children }
}
