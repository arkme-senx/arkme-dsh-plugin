import { Component, useLayoutEffect, useState, type ReactNode } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceCrashDiagnostics, WorkspaceNavigationTrace, reportWorkspaceCrash } from '../src/client/workspace-crash-diagnostics.js'

afterEach(() => vi.restoreAllMocks())

it('keeps bounded navigation history with stable anonymous labels and no message/source data', () => {
  const trace = new WorkspaceNavigationTrace()
  const first = { mode: 'source', selectedSource: { sourceRef: 'private-secret-ref', kind: 'group_chat' } }
  trace.record(first); trace.record(first)
  trace.record({ ...first, selectedSource: { ...first.selectedSource, sourceRef: 'second-secret-ref' } })
  trace.record(first)
  expect(trace.snapshot().map(x => x.source)).toEqual([1, 2, 1])
  expect(JSON.stringify(trace.snapshot())).not.toContain('secret-ref')
  for (let i = 0; i < 30; i++) trace.record({ mode: `mode-${i}` })
  expect(trace.snapshot()).toHaveLength(12)
})

it('captures a real nested layout-update failure and preserves the outer fallback', () => {
  const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
  const trace = new WorkspaceNavigationTrace()
  trace.record({ mode: 'source', selectedSource: { sourceRef: 'group-1', kind: 'group_chat' } })
  let caught: unknown
  class Outer extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() { return { failed: true } }
    componentDidCatch(error: unknown) { caught = error }
    render() { return this.state.failed ? <span>existing fallback</span> : this.props.children }
  }
  function Loop() {
    const [n, set] = useState(0)
    useLayoutEffect(() => { set(value => value + 1) })
    return <span>{n}</span>
  }
  let renderer: ReturnType<typeof create> | undefined
  act(() => { renderer = create(<Outer><WorkspaceCrashDiagnostics trace={trace}><Loop /></WorkspaceCrashDiagnostics></Outer>) })
  try {
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('Maximum update depth')
    expect(renderer!.root.findByType('span').children).toEqual(['existing fallback'])
    const records = logs.mock.calls.filter(call => call[0] === '[ArkmeWorkspaceCrash]').map(call => JSON.parse(call[1]))
    expect(records.find(row => row.event === 'crash')).toMatchObject({ maximumUpdateDepth: true })
    expect(records.filter(row => row.event === 'component-stack').map(row => row.text).join('')).toContain('Loop')
    expect(records.filter(row => row.event === 'error-stack').map(row => row.text).join('')).toContain('checkForNestedUpdates')
  } finally { act(() => renderer?.unmount()) }
})

it('chunks stacks below the desktop truncation limit and removes URL query values', () => {
  const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
  const error = new Error('sensitive arbitrary message')
  error.stack = error.message + '\n' + Array.from({ length: 80 }, () => '    at Reader (https://example.test/client.js?token=secret:123:45)').join('\n')
  reportWorkspaceCrash(error, { componentStack: '\n    at Reader (https://example.test/client.js?token=secret:123:45)' }, new WorkspaceNavigationTrace())
  expect(logs.mock.calls.length).toBeGreaterThan(3)
  for (const call of logs.mock.calls) {
    expect(call.join(' ').length).toBeLessThan(4000)
    expect(call.join(' ')).not.toContain('secret')
    expect(call.join(' ')).not.toContain('sensitive arbitrary')
  }
  expect(logs.mock.calls.map(call => call[1]).join('')).toContain('client.js:123:45')
})

it('does not mask the original failure when console logging fails', () => {
  vi.spyOn(console, 'error').mockImplementation(() => { throw new Error('logger failed') })
  expect(() => reportWorkspaceCrash(new Error('original'), { componentStack: '' }, new WorkspaceNavigationTrace())).not.toThrow()
})
