import { expect, it, vi } from 'vitest'
import { createProjectedHistory } from '../src/client/harness-projected-history.js'

const node = (node_ref: string, anchor_seq: number, kind = 'user') => ({ node_ref, anchor_seq, ordinal: 0, kind, time: 1000,
  data: kind === 'user' ? { content: [{ type: 'text', text: node_ref }] } : { blocks: [{ type: 'text', text: node_ref }] },
  presentation: { title: node_ref } }) as any

it('renders gapped projected bodies without creating or renumbering journal events', async () => {
  const read = vi.fn().mockResolvedValue({ nodes: [node('a', 100), node('b', 500, 'assistant')], complete: false, online: false })
  const history = createProjectedHistory(read)
  await history.load()
  const snapshot = history.getSnapshot()
  expect(snapshot.chat.order).toEqual(['a', 'b'])
  expect(snapshot.chat.nodes.get('b')?.anchorSeq).toBe(500)
  expect(snapshot.chat.nodes.get('b')?.data).toMatchObject({ blocks: [{ kind: 'text', text: 'b' }] })
  expect(snapshot.openState).toBe('open')
  expect(snapshot.chat.timeline.turns.size).toBe(0)
  history.dispose()
})

it('single-flights pages, keeps stable sources, and cancels stale completions on dispose', async () => {
  let complete!: (value: any) => void
  const read = vi.fn().mockResolvedValueOnce({ nodes: [node('b', 500)], nextCursor: { source: 'cloud', before: 500 } })
    .mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const history = createProjectedHistory(read)
  await history.load()
  const source = history.getSnapshot().chat.nodes.source('b')
  const pending = history.load(); void history.load()
  expect(read).toHaveBeenCalledTimes(2)
  history.dispose()
  expect(read.mock.calls[1][1].aborted).toBe(true)
  complete({ nodes: [node('a', 100)] }); await pending
  expect(source.getSnapshot()?.key).toBe('b')
  expect(history.getSnapshot().chat.order).toEqual(['b'])
})

it('retains visible messages on a failed older page and retries its exact cursor', async () => {
  const cursor = { source: 'cloud', before: 500 }
  const read = vi.fn().mockResolvedValueOnce({ nodes: [node('b', 500)], nextCursor: cursor })
    .mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ nodes: [node('a', 100), node('b', 500)] })
  const history = createProjectedHistory(read)
  await history.load(); await history.load()
  expect(history.getSnapshot().chat.order).toEqual(['b'])
  expect(history.getSnapshot().openError?.message).toBe('network')
  await history.load()
  expect(read.mock.calls[2][0]).toEqual(cursor)
  expect(history.getSnapshot().chat.order).toEqual(['a', 'b'])
  history.dispose()
})

it('reports nonadvancing cursors without discarding messages or automatically retrying', async () => {
  const cursor = { source: 'cloud', before: 500 }
  const read = vi.fn().mockResolvedValue({ nodes: [node('b', 500)], nextCursor: cursor })
  const history = createProjectedHistory(read)
  await history.load(); await history.load()
  expect(history.getSnapshot().openState).toBe('error')
  expect(history.getSnapshot().openError?.message).toContain('分页未前进')
  expect(history.getSnapshot().chat.order).toEqual(['b'])
  expect(read).toHaveBeenCalledTimes(2)
  history.dispose()
})

it('rejects an oversized page before publishing or caching it', async () => {
  const read = vi.fn().mockResolvedValue({ nodes: Array.from({ length: 5001 }, (_, i) => node(String(i), i)) })
  const history = createProjectedHistory(read)
  await history.load()
  expect(history.getSnapshot().openError?.message).toContain('容量上限')
  expect(history.getSnapshot().chat.order).toEqual([])
  expect(history.getSnapshot().chat.nodes.source('missing')).toBe(history.getSnapshot().chat.nodes.source('another'))
  history.dispose()
})

it('uses native tool cards with original arguments and output instead of an unknown event summary', async () => {
  const item = { ...node('tool:call-1', 40, 'tool'), data: { status: 'completed', call: { callId: 'call-1', name: 'read', arguments: '{"path":"some file.txt"}' },
    result: { message: { source: { callId: 'call-1' }, content: [{ type: 'text', text: 'original output' }] } } } }
  const history = createProjectedHistory(async () => ({ nodes: [item], complete: false, online: false }))
  await history.load()
  expect(history.getSnapshot().chat.nodes.get('tool:call-1')).toMatchObject({ kind: 'tool-call', data: { root: { kind: 'tool-result', name: 'read',
    call: { argsRaw: '{"path":"some file.txt"}' }, content: [{ type: 'text', text: 'original output' }] } } })
  history.dispose()
})
