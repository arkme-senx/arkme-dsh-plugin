export interface ArkmeArkoPendingTurn {
  userId: number
  sessionId: number
  clientTurnUid: string
  text: string
  createdAtMillis: number
  localUserMessageId: string
  localAssistantMessageId: string
  modelRouteKey?: string
  replyToRunUid?: string
  replyToAssistantMsgId?: number
}

export interface ArkmeArkoPendingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const STORAGE_KEY_PREFIX = 'arkme:arko:pending-turn:v1:'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function defaultStorage(): ArkmeArkoPendingStorage | undefined {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? undefined : globalThis.sessionStorage
  } catch {
    return undefined
  }
}

function storageKey(userId: number): string {
  return `${STORAGE_KEY_PREFIX}${String(userId)}`
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

export function isValidArkoPendingTurn(value: unknown, expectedUserId?: number): value is ArkmeArkoPendingTurn {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const turn = value as Partial<ArkmeArkoPendingTurn>
  const hasContinuationRun = optionalTrimmedString(turn.replyToRunUid) !== undefined
  const hasContinuationMessage = Number.isSafeInteger(turn.replyToAssistantMsgId)
    && (turn.replyToAssistantMsgId ?? 0) > 0
  return Number.isSafeInteger(turn.userId) && (turn.userId ?? 0) > 0
    && (expectedUserId === undefined || turn.userId === expectedUserId)
    && Number.isSafeInteger(turn.sessionId) && (turn.sessionId ?? 0) > 0
    && typeof turn.clientTurnUid === 'string' && UUID_PATTERN.test(turn.clientTurnUid)
    && typeof turn.text === 'string' && turn.text.trim() !== ''
    && Number.isSafeInteger(turn.createdAtMillis) && (turn.createdAtMillis ?? 0) > 0
    && optionalTrimmedString(turn.localUserMessageId) !== undefined
    && optionalTrimmedString(turn.localAssistantMessageId) !== undefined
    && (turn.modelRouteKey === undefined || optionalTrimmedString(turn.modelRouteKey) !== undefined)
    && hasContinuationRun === hasContinuationMessage
    && (!hasContinuationRun || turn.modelRouteKey === undefined)
}

export function readArkoPendingTurn(
  userId: number,
  storage: ArkmeArkoPendingStorage | undefined = defaultStorage(),
): ArkmeArkoPendingTurn | undefined {
  if (!Number.isSafeInteger(userId) || userId <= 0 || storage === undefined) return undefined
  try {
    const encoded = storage.getItem(storageKey(userId))
    if (encoded === null) return undefined
    const value: unknown = JSON.parse(encoded)
    if (!isValidArkoPendingTurn(value, userId)) {
      storage.removeItem(storageKey(userId))
      return undefined
    }
    return value
  } catch {
    return undefined
  }
}

export function writeArkoPendingTurn(
  turn: ArkmeArkoPendingTurn,
  storage: ArkmeArkoPendingStorage | undefined = defaultStorage(),
): boolean {
  if (!isValidArkoPendingTurn(turn) || storage === undefined) return false
  try {
    storage.setItem(storageKey(turn.userId), JSON.stringify(turn))
    return true
  } catch {
    return false
  }
}

export function removeArkoPendingTurn(
  userId: number,
  storage: ArkmeArkoPendingStorage | undefined = defaultStorage(),
): void {
  if (!Number.isSafeInteger(userId) || userId <= 0 || storage === undefined) return
  try {
    storage.removeItem(storageKey(userId))
  } catch {
    // The in-memory state remains authoritative for the current mount.
  }
}
