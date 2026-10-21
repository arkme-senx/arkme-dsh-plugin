import { afterEach, expect, it, vi } from 'vitest'
import { callArkme } from '../src/client/api.js'
import { readArkoPendingTurn, writeArkoPendingTurn } from '../src/client/arko-pending-turn-store.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })

it('imports released browser recovery to the Host before removing the old copy', async () => {
  const turn = { userId: 7, sessionId: 88, clientTurnUid: '11111111-1111-4111-8111-111111111111', text: 'unsent', createdAtMillis: 1, localUserMessageId: 'local-u', localAssistantMessageId: 'local-a' }
  const key = 'arkme:arko:pending-turn:v1:7'
  const entries = new Map([[key, JSON.stringify(turn)]])
  const setItem = vi.fn()
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => entries.get(key) ?? null, removeItem: (key: string) => entries.delete(key), setItem })
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('Host offline'))
  await expect(readArkoPendingTurn(7)).rejects.toThrow('Host offline')
  expect(entries.has(key)).toBe(true)
  vi.mocked(callArkme).mockImplementation(async operation => operation === 'arko.pending.read' ? [turn] : undefined)
  expect(await readArkoPendingTurn(7)).toEqual(turn)
  expect(entries.has(key)).toBe(false)
  expect(vi.mocked(callArkme).mock.calls[1]).toEqual(['arko.pending.prepare', { turn }])
  await writeArkoPendingTurn(turn)
  expect(setItem).not.toHaveBeenCalled()
})
