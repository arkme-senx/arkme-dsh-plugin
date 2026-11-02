import {ArkmeSdk} from '@senguoyun/dsh-arkme/sdk'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
const require=createRequire(import.meta.url)
const installed=createRequire(require.resolve('@senguoyun/dsh-arkme/package.json'))
const {createUserMessage,createToolResultMessage}=await import(pathToFileURL(installed.resolve('@deepseek-ai/dsh-llm')).href)
export const inject=['arkmeData','agents','tools','sessions','webServer']
function acceptance(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/__t22/acceptance',handler:async(req,res)=>{
 try{
 const host=ctx.get('arkmeData');await host.testLogin(99001001)
 const transport=async(input,init)=>{
  const response=await fetch(new URL(String(input),`http://${req.headers.host}`),{...init,headers:{...init?.headers,Origin:`http://${req.headers.host}`,Cookie:req.headers.cookie??''}})
  return response
 }; const sdk=new ArkmeSdk({fetchImpl:transport})
 const profile=await sdk.getTeamProfile('t22_test'),teamRef=profile.profileRef
 const candidates=await sdk.teamMemberManagement({teamRef,action:'candidates',source:'contacts'})
 if(candidates.items.length!==3)throw new Error('candidate source contract')
 const selected=candidates.items.find(p=>p.displayName.endsWith('99001004'))
 const result=await sdk.teamMemberManagement({teamRef,action:'add',candidateRefs:[selected.candidateRef],requestUid:'sdk-t22'})
 if(result.state!=='completed'||result.items[0].status!=='added')throw new Error('SDK actual receipt')
 await sdk.teamMemberManagement({teamRef,action:'ack',requestUid:result.requestUid})
 const {verifyMemberManagement}=await import('./member-consumer/out/consumer.js');
 await verifyMemberManagement(transport,'t22_test','同事99001003')
 const {agent}=await ctx.agents.create({sessionId:`t22-${randomUUID()}`,meta:{cwd:process.env.ARKME_T22_FIXTURE_DIR}});await agent.whenIdle()
 const schemas=ctx.tools.schemas(agent).map(t=>t.name)
 if(!schemas.includes('arkme_team_members_add')||!schemas.includes('arkme_team_member_candidates'))throw new Error('tool visibility')
 const invoke=async(args)=>{const callId=randomUUID(),name='arkme_team_members_add',call=agent.session.append('tool/call',{turn:1,step:1,callId,name,arguments:JSON.stringify(args)});const value=await ctx.tools.execute({agent,name,callId,arguments:args,signal:AbortSignal.timeout(15000)});agent.session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId,content:value.content,isError:value.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return value}
 const args={team_ref:teamRef,action:'add',candidate_refs:[selected.candidateRef]}
 const denied=await invoke(args);if(!JSON.stringify(denied).includes('confirmation_required'))throw new Error('write grant not enforced')
 agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'确认将所选同事直接加入团队'}],source:{kind:'user'}}),{surfaceOp:'append'})
 const actual=await invoke(args);if(actual.isError||!JSON.stringify(actual).includes('already_member'))throw new Error('tool actual business receipt')
 const saved=await sdk.teamMemberManagement({teamRef,action:'recover'});await sdk.teamMemberManagement({teamRef,action:'ack',requestUid:saved.requestUid})
 await ctx.sessions.flush(agent.session)
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({sdk:true,externalTypedConsumer:true,toolDiscovery:true,toolHumanGrant:true,toolActualReceipt:true,referenceSafety:!JSON.stringify(result).includes('actor_user_id')}))
 }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message,stack:error.stack}))}
}}),'T22 isolated acceptance')}

acceptance.inject=inject; export default acceptance
