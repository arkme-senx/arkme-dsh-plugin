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
