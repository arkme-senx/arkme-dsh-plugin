// Opt-in: immutable package + unmodified official DSH + isolated real Team/Record.
import assert from 'node:assert/strict';
import {randomUUID, createHmac} from 'node:crypto';
import {createServer} from 'node:https';
import {once} from 'node:events';
import {execFileSync, spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {readFileSync, openSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const cli=process.env.ARKME_OFFICIAL_DSH_CLI, artifact=process.env.ARKME_PACKED_ARTIFACT;
assert.ok(cli && artifact && process.env.PLAYWRIGHT_MODULE_ANCHOR, 'official CLI, immutable tgz and browser toolchain required');
assert.match(artifact,/\.tgz$/);
const owners=Object.fromEntries(['team','record'].map(owner=>[owner,process.env[`TEAM_INTERACTION_STACK_${owner.toUpperCase()}`]]));
for(const address of Object.values(owners)){const url=new URL(address);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');assert.ok(url.port);}
const root=process.env.ARKME_E2E_RUN_ROOT || await mkdtemp(join(tmpdir(),'team recall official ')), home=join(root,'home'), profile=join(home,'profiles','web');
const capture=process.env.ARKME_E2E_CAPTURE_DIR || join(root,'capture');await mkdir(capture,{recursive:true});
await writeFile(join(capture,'context.json'),JSON.stringify({root,home,profile}));
const cert=join(root,'cert.pem'),key=join(root,'key.pem');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',key,'-out',cert],{stdio:'ignore'});
const token=id=>{const body=[{alg:'HS256',typ:'JWT'},{user_id:id,client_id:1,iss:'jotmo',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return body+'.'+createHmac('sha256','team-interaction-isolated-stack').update(body).digest('base64url')};
const post=async(path,body,actor=4)=>{const result=await fetch(owners.team+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(actor)},body:JSON.stringify(body)}).then(r=>r.json());assert.ok([0,200].includes(result.code),JSON.stringify(result));return result.data};
const uid=(await post('/api/v1/team/conversations/open',{public_ref:'a'.repeat(32)},2)).conversation.conversation_uid;
const texts=Object.fromEntries(['ui','sdk','tool'].map(key=>[key,'T09 '+key+' '+randomUUID()]));
const messages={};
for(const [key,text] of Object.entries(texts)){
 const page=await post('/api/v1/team/conversations/timeline/page',{conversation_uid:uid,side:'team'});
 messages[key]=await post('/api/v1/team/conversations/messages/send',{conversation_uid:uid,side:'team',client_message_uid:randomUUID(),expected_reply_seq:page.conversation.latest_team_reply_seq,content:{text_content:text,template_kind:1}});
}
const media=await post('/api/v1/team/conversations/messages/send',{conversation_uid:uid,side:'external',client_message_uid:randomUUID(),expected_reply_seq:0,content:{text_content:'T09 attachment source',template_kind:2,content_payload:{payload_kind:2,schema_version:1,text_state:1,media_refs:[{file_asset_uid:'22222222-2222-4222-8222-222222222222',render_role:1,sort_order:0,file_name:'source.png'}]}}},2);
const calls=[], sockets=new Set(),streams=new Set();
const emitTeamChange=(kind,locators={})=>{assert.ok(streams.size,'live upstream SSE required');for(const stream of streams)stream.write(`data: ${JSON.stringify({t:28,event_uid:randomUUID(),event_at:Date.now(),revision:2,kind,...locators})}\n\n`)};
const server=createServer({key:await readFile(key),cert:await readFile(cert)},async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString()||'{}'),path=new URL(req.url,'https://localhost').pathname;
  calls.push({path,body});
  if(path.endsWith('/sse/chat/noty')){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': isolated fixture\n\n');streams.add(res);res.on('close',()=>streams.delete(res));return;}
  const owner=path.startsWith('/api/v1/team/')?'team':path.startsWith('/api/v1/reactions/')?'record':undefined;
  if(owner){const r=await fetch(owners[owner]+path,{method:req.method,headers:{'Content-Type':'application/json',Authorization:req.headers.authorization || 'Bearer '+token(4)},body:JSON.stringify(body)});res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/json'});res.end(Buffer.from(await r.arrayBuffer()));return;}
  let data={items:[],users:[],has_more:false,total:0};
  if(path.endsWith('/the-best-api-for-testing'))data={access_token:token(4),refresh_token:'isolated-recall'};
  if(path.endsWith('/get-user-info'))data={user_id:4,nick_name:'撤回验收',phone:'13800000000',phone_binding_policy:{mode:'none'}};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:200,data}));
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
});
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
let child,browser,page;
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`https://127.0.0.1:${server.address().port}`;
 const env={...process.env,DSH_HOME:home,NODE_EXTRA_CA_CERTS:cert,COREPACK_ENABLE_AUTO_PIN:'0'};
 execFileSync(process.execPath,[cli,'plugin','--profile','web','add','-w',resolve(artifact)],{cwd:root,env,stdio:['ignore',openSync(join(root,'install.log'),'w'),openSync(join(root,'install.err.log'),'w')],timeout:600000});
 const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'));manifest.dsh.profile.bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@senguoyun/dsh-arkme'];await writeFile(join(profile,'package.json'),JSON.stringify(manifest));
 const llmModule=pathToFileURL(createRequire(resolve(cli)).resolve('@deepseek-ai/dsh-llm')).href;
 const probe=join(root,'recall-probe.mjs');
 await writeFile(probe,`import {randomUUID} from 'node:crypto';import {createUserMessage,createToolResultMessage} from ${JSON.stringify(llmModule)};export const name='recall-probe';export const inject=['arkmeData','agents','tools'];export function apply(ctx){void(async()=>{await ctx.get('loader').await();await ctx.arkmeData.testLogin(4);const h=await ctx.agents.create({sessionId:'recall-'+randomUUID(),meta:{cwd:${JSON.stringify(root)}},agentOptions:{provider:'deepseek-official',model:'deepseek-v4-flash'}});try{const a=h.agent,s=a.session;const conversations=await ctx.arkmeData.listTeamConversations('team');let c,m;for(const row of conversations.items){const p=await ctx.arkmeData.readTeamMessages(row.ref);const found=p.messages.find(m=>m.content?.text_content===${JSON.stringify(texts.tool)});if(found){c=row;m=found;break;}}if(!m||!ctx.tools.get('arkme_team_message_recall',a))throw new Error('recall Tool not visible');const args={conversation_ref:c.ref,message_ref:m.ref};let step=0;const invoke=async()=>{const callId=randomUUID(),event=s.append('tool/call',{turn:1,step:++step,callId,name:'arkme_team_message_recall',arguments:JSON.stringify(args)});const r=await ctx.tools.execute({callId,name:'arkme_team_message_recall',arguments:args,agent:a,signal:AbortSignal.timeout(15000)});s.append('tool/result',{turn:1,step,message:createToolResultMessage({callId,content:r.content,isError:r.isError})},{surfaceOp:'append',sourceEventSeqs:[event.seq]});return r;};if(!JSON.stringify(await invoke()).includes('confirmation_required'))throw new Error('Tool bypassed human confirmation');s.append('user/message',createUserMessage({content:[{type:'text',text:'确认撤回刚才指定的隔离测试消息'}],source:{kind:'user'}}),{surfaceOp:'append'});const result=await invoke();if(result.isError||!JSON.stringify(result).includes('recalled'))throw new Error('Tool recall failed '+JSON.stringify(result));console.log('T09_REAL_TOOL_PASSED');}finally{await h.dispose();}console.log('T09_LOGIN_READY');})().catch(e=>console.error(e));}`);
 const net=await import('node:net');const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
 const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:'t09-'+randomUUID(),allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin};
 for(const name of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[name+'BaseUrl']=origin;
 await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'webserver',config:{host:'127.0.0.1',port}},{id:'arkme-self',config},{insert:[{id:'recall-probe',name:probe}]}]));
 const log=join(root,'host.log');child=spawn(process.execPath,[cli,'--profile','web','--no-open'],{cwd:root,env,stdio:['ignore',openSync(log,'w'),openSync(log,'a')]});
 let url;for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,500));const value=readFileSync(log,'utf8'),match=value.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);if(match&&value.includes('T09_LOGIN_READY')){url=match[0];break;}if(child.exitCode!==null)throw new Error('official host exited');}assert.ok(url,'isolated official startup timed out');
 const {chromium}=createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ANCHOR))('playwright');browser=await chromium.launch({channel:'chrome'});page=await browser.newPage({viewport:{width:1280,height:860}});
 let teamRef='pending';await page.route('**/arkme-self/api',async route=>{const {operation,params={}}=route.request().postDataJSON();let value;
  if(operation==='directory.list'||operation==='team.app.directory')value={section:params.section??'teams',items:params.section&&params.section!=='teams'?[]:[{kind:'team',teamRef,displayName:'接待团队',publicId:'fixture_team',role:'member'}],total:1,hasMore:false};
  else if(operation==='team.app.members')value={team:{teamRef,name:'接待团队',jotmoId:'fixture_team',currentUserRole:'member',createdAtMillis:1,updatedAtMillis:1},items:[],totalCount:0,hasMore:false};
  else return route.continue();await route.fulfill({json:{ok:true,value}});
 });
 await page.goto(url);await page.waitForTimeout(1200);
 const installed=createRequire(join(profile,'package.json'));const {createArkmeSdk}=await import(pathToFileURL(installed.resolve('@senguoyun/dsh-arkme/sdk')).href);
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const r=await page.evaluate(async init=>{const r=await fetch('/arkme-self/api',init);return {status:r.status,text:await r.text()};},init);return new Response(r.text,{status:r.status});}});
 const conversations=await sdk.listTeamConversations('team'),source=conversations.items.find(c=>c.channel.name==='接待团队7');assert.ok(source);teamRef=source.channel.teamRef;
 const selected=(await sdk.readTeamMessages(source.ref)).messages.find(m=>m.content?.text_content===texts.sdk);assert.ok(selected?.canRecall);
 const result=await sdk.recallTeamMessage(source.ref,selected.ref);assert.equal(result.message.state,'recalled');assert.equal(result.message.content,undefined);
 assert.equal((await sdk.recallTeamMessage(source.ref,selected.ref)).changed,false);
 execFileSync(process.execPath,[resolve('scripts/verify-team-message-consumer.mjs'),profile],{stdio:'inherit'});
 await page.getByRole('button',{name:'联系人',exact:true}).click();const directory=page.locator('[data-directory-section="teams"]'),toggle=directory.locator('.arkme-contact-directory-section-header');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await directory.getByRole('button',{name:/接待团队/}).click();await page.getByRole('button',{name:/团队消息通道/}).click();await page.getByRole('button',{name:/查看团队对话/}).click();await page.locator('[data-team-side="team"]').filter({hasText:/用户\s*2/}).click();
 const pane=page.locator('.team-conversation-pane'),bubble=pane.locator('[data-team-message-key]').filter({hasText:texts.ui}).first();await bubble.waitFor();
 await pane.getByRole('textbox',{name:'团队消息内容',exact:true}).fill('撤回后保留的下一条草稿');
 await bubble.getByLabel('消息操作',{exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'撤回',exact:true}).click();
 await page.screenshot({path:join(capture,'recall-confirm.png')});await page.getByRole('button',{name:'确认撤回',exact:true}).click();
 await pane.getByText(texts.ui,{exact:true}).waitFor({state:'hidden'});await pane.getByText('你撤回了一条消息',{exact:true}).first().waitFor();
 assert.ok((await pane.getByRole('textbox',{name:'团队消息内容',exact:true}).innerText()).includes('撤回后保留的下一条草稿'));
 for(const text of Object.values(texts))await page.locator('.team-conversation-row').filter({hasText:text}).waitFor({state:'hidden'});
 await page.screenshot({path:join(capture,'recall-placeholder.png')});
 // Existing independent preview, actual Team/Record bytes, upstream SSE and Host preflight.
 const mediaBubble=pane.locator('[data-team-message-key]').filter({hasText:'T09 attachment source'}).first();await mediaBubble.waitFor();
 await mediaBubble.getByRole('button',{name:/^预览图片 /}).click();
 const inlineImage=page.locator('[data-arkme-image-preview-viewport] img').first();await inlineImage.waitFor();
 await inlineImage.evaluate(image=>image.decode());
 await inlineImage.evaluate(image=>window.__t09InlineImage=image);
 emitTeamChange('team.notification-policy.changed');emitTeamChange('team.message.changed',{conversation_uid:uid,message_uid:messages.ui.message_uid});
 await page.waitForTimeout(800);assert.equal(await inlineImage.evaluate(image=>image===window.__t09InlineImage),true);
 await page.screenshot({path:join(capture,'attachment-original-inline.png')});
 await page.getByRole('button',{name:'关闭预览',exact:true}).click();
 // The official Web host has no desktop shell. Supply only its existing public
 // bridge contract to exercise the real popup owner; authority stays in Team.
 // Navigation-only fixtures are no longer needed. Playwright routing stalls
 // about:blank popup resources even for unmatched URLs; keep native reads real.
 await page.unroute('**/arkme-self/api');
 await page.evaluate(()=>{window.arkmeAttachmentPreview={version:1,focus(){},close(){}}});
 const [preview]=await Promise.all([page.waitForEvent('popup'),mediaBubble.getByRole('button',{name:/^预览图片 /}).click()]);
 await preview.bringToFront();await preview.locator('img').first().waitFor();
 await preview.locator('img').first().evaluate(image=>Promise.race([image.decode(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('popup image decode timeout')),30000))]));
 await preview.locator('img').first().evaluate(image=>window.__t09OriginalPreviewImage=image);
 const before=calls.filter(call=>call.path.endsWith('/batch-get')).length;
 emitTeamChange('team.notification-policy.changed');emitTeamChange('team.receipt.changed');emitTeamChange('team.message.changed',{conversation_uid:uid,message_uid:messages.ui.message_uid});
 await page.waitForTimeout(800);assert.equal(preview.isClosed(),false);
 assert.equal(await preview.locator('img').first().evaluate(image=>image===window.__t09OriginalPreviewImage),true);
 assert.equal(calls.filter(call=>call.path.endsWith('/batch-get')).length,before,'unrelated events must not revalidate this source');
 await preview.screenshot({path:join(capture,'attachment-original-preview.png')});
 await post('/api/v1/team/conversations/messages/recall',{conversation_uid:uid,message_uid:media.message_uid,side:'external'},2);
 const closed=preview.waitForEvent('close');emitTeamChange('team.message.changed',{conversation_uid:uid,message_uid:media.message_uid});await closed;
 assert.ok(calls.slice().some(call=>call.path.endsWith('/batch-get')&&call.body.items?.some(item=>item.message_uid===media.message_uid)));
 const final=await post('/api/v1/team/conversations/timeline/page',{conversation_uid:uid,side:'team'});for(const message of [...Object.values(messages),media])assert.equal(final.messages.find(m=>m.message_uid===message.message_uid).state,'recalled');
 assert.ok(readFileSync(log,'utf8').includes('T09_REAL_TOOL_PASSED'));
 await writeFile(join(capture,'acceptance.json'),JSON.stringify({passed:true,realTeamAndRecord:true,officialDsh:true,installedArtifact:artifact,ui:true,uiDraftPreserved:true,publicSdk:true,externalTypedConsumer:true,officialSessionTool:true,confirmationRequired:true,originalWebInlinePreview:true,desktopBridge:'contract-fixture',originalAttachmentPreview:true,unrelatedEventsPreserveImage:true,matchingRecallRevalidatesAndCloses:true},null,2));
 console.log('PASS: T09 packaged UI, public SDK and real official-session Tool recall through real Team owner');
}catch(error){if(page){await page.screenshot({path:join(capture,'failure.png')}).catch(()=>{});await writeFile(join(capture,'failure-body.txt'),await page.locator('body').innerText()).catch(()=>{});}for(const [i,p] of (browser?.contexts().flatMap(c=>c.pages())??[]).entries()){await writeFile(join(capture,`failure-surface-${i}.json`),JSON.stringify(await p.evaluate(()=>({href:location.href,base:document.baseURI,body:document.body.innerText,images:[...document.images].map(image=>({src:image.src,currentSrc:image.currentSrc,width:image.naturalWidth,complete:image.complete}))})),null,2)).catch(()=>{});await p.screenshot({path:join(capture,`failure-surface-${i}.png`)}).catch(()=>{});}console.error(error);process.exitCode=1;}finally{await writeFile(join(capture,'calls.json'),JSON.stringify(calls,null,2));await browser?.close();child?.kill('SIGTERM');for(const socket of sockets)socket.destroy();server.close();}
