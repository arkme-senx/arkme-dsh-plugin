import { describe, expect, it } from 'vitest'
import {
  isValidArkoPendingTurn,
  readArkoPendingTurn,
  removeArkoPendingTurn,
  writeArkoPendingTurn,
  type ArkmeArkoPendingStorage,
  type ArkmeArkoPendingTurn,
} from '../src/client/arko-pending-turn-store.js'

function memoryStorage(): ArkmeArkoPendingStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  }
}

function pendingTurn(): ArkmeArkoPendingTurn {
  return {
    userId: 10001,
    sessionId: 88,
    clientTurnUid: '11111111-1111-4111-8111-111111111111',
    text: '帮我整理今天的快记',
    createdAtMillis: 1_786_000_000_000,
    localUserMessageId: 'local-user',
    localAssistantMessageId: 'local-assistant',
    modelRouteKey: 'deepseek-v4-flash',
  }
}

describe('Arko pending turn store', () => {
  it('restores the same client turn uid for the same account', () => {
    const storage = memoryStorage()
    const turn = pendingTurn()

    expect(writeArkoPendingTurn(turn, storage)).toBe(true)
    expect(readArkoPendingTurn(turn.userId, storage)).toEqual(turn)
    expect(readArkoPendingTurn(20002, storage)).toBeUndefined()
    removeArkoPendingTurn(turn.userId, storage)
    expect(readArkoPendingTurn(turn.userId, storage)).toBeUndefined()
  })

  it('rejects incomplete continuation identity and model switching during continuation', () => {
    expect(isValidArkoPendingTurn({ ...pendingTurn(), replyToRunUid: 'run-only' })).toBe(false)
    expect(isValidArkoPendingTurn({
      ...pendingTurn(),
      replyToRunUid: '22222222-2222-4222-8222-222222222222',
      replyToAssistantMsgId: 1002,
    })).toBe(false)
    expect(isValidArkoPendingTurn({
      ...pendingTurn(),
      modelRouteKey: undefined,
      replyToRunUid: '22222222-2222-4222-8222-222222222222',
      replyToAssistantMsgId: 1002,
    })).toBe(true)
  })
})
