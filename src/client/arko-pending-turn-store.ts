import { callArkme } from './api.js';
import { isValidArkoPendingTurn, type ArkmeArkoPendingTurn } from '../arko-turn-contract.js';
export { isValidArkoPendingTurn } from '../arko-turn-contract.js';
export type { ArkmeArkoPendingTurn } from '../arko-turn-contract.js';
export async function readArkoPendingTurn(userId: number): Promise<ArkmeArkoPendingTurn | undefined> {
    // Import a pending turn left by the released browser owner before reading
    // the durable Host owner. New turns are never written to browser storage.
    const key = `arkme:arko:pending-turn:v1:${String(userId)}`;
    let legacy: string | null = null;
    try {
        legacy = globalThis.sessionStorage?.getItem(key) ?? null;
    }
    catch { /* Storage can be disabled. */ }
    if (legacy !== null) {
        let turn: unknown;
        try {
            turn = JSON.parse(legacy);
        }
        catch { /* Preserve malformed evidence. */ }
        if (isValidArkoPendingTurn(turn, userId)) {
            await callArkme('arko.pending.prepare', { turn });
            try {
                if (globalThis.sessionStorage?.getItem(key) === legacy)
                    globalThis.sessionStorage.removeItem(key);
            }
            catch { /* A later import is idempotent at the Host owner. */ }
        }
    }
    const turns = await callArkme<ArkmeArkoPendingTurn[]>('arko.pending.read', { expectedUserId: userId });
    if (!Array.isArray(turns) || turns.some(turn => !isValidArkoPendingTurn(turn, userId)))
        throw new Error('Arko 发送恢复数据无效');
    return turns[0];
}
export async function writeArkoPendingTurn(turn: ArkmeArkoPendingTurn): Promise<boolean> {
    if (!isValidArkoPendingTurn(turn))
        return false;
    await callArkme('arko.pending.prepare', { turn });
    return true;
}
export async function removeArkoPendingTurn(userId: number, clientTurnUid: string): Promise<void> {
    await callArkme('arko.pending.acknowledge', { expectedUserId: userId, clientTurnUid });
}
