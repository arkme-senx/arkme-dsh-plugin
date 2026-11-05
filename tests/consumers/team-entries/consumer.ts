import { ArkmeSdk, type TeamEntryReference, type TeamEntryPreferencePage } from '@senguoyun/dsh-arkme/sdk';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function verifyInstalledEntries(fetchImpl: typeof fetch, target: TeamEntryReference, operationId: string) {
  const sdk = new ArkmeSdk({ fetchImpl });
  const before: TeamEntryPreferencePage = await sdk.queryTeamEntryPreferences([target]);
  assert(before.schemaVersion === 1 && before.items[0]?.accessible, 'current authorized entry');
  const page = await sdk.changeTeamEntryPreferences({ operationId, changes: [{ target, action: 'pin', expectedVersion: before.items[0].version }] });
  assert(page.items[0]?.pinned && page.items[0].version > before.items[0].version, 'committed personal pin');
  assert((await sdk.listTeamEntryPreferences()).items.some(e => e.key === page.items[0]?.key), 'sparse cloud discovery');
  let rejected = false;
  try { await new ArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) }).changeTeamEntryPreferences({ operationId, changes: [{ target, action: 'unpin', expectedVersion: 0 }] }); } catch { rejected = true; }
  assert(rejected, 'unsupported provider must fail before write');
  // These request methods own no resources. AbortSignal scopes cancellation; no subscriptions survive the calls.
  return page;
}
