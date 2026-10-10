import {ArkmeSdk,type ArkmeTeamProfile,type ArkmeTeamProfileUpdate} from '@senguoyun/dsh-arkme/sdk';
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message)}
const profile:ArkmeTeamProfile={profileRef:'opaque',name:'团队',jotmoId:'exact_id',profileRevision:3,canEditProfile:true,avatar:{mode:'default',key:'default'}};
const calls:string[]=[];
const sdk=new ArkmeSdk({fetchImpl:async(_url,init)=>{
 init?.signal?.throwIfAborted();const input=JSON.parse(String(init?.body));calls.push(input.operation);
 let value:unknown;
 if(input.operation==='provider.capabilities')value={contractVersion:1,features:{teamProfiles:true}};
 else if(input.operation==='team.profile.get')value=profile;
 else if(input.operation==='team.profile.avatar.upload')value={uploadRef:'candidate'};
 else if(input.operation==='team.profile.update')value={requestUid:input.params.command.requestUid,acceptedRevision:4,profile};
 return new Response(JSON.stringify({ok:true,value}));
}});
const snapshot=await sdk.getTeamProfile('exact_id');assert(snapshot.profileRef==='opaque','profile reference');
const image=await sdk.uploadTeamAvatar(snapshot.profileRef,'YWJj','stable-image');
const command:ArkmeTeamProfileUpdate={requestUid:'stable-write',expectedRevision:snapshot.profileRevision,name:'新名',avatar:{action:'custom',uploadRef:image.uploadRef}};
assert((await sdk.updateTeamProfile(snapshot.profileRef,command)).acceptedRevision===4,'receipt');await sdk.abortTeamAvatar(image.uploadRef);
const unsupported=new ArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))});
let rejected=false;try{await unsupported.updateTeamProfile('opaque',command)}catch{rejected=true}assert(rejected,'missing capability');
rejected=false;try{await sdk.getTeamProfile('exact_id',AbortSignal.abort())}catch{rejected=true}assert(rejected,'caller cancellation');
assert(calls.includes('team.profile.avatar.abort'),'cleanup');console.log(JSON.stringify({acceptance:'external-consumer',capability:true,typedProfile:true,receipt:true,abort:true}));

/** Runs against an installed provider; transport may add the DSH session cookie. */
export async function verifyInstalledTeamProfile(fetchImpl:typeof fetch,contentBase64:string) {
 const provider=new ArkmeSdk({fetchImpl});
 const value=await provider.getTeamProfile('profile_test');
 const upload=await provider.uploadTeamAvatar(value.profileRef,contentBase64,crypto.randomUUID());
 await provider.abortTeamAvatar(upload.uploadRef);
 const receipt=await provider.updateTeamProfile(value.profileRef,{requestUid:crypto.randomUUID(),expectedRevision:value.profileRevision,name:value.name,avatar:{action:'default'}});
 assert(receipt.acceptedRevision===value.profileRevision+1,'installed provider exact receipt');return receipt;
}
