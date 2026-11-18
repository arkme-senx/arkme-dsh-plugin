import { expect, it, vi } from 'vitest'
import { visibleMessageReadSequence } from '../src/client/visible-message-read.js'

function viewport(overrides: Partial<HTMLElement> = {}) {
  const row = (sequence: number, top: number, bottom: number) => ({
    dataset: { arkmeReadSequence: String(sequence) }, getBoundingClientRect: vi.fn(() => ({ top, bottom })),
  })
  const rows = [row(3618, -200, -100), row(3617, 450, 500), row(3619, 650, 750)]
  return { node: { scrollTop: 900, scrollHeight: 1500, clientHeight: 600, clientTop: 0,
    ownerDocument: { defaultView: { innerHeight: 1000 } }, getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelectorAll: vi.fn(() => rows), ...overrides } as unknown as HTMLElement, rows }
}

it('includes a backdated loaded message only at the confirmed latest edge', () => {
  const { node } = viewport()
  expect(visibleMessageReadSequence(node)).toBe(3617)
  expect(visibleMessageReadSequence(node, 3618)).toBe(3618)
})

it('keeps partial, stale and historical windows on visible rows', () => {
  expect(visibleMessageReadSequence(viewport().node, 0)).toBe(3617)
})

it('does not use the follow tolerance to mark a backdated row read before reaching bottom', () => {
  expect(visibleMessageReadSequence(viewport({ scrollTop: 899 }).node, 3618)).toBe(3617)
})

it('does not advance read for an offscreen viewport or hidden rows', () => {
  expect(visibleMessageReadSequence(viewport({ getBoundingClientRect: () => ({ top: -700, bottom: -100 }) as DOMRect }).node, 3618)).toBe(0)
  const { node, rows } = viewport()
  rows[0]!.getBoundingClientRect.mockReturnValue({ top: 0, bottom: 0 })
  expect(visibleMessageReadSequence(node)).toBe(3617)
})

it('uses avoids DOM scans when the confirmed cached frontier suffices', () => {
  const { node, rows } = viewport()
  visibleMessageReadSequence(node, 3618)
  expect(node.querySelectorAll).not.toHaveBeenCalled()
  for (const row of rows) expect(row.getBoundingClientRect.mock.calls.length).toBeLessThanOrEqual(1)
})

it('reads a confirmed cached frontier when virtualized history has no message DOM', () => {
  const { node } = viewport()
  vi.mocked(node.querySelectorAll).mockReturnValue([] as never)
  expect(visibleMessageReadSequence(node, 3618)).toBe(3618)
  expect(visibleMessageReadSequence(node)).toBe(0)
})

it('does not consume the cached frontier when the viewport is clipped', () => {
  const { node } = viewport({ ownerDocument: { defaultView: { innerHeight: 500 } } as unknown as Document })
  expect(visibleMessageReadSequence(node, 3618)).toBe(3617)
})

it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])('ignores invalid cached frontiers: %s', sequence => {
  expect(visibleMessageReadSequence(viewport().node, sequence)).toBe(3617)
})
