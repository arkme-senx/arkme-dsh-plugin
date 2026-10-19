import {randomUUID} from 'node:crypto'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {describe,it,expect} from 'vitest'
const dsh=process.env.ARKME_DSH_CHECKOUT,profile=process.env.ARKME_PACKED_PROFILE
if(!dsh||!profile||process.env.ARKME_EVIDENCE_TEST_ACCOUNT!=='3016')throw new Error('isolated official DSH and explicit TEST account required')
const imp=path=>import(/* @vite-ignore */ pathToFileURL(path).href)
const {launchWebScaffold}=await imp(join(dsh,'apps/web/tests/scaffold.ts'))
const {healProfilesModuleFallback}=await imp(join(dsh,'packages/boot/app-boot/src/index.ts'))
const harnessHome=resolve(profile,'../..')
healProfilesModuleFallback(join(dsh,'apps/cli/package.json'),harnessHome)
healProfilesModuleFallback(join(profile,'package.json'),harnessHome)
const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
if(!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme']??''))throw new Error('immutable officially installed tgz required')
const {createArkmeSdk}=await imp(join(profile,'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))
describe('speaker evidence immutable package on official Harness',()=>{
 it('uses real TEST authentication, SDK, session discovery and write confirmation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'speaker evidence host '));let scaffold
  try{
   const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:'com.senqisi.speaker-evidence-'+randomUUID(),allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business'}
   const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{insert:[{id:'speaker-evidence-test',name:'@senguoyun/dsh-arkme',config}]}]))
   scaffold=await launchWebScaffold({extraOverlayPath:overlay,harnessHome})
   const service=scaffold.ctx.get('arkmeData')
   expect(await service.testLogin(3016)).toMatchObject({status:'authenticated',userId:3016})
   const sdk=createArkmeSdk({fetchImpl:(_url,init)=>fetch(new URL('/arkme-self/api',scaffold.baseUrl),{...init,headers:{...init.headers,Origin:scaffold.baseUrl}})})
   expect(await sdk.recordingSpeakerEvidenceQuery({action:'capabilities'})).toMatchObject({supported:true,schema_version:1})
   const fixtureDay=Number(process.env.ARKME_EVIDENCE_TEST_DAY)
   if(Number.isSafeInteger(fixtureDay)&&fixtureDay>0){
    const page=await sdk.recordingSpeakerCorrectionItems({dateStamp:fixtureDay,atMillis:fixtureDay+36000000,transcriptSource:'system'})
    expect(page.items).toHaveLength(3)
    const refs=page.items.map(item=>item.itemRef)
    const evidence=await sdk.recordingSpeakerEvidenceQuery({action:'consistency',groupRefs:[refs[0]],itemRefs:refs})
    expect(evidence.groups[0]).toMatchObject({total_count:3,analyzed_count:3,state:'ready'})
    const members=await sdk.recordingSpeakerEvidenceQuery({action:'members',groupRefs:[refs[0]],limit:2,sort:'time'})
    expect(members.items).toHaveLength(2);expect(members.hasMore).toBe(true)
    const next=await sdk.recordingSpeakerEvidenceQuery({action:'members',groupRefs:[refs[0]],limit:2,sort:'time',cursor:members.nextCursor,version:members.version})
    expect(next.items).toHaveLength(1);expect(next.hasMore).toBe(false)
    expect(JSON.stringify(members)).not.toMatch(/session_id|child_id|embedding|formal_speaker_id/)
   }
   const handle=await scaffold.ctx.agents.create({sessionId:'speaker-evidence-'+randomUUID(),meta:{cwd:scaffold.workspaceCwd},agentOptions:{provider:'deepseek-official',model:'deepseek-v4-flash'}})
   const agent=handle.agent,signal=new AbortController().signal
   for(const name of ['arkme_recording_speaker_evidence','arkme_recording_speaker_evidence_build','arkme_recording_speaker_correction_context'])expect(scaffold.ctx.tools.get(name,agent)).toBeDefined()
   const call=(name,args)=>scaffold.ctx.tools.execute({callId:randomUUID(),name,arguments:args,agent,signal})
   const read=await call('arkme_recording_speaker_evidence',{request_json:JSON.stringify({action:'capabilities'})})
   expect(read.isError).toBe(false);expect(JSON.stringify(read)).toContain('correction-preview')
   const rejected=await call('arkme_recording_speaker_evidence',{request_json:JSON.stringify({action:'build',itemRefs:['untrusted']})})
   expect(rejected.isError).toBe(true)
   const pending=await call('arkme_recording_speaker_evidence_build',{request_json:JSON.stringify({action:'build',itemRefs:['untrusted']})})
   expect(pending.isError).toBe(false);expect(JSON.stringify(pending)).toContain('confirmation_required')
   // No fabricated approval or owner write: the real runtime must stop here.
   const controller=new AbortController();controller.abort()
   await expect(sdk.recordingSpeakerEvidenceQuery({action:'capabilities'},controller.signal)).rejects.toThrow()
  }finally{await scaffold?.ctx.get('arkmeData')?.logout().catch(()=>{});await scaffold?.close();await rm(root,{recursive:true,force:true})}
 },120000)
})
