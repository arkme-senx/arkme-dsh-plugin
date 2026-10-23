import { ArkmeSdk, type TeamNotificationPolicy } from '@senguoyun/dsh-arkme/sdk';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function verifyInstalledNotifications(fetchImpl: typeof fetch) {
 const sdk = new ArkmeSdk({fetchImpl});
 const page = await sdk.listTeamNotificationConversations('team');
 assert(page.items.length === 1, 'current conversation discovery');
 const ref = page.items[0]!.conversationRef;
 const before: TeamNotificationPolicy = await sdk.getTeamNotificationPolicy(ref);
 const after = await sdk.setTeamNotificationPolicy(ref, !before.muted);
 assert(after.muted !== before.muted && after.policyVersion > before.policyVersion, 'explicit committed preference');
 let rejected = false;
 const unsupported = new ArkmeSdk({fetchImpl: async () => new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))});
 try { await unsupported.setTeamNotificationPolicy(ref, true); } catch { rejected = true; }
 assert(rejected, 'capability absence must reject before write');
 return {ref, after};
}
