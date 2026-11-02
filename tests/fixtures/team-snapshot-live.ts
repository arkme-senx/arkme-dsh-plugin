// Integration wiring uses production facade, queue, file store and Team adapter.
// Only account credentials and unrelated profile/contacts are synthetic.
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ArkmeService} from '../../src/arkme-service.js'
import {TeamAppService} from '../../src/services/team-app-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../../src/services/service.js'
import type {ArkmeSessionStore} from '../../src/keychain-store.js'
import {FileTransfers,type FileTransferPorts} from '../../src/services/file-transfers.js'
import {TeamSendQueue} from '../../src/services/team-send-queue.js'
import type {TeamAppOperation} from '../../src/team-app-contract.js'
export async function liveTeamSnapshotStack(path:string){
 const fixture=JSON.parse(await readFile(path,'utf8')),origin=new URL(fixture.team)
 if(origin.hostname!=='127.0.0.1'||origin.port!=='33811')throw new Error('isolated owner stack only')
 const credentials={userId:2,accessToken:fixture.token,refreshToken:'synthetic-test-refresh'}
 const trace:{path:string;status:number;code:unknown;reason:unknown}[]=[]
 const gateway:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));if(url.hostname!=='t15.invalid')throw new Error(`unexpected authority ${url.hostname}`)
  const headers=new Headers(init?.headers);headers.set('Authorization',`Bearer ${fixture.token}`)
  const response=await fetch(new URL(url.pathname,origin),{...init,headers})
  const body=await response.clone().json() as {code?:unknown;data?:{reason?:unknown}}
  trace.push({path:url.pathname,status:response.status,code:body.code,reason:body.data?.reason})
  return response
 }
 const runtime=new ServiceRuntime({environment:'test',teamBaseUrl:'https://t15.invalid',requestTimeoutMs:10000,maxTextLength:20000} as ArkmeServiceConfig,{} as ArkmeSessionStore,{uniqueCode:async()=> 't15-cross-client-fixture'} as StateStore,gateway)
 runtime.requireSession=async()=>credentials;runtime.accountScopedSession=async()=>credentials
 const teamApp=new TeamAppService(runtime,{publicAvatarPresentationsByArkmeIds:async()=>new Map()},{} as never,{privateRemarksByUserIds:async()=>new Map()} as never,{} as never)
 const directory=await mkdtemp(join(tmpdir(),'t15-ui-owner-'))
 const unused=async()=>{throw new Error('unexpected unrelated transport')}
 const files=new FileTransfers(directory,{currentUser:async()=>2,upload:unused,send:unused,validateSource:unused,fetchMedia:unused} as FileTransferPorts,1000)
 const teamDelivery=new TeamSendQueue({currentUser:async()=>2,files:()=>files,
  identify:(ref,user)=>teamApp.conversationKey(ref,user),identifyReply:(ref,message,user)=>teamApp.replyKey(ref,message,user),
  metadataDigest:(ref,uid,capture,user)=>teamApp.sendMetadataDigest(ref,uid,capture,user),execute:(op,p,signal)=>teamApp.execute(op,p,signal)})
 const owner=Object.assign(Object.create(ArkmeService.prototype),{teamApp,teamDelivery}) as ArkmeService
 return {fixture,teamApp,teamDelivery,owner,trace,save:async()=>writeFile(path,JSON.stringify(fixture)+'\n',{mode:0o600}),dispatch:(op:TeamAppOperation,p:Record<string,unknown>,signal?:AbortSignal)=>owner.executeTeamApp(op,p,signal),close:async()=>{teamDelivery.dispose();await rm(directory,{recursive:true,force:true})}}
}
