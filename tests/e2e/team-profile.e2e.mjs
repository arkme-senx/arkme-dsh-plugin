// Official installed DSH + Host/UI/Tools. An opt-in real Team/Record lane uses isolated Mongo and the cloud port.
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:https'
import {once} from 'node:events'
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {expect,it} from 'vitest'
import {createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm'
const dsh=process.env.ARKME_DSH_CHECKOUT,profile=process.env.ARKME_PACKED_PROFILE
if(!dsh||!profile||!process.env.ARKME_E2E_TLS_KEY||!process.env.NODE_EXTRA_CA_CERTS)throw new Error('Isolated official DSH/profile/TLS fixture required')
const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
if(!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme']??''))throw new Error('Install immutable tgz through official CLI')
const {launchWebScaffold}=await import(pathToFileURL(join(dsh,'apps/web/tests/scaffold.ts')).href)
const {chromium}=createRequire(join(dsh,'apps/web/package.json'))('playwright')
it('edits owner profile, crops/uploads/resets, blocks members, and invokes the real session tool',async()=>{
 const root=await mkdtemp(join(tmpdir(),'arkme team profile ')),image=await readFile(new URL('../../assets/branding/jiwo-about-icon.png',import.meta.url))
 let scaffold,browser,page,origin,owner=true,name='资料验收团队',revision=0,custom=false,asset=0,uploadedImage
 const realDir=process.env.ARKME_TEAM_PROFILE_REAL_SERVER_DIR
 const realTeam=realDir?JSON.parse(await readFile(join(realDir,'team-ready.json'),'utf8')):undefined
 const realRecord=realDir?JSON.parse(await readFile(join(realDir,'record-ready.json'),'utf8')):undefined
 const receipts=new Map(),calls=[],errors=[]
 const team=()=>({team_id:42,name,jotmo_id:'profile_test',owner_user_id:99001001,role:owner?1:3,profile_revision:revision,can_edit_profile:owner,member_count:1,avatar:{mode:custom?'custom':'default',key:custom?`team:42:asset:${asset}`:`default:${name}`,url:custom?`https://bucket.team-profile-fixture.invalid/avatar?asset=${asset}`:''}})
 const api=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const path=new URL(req.url,'https://localhost').pathname
  if(path==='/fixture-image'){if(req.method==='PUT'){uploadedImage=Buffer.concat(chunks);calls.push({path,input:{method:'PUT',contentType:req.headers['content-type'],authorization:req.headers.authorization,size:uploadedImage.length}});res.writeHead(200);res.end();return}res.writeHead(200,{'content-type':uploadedImage?'image/jpeg':'image/png'});res.end(uploadedImage??image);return}
  const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');calls.push({path,input})
  if(realTeam && /^\/api\/(v1|public\/v1)\/team\/(profile\/|list-mine$|message-channel\/)/.test(path)){
   const reply=await realFetch(realTeam.url+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:req.headers.authorization??''},body:JSON.stringify(input)})
   const body=await reply.text();const parsed=JSON.parse(body);const current=parsed.data?.team??parsed.data?.teams?.[0];
   if(current){name=current.name;revision=current.profile_revision;custom=current.avatar?.mode==='custom'}
   res.writeHead(reply.status,{'content-type':'application/json'});res.end(body);return
  }
  let code=200,data={items:[],users:[],sources:[],has_more:false}
  if(path.endsWith('/the-best-api-for-testing')){const token=[{alg:'none'},{user_id:input.user_id,exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture';data={access_token:realTeam?.owner_token??token,refresh_token:'profile-fixture'}}
  else if(path.endsWith('/get-user-info'))data={user_id:99001001,nick_name:'资料验收',jotmo_id:'profile_user',phone:'13800000000'}
  else if(path.endsWith('/team/list-mine'))data={teams:[team()]}
  else if(path.endsWith('/team/members/list'))data={items:[],total_count:0,has_more:false}
  else if(path.endsWith('/profile/get'))data={team:team()}
  else if(path.endsWith('/profile/update')){
   if(!owner){code=1001;data={reason:'not_owner'}}else if(input.expected_revision!==revision){code=1001;data={reason:'version_conflict'}}else{if(input.name)name=input.name;if(input.avatar)custom=input.avatar.action==='custom';revision++;data={request_uid:input.request_uid,accepted_revision:revision,team:team()};receipts.set(input.request_uid,data)}
  }else if(path.endsWith('/profile/update/status'))data=receipts.get(input.request_uid)??{request_uid:input.request_uid,accepted_revision:0,team:team()}
  else if(path.endsWith('/prepare-upload')){asset++;data={upload_url:'https://bucket.team-profile-fixture.invalid/temporary',upload_headers:{'content-type':'image/jpeg'}}}
  else if(path.endsWith('/complete-upload'))data={file_asset_uid:`sealed-${asset}`}
  else if(path.endsWith('/message-channel/get'))data={team_id:42,name,jotmo_id:'profile_test',public_ref:'a'.repeat(32),enabled:false,revision:1,can_manage:owner,can_pause:owner}
  else if(path.endsWith('/join-applications/list'))data={items:[],has_more:false}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({code,data}))
 })
 const realFetch=globalThis.fetch
 try{
  api.listen(0,'127.0.0.1');await once(api,'listening');origin=`https://127.0.0.1:${api.address().port}`
  // Only storage fixture transport is replaced; signed locators remain inside the packaged Host.
  globalThis.fetch=async(input,init)=>new URL(String(input)).hostname==='bucket.team-profile-fixture.invalid'?realFetch(realRecord?`${realRecord.url}${new URL(String(input)).pathname}${new URL(String(input)).search}`:`${origin}/fixture-image`,init):realFetch(input,init)
  const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:`com.senqisi.profile-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
  for(const key of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[`${key}BaseUrl`]=origin
  const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{insert:[{id:'arkme-team-profile-test',name:'@senguoyun/dsh-arkme',config}]}]))
  scaffold=await launchWebScaffold({harnessHome:resolve(profile,'../..'),extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'package.json')],replayFixture:resolve(dsh,'snapshots/web/plan-narrow-viewport/session.v3.jsonl'),replayProvidersOnly:true,compareReplaySession:false})
  const host=scaffold.ctx.get('arkmeData');expect(await host.testLogin(99001001)).toMatchObject({status:'authenticated'})
  const {agent}=await scaffold.ctx.agents.create({sessionId:`team-profile-${randomUUID()}`,meta:{cwd:root}});await agent.whenIdle()
  expect(scaffold.ctx.tools.schemas(agent).map(t=>t.name)).toEqual(expect.arrayContaining(['arkme_team_profile','arkme_team_profile_update']))
  const result=await scaffold.ctx.tools.execute({agent,name:'arkme_team_profile',callId:randomUUID(),arguments:{jotmo_id:'profile_test'},signal:AbortSignal.timeout(10000)})
  expect(result.isError).toBe(false);expect(JSON.stringify(result.value)).toContain('canEditProfile');expect(JSON.stringify(result.value)).not.toContain('owner_user_id')
  const snapshot=await host.getTeamProfile('profile_test');revision=snapshot.profileRevision;const args={profile_ref:snapshot.profileRef,expected_revision:revision,name,avatar_action:'default'}
  const invoke=async()=>{const callId=randomUUID(),call=agent.session.append('tool/call',{turn:1,step:1,callId,name:'arkme_team_profile_update',arguments:JSON.stringify(args)});const result=await scaffold.ctx.tools.execute({agent,name:'arkme_team_profile_update',callId,arguments:args,signal:AbortSignal.timeout(10000)});agent.session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result}
  expect(JSON.stringify(await invoke())).toContain('confirmation_required')
  agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'确认保存所选团队资料'}],source:{kind:'user'}}),{surfaceOp:'append'})
  const saved=await invoke();expect(saved.isError).toBe(false);expect(JSON.stringify(saved.value)).toContain('acceptedRevision');expect(revision).toBe(snapshot.profileRevision+1)
  await scaffold.ctx.sessions.flush(agent.session)
  browser=await chromium.launch({channel:'chrome'});page=await browser.newPage({viewport:{width:1200,height:900}});page.on('pageerror',e=>errors.push(e))
  await page.goto(scaffold.authenticatedUrl)
  const {verifyInstalledTeamProfile}=await import(pathToFileURL(join(profile,'team-profile-consumer/out/consumer.js')).href)
  await verifyInstalledTeamProfile(async(input,init)=>{const response=await page.request.fetch(new URL(String(input),scaffold.authenticatedUrl).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:new URL(scaffold.authenticatedUrl).origin}});return new Response(await response.body(),{status:response.status(),headers:response.headers()})},image.toString('base64'));expect(revision).toBe(snapshot.profileRevision+2)
  await page.getByRole('button',{name:'联系人',exact:true}).click()
  const section=page.locator('[data-directory-section="teams"]'),toggle=section.locator('.arkme-contact-directory-section-header');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
  await section.getByRole('button',{name:/资料验收团队/}).click()
  const detail=page.locator('.arkme-team-detail');await detail.getByRole('button',{name:'编辑团队',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'编辑团队',exact:true});await dialog.waitFor();await dialog.getByRole('textbox',{name:'团队名称'}).fill('已修改团队')
  await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>name).toBe('已修改团队');await expect.poll(()=>dialog.count()).toBe(0)
  await detail.getByRole('button',{name:'编辑团队',exact:true}).click();dialog=page.getByRole('dialog',{name:'编辑团队',exact:true});await dialog.waitFor()
  await dialog.locator('input[type=file]').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:image})
  const crop=dialog.getByRole('dialog',{name:'裁剪团队头像'});await crop.waitFor();await expect.poll(()=>crop.getByRole('button',{name:'确认裁剪'}).isEnabled()).toBe(true);await crop.getByRole('button',{name:'确认裁剪'}).click();await expect.poll(()=>crop.count()).toBe(0)
  await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>custom).toBe(true);await expect.poll(()=>dialog.count()).toBe(0)
  await detail.locator('[data-arkme-avatar] img').first().waitFor();expect(calls.some(c=>c.path.endsWith('/prepare-upload'))).toBe(true);if(!realTeam)expect(calls.find(c=>c.input.method==='PUT')?.input).toMatchObject({contentType:'image/jpeg'});expect(calls.find(c=>c.input.method==='PUT')?.input.authorization).toBeUndefined();if(!realTeam)expect(uploadedImage?.subarray(0,2).toString('hex')).toBe('ffd8')
  const captures=process.env.ARKME_E2E_CAPTURE_DIR;if(captures){await mkdir(captures,{recursive:true});await page.screenshot({path:join(captures,'team-custom-avatar.png')})}
  await detail.getByRole('button',{name:'编辑团队',exact:true}).click();dialog=page.getByRole('dialog',{name:'编辑团队',exact:true});await dialog.getByRole('button',{name:'更换团队头像',exact:true}).click();let menu=dialog.getByRole('menu',{name:'团队头像操作'});await menu.waitFor();expect(await menu.getByRole('menuitem',{name:/使用名称头像/}).count()).toBe(1);await page.keyboard.press('Escape');await expect.poll(()=>menu.count()).toBe(0);expect(await dialog.isVisible()).toBe(true);await dialog.getByRole('textbox',{name:'团队名称'}).fill('ab团队');await dialog.getByRole('button',{name:'更换团队头像',exact:true}).click();menu=dialog.getByRole('menu',{name:'团队头像操作'});await menu.waitFor();expect(await menu.locator('.arkme-team-name-avatar').innerText()).toBe('AB')
  await page.setViewportSize({width:650,height:800});expect((await dialog.boundingBox()).width).toBeLessThan(620);expect(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true)
  expect(await menu.getByText('随团队名称自动更新').evaluate(n=>{const rect=n.getBoundingClientRect();return n.closest('[role=menu]').contains(document.elementFromPoint(rect.left+rect.width/2,rect.bottom-2))})).toBe(true);
  if(captures){await page.screenshot({path:join(captures,'team-avatar-menu.png')});const box=await dialog.boundingBox(),menuBox=await menu.boundingBox();await page.screenshot({path:join(captures,'team-avatar-menu-detail.png'),clip:{x:box.x-12,y:box.y-12,width:box.width+24,height:Math.max(box.y+box.height,menuBox.y+menuBox.height)-box.y+24}})};await menu.getByRole('menuitem',{name:/使用名称头像/}).click();await expect.poll(()=>menu.count()).toBe(0);expect(await dialog.locator('.arkme-team-name-avatar').innerText()).toBe('AB');if(captures)await page.screenshot({path:join(captures,'team-editor-narrow.png')})
  await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>custom).toBe(false);await expect.poll(()=>name).toBe('ab团队');await expect.poll(()=>detail.locator('.arkme-team-name-avatar').innerText()).toBe('AB')
  // The same Host adapter rejects an old owner command after authority changes.
  const latest=await host.getTeamProfile('profile_test');owner=false
  if(realTeam){const changed=await realFetch(realTeam.url+'/__test/owner',{method:'POST',headers:{'X-Internal-Secret':'local-team-profile-internal',Authorization:'Bearer '+realTeam.owner_token}});expect(changed.status).toBe(204)}
  await expect(host.updateTeamProfile(latest.profileRef,{requestUid:'denied',expectedRevision:revision,name:'越权'})).rejects.toMatchObject({code:'team-not_owner'});expect(name).toBe('ab团队')
  await page.reload();await page.getByRole('button',{name:'联系人',exact:true}).click();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await section.getByRole('button',{name:/ab团队/}).click()
  await detail.getByRole('heading',{name:'团队成员',exact:true}).waitFor();expect(await detail.getByRole('button',{name:'编辑团队',exact:true}).count()).toBe(0)
  expect(errors).toEqual([]);console.log(JSON.stringify({acceptance:'installed-team-profile',tools:'real-session-read+confirmed-write',ui:'rename+crop+custom+name-avatar-menu+keyboard+member+narrow',sdk:'external-consumer-installed-host',backend:realTeam?'real-Team+Record+Mongo-transactions+file-cloud-port':'isolated-fixture'}))
 }catch(error){
  console.log(JSON.stringify({fixtureCalls:calls.slice(-25),page:await page?.locator('body').innerText()}));if(page&&process.env.ARKME_E2E_CAPTURE_DIR)await page.screenshot({path:join(process.env.ARKME_E2E_CAPTURE_DIR,'failure.png')});throw error
 }finally{
  await browser?.close();if(scaffold){await scaffold.ctx.get('arkmeData').logout();await scaffold.close()};globalThis.fetch=realFetch;await new Promise(resolve=>api.close(resolve));await rm(root,{recursive:true,force:true})
 }
})
