import type { ArkmeLocalFile } from './file-transfer-contract.js';
import { ARKO_IMAGE_MIME_TYPES, ARKO_IMAGE_DRAFT_LIMIT } from './arko-image-contract.js';
export interface ArkmeArkoPendingTurn {
    userId: number;
    sessionId: number;
    clientTurnUid: string;
    text: string;
    images?: ArkmeLocalFile[];
    createdAtMillis: number;
    localUserMessageId: string;
    localAssistantMessageId: string;
    modelRouteKey?: string;
    replyToRunUid?: string;
    replyToAssistantMsgId?: number;
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function optionalTrimmedString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined; }
export function isValidArkoPendingTurn(value: unknown, expectedUserId?: number): value is ArkmeArkoPendingTurn {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const turn = value as Partial<ArkmeArkoPendingTurn>;
    if (turn.images !== undefined && (!Array.isArray(turn.images) || turn.images.length === 0
        || turn.images.length > ARKO_IMAGE_DRAFT_LIMIT
        || new Set(turn.images.map(file => file?.fileRef)).size !== turn.images.length
        || turn.images.some(file => !file || typeof file.fileRef !== 'string' || !/^arkme-file-v1\.[0-9a-f-]{36}$/.test(file.fileRef)
            || file.fileKind !== 1 || !ARKO_IMAGE_MIME_TYPES.some(mime => mime === file.mimeType)
            || typeof file.fileName !== 'string' || !Number.isSafeInteger(file.size) || file.size <= 0)))
        return false;
    const hasContinuationRun = optionalTrimmedString(turn.replyToRunUid) !== undefined;
    const hasContinuationMessage = Number.isSafeInteger(turn.replyToAssistantMsgId)
        && (turn.replyToAssistantMsgId ?? 0) > 0;
    return Number.isSafeInteger(turn.userId) && (turn.userId ?? 0) > 0
        && (expectedUserId === undefined || turn.userId === expectedUserId)
        && Number.isSafeInteger(turn.sessionId) && (turn.sessionId ?? 0) > 0
        && typeof turn.clientTurnUid === 'string' && UUID_PATTERN.test(turn.clientTurnUid)
        && typeof turn.text === 'string' && (turn.text.trim() !== '' || (turn.images?.length ?? 0) > 0)
        && Number.isSafeInteger(turn.createdAtMillis) && (turn.createdAtMillis ?? 0) > 0
        && optionalTrimmedString(turn.localUserMessageId) !== undefined
        && optionalTrimmedString(turn.localAssistantMessageId) !== undefined
        && (turn.modelRouteKey === undefined || optionalTrimmedString(turn.modelRouteKey) !== undefined)
        && hasContinuationRun === hasContinuationMessage
        && (!hasContinuationRun || turn.modelRouteKey === undefined);
}
export interface ArkmeArkoStoredTurn {
    turn: ArkmeArkoPendingTurn;
    request?: Record<string, unknown>;
}
export function validArkoStoredTurn(value: unknown, userId: number, uid: string): value is ArkmeArkoStoredTurn {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const entry = value as ArkmeArkoStoredTurn;
    return isValidArkoPendingTurn(entry.turn, userId) && entry.turn.clientTurnUid === uid
        && (entry.request === undefined || (typeof entry.request === 'object' && entry.request !== null && !Array.isArray(entry.request)
            && entry.request.client_turn_uid === uid && entry.request.session_id === entry.turn.sessionId && entry.request.content === entry.turn.text));
}
export interface ArkmeArkoAskOptions {
    sessionId?: number;
    clientTurnUid?: string;
    waitSeconds?: number;
    modelRouteKey?: string;
    replyToRunUid?: string;
    replyToAssistantMsgId?: number;
    imageFileRefs?: readonly string[];
    expectedUserId?: number;
}
export function sameArkoTurnIntent(left: ArkmeArkoPendingTurn, right: ArkmeArkoPendingTurn): boolean {
    const identity = (turn: ArkmeArkoPendingTurn) => [turn.userId, turn.sessionId, turn.clientTurnUid, turn.text, turn.images?.map(file => file.fileRef) ?? [], turn.modelRouteKey, turn.replyToRunUid, turn.replyToAssistantMsgId];
    return JSON.stringify(identity(left)) === JSON.stringify(identity(right));
}
