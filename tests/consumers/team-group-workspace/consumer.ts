import {ArkmeSdk, type TeamGroupJoinContext, type TeamWorkspacePage, type TeamWorkspaceFolder} from '@senguoyun/dsh-arkme/sdk'

function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message)}

/** Compiled outside the plugin checkout, resolving only the installed public SDK. */
export async function verifyInstalledTeamWorkspace(fetchImpl:typeof fetch,personalSourceRef:string) {
  const sdk=new ArkmeSdk({fetchImpl})
  try {
    const context=await sdk.teamGroups({operation:'join-context',sourceRef:personalSourceRef}) as TeamGroupJoinContext
    assert(context.state==='ready'&&context.teams[0]?.joined,'current admission')
    const folders=await sdk.teamWorkspace({operation:'folders'}) as TeamWorkspaceFolder[]
    assert(folders.length===1&&folders[0]?.groupCount===1,'group-only folder')
    const scoped=await sdk.teamWorkspace({operation:'folders',teamRef:context.teams[0].teamRef}) as TeamWorkspaceFolder[]
    assert(scoped.length===1&&scoped[0]?.channel.entryKey===folders[0]?.channel.entryKey,'scoped folder uses the same team owner')
    const page=await sdk.teamWorkspace({operation:'page',teamRef:context.teams[0].teamRef}) as TeamWorkspacePage
    const group=page.items.find(row=>row.kind==='group')
    assert(group?.kind==='group'&&group.source.accessKind==='team_delegation','independent team source')
    assert(group.source.sourceRef!==personalSourceRef,'explicit audience')
    const customer=page.items.find(row=>row.kind==='customer')
    assert(customer?.kind==='customer'&&customer.conversation.sourceOnly,'source-only customer does not open a DM')
    const cards=await sdk.teamWorkspace({operation:'cards',conversationRef:customer.conversation.ref}) as {items:Array<{source:{accessKind?:string}}>}
    assert(cards.items[0]?.source.accessKind==='team_delegation','source card retains current group audience')
    const timeline=await sdk.readSource(group.source.sourceRef,{limit:20})
    assert(timeline.source.accessKind==='team_delegation','read preserves audience')
    const unavailable=new ArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))})
    let rejected=false
    try {await unavailable.teamWorkspace({operation:'folders'})}catch{rejected=true}finally{unavailable.dispose()}
    assert(rejected,'missing capability fails explicitly')
    return {sourceRef:group.source.sourceRef,teamRef:context.teams[0].teamRef}
  } finally {sdk.dispose()}
}

export async function verifyInstalledOldBackend(fetchImpl:typeof fetch,personalSourceRef:string) {
 const sdk=new ArkmeSdk({fetchImpl})
 try {
  const context=await sdk.teamGroups({operation:'join-context',sourceRef:personalSourceRef}) as TeamGroupJoinContext
  assert(context.state==='backend_pending'&&context.teams.length===0,'server pending grants no admission')
  const timeline=await sdk.readSource(personalSourceRef,{limit:20})
  assert(timeline.source.accessKind!=='team_delegation','existing personal scope')
  let code=''
  try{await sdk.teamWorkspace({operation:'folders'})}catch(error){code=String((error as {body?:{code?:string}}).body?.code)}
  assert(code==='team-workspace-unsupported','missing backend workspace is explicit')
  return {context:context.state,timelineItems:timeline.items.length,workspace:code}
 }finally{sdk.dispose()}
}


export async function verifyInstalledTeamHistory(fetchImpl:typeof fetch,sourceRef:string,messageActionRef:string) {
 const sdk=new ArkmeSdk({fetchImpl})
 try {
  const page=await sdk.recordEditHistory(sourceRef,messageActionRef)
  assert(page.items.length===0,'an unedited message has no fabricated revision facts')
  const revisionUid='019d8592-ebb4-7232-90f2-999999999999'
  let code=''
  try{await sdk.recordRevisionSnapshot(sourceRef,messageActionRef,revisionUid)}catch(error){code=String((error as {body?:{code?:string}}).body?.code)}
  assert(code==='record-revision-not-found','exact revision reaches the authorized team frame and reports the missing revision')
  return {revisionUid,empty:true,exactMissing:code}
 }finally{sdk.dispose()}
}
