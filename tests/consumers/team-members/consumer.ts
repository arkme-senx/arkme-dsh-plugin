import {ArkmeSdk,type TeamMemberAddResult,type TeamMemberManagementRequest} from '@senguoyun/dsh-arkme/sdk'
/** An independent plugin uses only the published SDK. Dispose its transport through its own AbortController. */
export async function verifyMemberManagement(fetchImpl:typeof fetch,jotmoId:string,label?:string):Promise<TeamMemberAddResult>{
 const sdk=new ArkmeSdk({fetchImpl}),profile=await sdk.getTeamProfile(jotmoId)
 const page=await sdk.teamMemberManagement({teamRef:profile.profileRef,action:'candidates',source:'contacts'})
 if('state'in page)throw new Error('candidate page required')
 const person=page.items.find(item=>!item.alreadyMember&&!item.isSelf&&(!label||item.displayName===label))
 if(!person)throw new Error('isolated eligible candidate required')
 const request:TeamMemberManagementRequest={teamRef:profile.profileRef,action:'add',candidateRefs:[person.candidateRef],requestUid:crypto.randomUUID()}
 const result=await sdk.teamMemberManagement(request)
 if(!('state'in result)||result.state!=='completed')throw new Error('complete receipt required')
 await sdk.teamMemberManagement({teamRef:profile.profileRef,action:'ack',requestUid:result.requestUid})
 const controller=new AbortController();controller.abort();let cancelled=false
 try{await sdk.teamMemberManagement({teamRef:profile.profileRef,action:'recover'},controller.signal)}catch{cancelled=true}
 if(!cancelled)throw new Error('caller lifecycle cancellation missing')
 const unsupported=new ArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))})
 let refused=false;try{await unsupported.teamMemberManagement(request)}catch{refused=true}
 if(!refused)throw new Error('missing capability accepted')
 return result
}
