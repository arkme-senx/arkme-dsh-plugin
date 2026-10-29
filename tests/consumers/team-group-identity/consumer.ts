import {ArkmeSdk,type TeamRepresentationSelection} from '@senguoyun/dsh-arkme/sdk';
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message)}
export async function verifyInstalledGroupIdentity(fetchImpl:typeof fetch,sourceRef:string){
 const sdk=new ArkmeSdk({fetchImpl});
 const context=await sdk.groupIdentityContext(sourceRef);
 assert(context.state==='ready'&&context.membershipPolicy==='independent','group candidate contract');
 const candidate=context.teams[0];assert(candidate?.representation,'ordinary member candidate');
 const selection:TeamRepresentationSelection=candidate.representation;
 const card=await sdk.teamPublicCard(candidate.jotmoId!);
 assert(card.navigation?.kind==='inbox'&&card.contact.state==='disabled','disabled member still has inbox');
 const unsupported=new ArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))});
 let rejected=false;try{await unsupported.groupIdentityContext(sourceRef)}catch{rejected=true}assert(rejected,'absent capability');
 const sent = await sdk.sendText(sourceRef,'代表身份连通验收',{recordUid:crypto.randomUUID(),relationUid:crypto.randomUUID(),sendAtMillis:1700000000123,representation:selection});
 assert(sent.localState==='synced','represented send receipt');
 return {context,card,selection,sent};
}
