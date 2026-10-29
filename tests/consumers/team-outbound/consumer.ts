import {ArkmeSdk,type TeamOutboundRecipient} from '@senguoyun/dsh-arkme/sdk'
export async function verifyInstalledReception(fetchImpl:typeof fetch,teamRef:string,recipient:TeamOutboundRecipient){
 const sdk=new ArkmeSdk({fetchImpl})
 const result=await sdk.teamOutboundOpen(teamRef,recipient,crypto.randomUUID())
 if(result.state!=='ready'||result.conversation.side!=='team'||result.conversation.lastSeq!==0)throw new Error('empty reception contract')
 const unsupported=new ArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))})
 let rejected=false;try{await unsupported.teamOutboundOpen(teamRef,recipient,'unsupported')}catch{rejected=true}
 if(!rejected)throw new Error('missing capability accepted')
 return result
}
