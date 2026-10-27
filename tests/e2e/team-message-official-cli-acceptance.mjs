// Run with a published official DSH CLI and a freshly packed immutable artifact.
// All identities, upstream HTTP and Profiles are isolated; no real account is used.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {createServer} from 'node:https';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const node=process.execPath;
const reactionsOnly=process.env.ARKME_E2E_REACTIONS_ONLY==='1';
const extensionSendOnly=process.env.ARKME_E2E_EXTENSION_SEND_ONLY==='1';
let reactionRevision=0,reactionMine=false;
const reactionExpression={text:'收到',color:'blue'},reactionKey=createHash('sha256').update(JSON.stringify(reactionExpression)).digest('hex');
const cli=process.env.ARKME_OFFICIAL_DSH_CLI;
if(!cli||!process.env.ARKME_PACKED_ARTIFACT||!process.env.PLAYWRIGHT_MODULE_ANCHOR)throw new Error('official DSH CLI, immutable tgz and Playwright module anchor required');
assert.match(process.env.ARKME_PACKED_ARTIFACT,/\.tgz$/);
const root=await mkdtemp(join(tmpdir(),'team-business-pc-scenes-')),home=join(root,'home'),profile=join(home,'profiles','web');
const capture=process.env.ARKME_E2E_CAPTURE_DIR||join(root,'capture');await mkdir(capture,{recursive:true});
await writeFile(join(capture,'context.json'),JSON.stringify({root,home,profile,capture}));
const cert=join(root,'cert.pem'),key=join(root,'key.pem');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',key,'-out',cert],{stdio:'ignore'});
process.env.NODE_EXTRA_CA_CERTS=cert;process.env.ARKME_E2E_TLS_KEY=key;
const calls=[];let stale=false;
const owners=Object.fromEntries(['team','record','chat'].map(key=>[key,process.env[`TEAM_INTERACTION_STACK_${key.toUpperCase()}`]]));
const live=Object.values(owners).every(Boolean);
if(Object.values(owners).some(Boolean)&&!live)throw new Error('all three isolated service URLs required');
for(const address of Object.values(owners).filter(Boolean)){const url=new URL(address);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');assert.ok(url.port);assert.equal(url.pathname,'/');assert.equal(url.username,'');}
const actor=live?4:10001;
const token=id=>{const body=[{alg:'HS256',typ:'JWT'},{user_id:id,client_id:1,iss:'jotmo',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return body+'.'+createHmac('sha256','team-interaction-isolated-stack').update(body).digest('base64url')};
const ownerPost=async(service,path,body,id=4)=>{const r=await fetch(owners[service]+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(id)},body:JSON.stringify(body)});const value=await r.json();assert.ok(r.ok&&[0,200].includes(value.code),JSON.stringify({path,value}));return value.data};
let sourceUID,targetUID,sourceMessageUID;
const poll=async(read,predicate)=>{for(let i=0;i<100;i++){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,100))}throw new Error('owner result did not converge')};
 const text='这批订单请周五下午三点前送达，到了以后联系我。'+(live?' '+randomUUID():''),digest=createHash('sha256').update(JSON.stringify({text_content:text,text_format:'plain',content_payload:{}})).digest('hex')
 const channel={team_id:42,name:'接待团队',jotmo_id:'fixture_team',public_ref:'b'.repeat(32),enabled:true,revision:1,can_manage:true,can_pause:true}
 const conversation=uid=>({conversation_uid:uid,side:'team',channel,visitor:{nickname:uid==='source'?'验收来访者':'转发目标'},last_seq:1,revision:1,updated_at:1700000000000})
 const message={message_uid:'source-message',seq:1,side:'external',own:false,state:'published',created_at:1700000000000,sender:{nickname:'验收来访者'},record:{status:'available',version:3,text_content:text,template_kind:1,text_projection:{protocol:'arkme-text-v1',digest,canonical:text},media:[]}}
 const fixtureJwt=[{alg:'none'},{user_id:10001,client_id:20001,exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture'
 const jwt=live?token(actor):fixtureJwt;
 if(live){
  sourceUID=(await ownerPost('team','/api/v1/team/conversations/open',{public_ref:'a'.repeat(32)},2)).conversation.conversation_uid;
  targetUID=(await ownerPost('team','/api/v1/team/conversations/open',{public_ref:'b'.repeat(32)},2)).conversation.conversation_uid;
  // Empty unopened receptions are intentionally absent from the target directory.
  await ownerPost('team','/api/v1/team/conversations/messages/send',{conversation_uid:targetUID,side:'external',client_message_uid:randomUUID(),expected_reply_seq:0,content:{text_content:'已有接待消息',template_kind:1}},2);
  sourceMessageUID=(await ownerPost('team','/api/v1/team/conversations/messages/send',{conversation_uid:sourceUID,side:'external',client_message_uid:randomUUID(),expected_reply_seq:0,content:{text_content:text,template_kind:1}},2)).message_uid;
 }
 const server=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk)
   const body=JSON.parse(Buffer.concat(chunks).toString()||'{}'),path=new URL(req.url,'https://localhost').pathname
   const call={path,body};calls.push(call)
   if(path.endsWith('/sse/chat/noty')){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': fixture\n\n');return}
   const owner=path.startsWith('/api/v1/team/')?'team':path.startsWith('/api/v1/chats/')?'chat':path.startsWith('/api/v1/reactions/')?'record':undefined;
   if(live&&owner){const upstream=await fetch(owners[owner]+path,{method:req.method,headers:{'Content-Type':'application/json',Authorization:req.headers.authorization||'Bearer '+jwt},body:JSON.stringify(body)});const value=await upstream.text();call.response=JSON.parse(value);res.writeHead(upstream.status,{'content-type':'application/json'});res.end(value);return;}
   let data={items:[],users:[],has_more:false,total:0},code=200
   if(path.endsWith('/the-best-api-for-testing'))data={access_token:jwt,refresh_token:'isolated-team-interaction'}
   else if(reactionsOnly&&path.endsWith('/reactions/library/query'))data={revision:1,items:[reactionExpression]};
   else if(reactionsOnly&&path.endsWith('/reactions/team/query'))data={items:body.targets.map(target=>({target,mine:{revision:reactionRevision,selections:reactionMine?[{key:reactionKey,expression:reactionExpression,at:1}]:[]},groups:[{key:reactionKey,expression:reactionExpression,count:reactionMine?2:1,actor_user_ids:reactionMine?[actor,10002]:[10002]}],has_more:false,actors_visible:true,private:false}))};
   else if(reactionsOnly&&path.endsWith('/reactions/team/set')){reactionMine=body.active;reactionRevision++;data={outcome:'updated',state:{revision:reactionRevision,selections:reactionMine?[{key:reactionKey,expression:reactionExpression,at:1}]:[]}};}
   else if(reactionsOnly&&path.endsWith('/get-public-users-by-ids'))data={items:body.user_ids.map(user_id=>({user_id,nick_name:user_id===actor?'团队交互验收':'同事乙'}))};
   else if(reactionsOnly&&path.endsWith('/chats/contacts/list'))data={items:[{user_id:10002,remark:'私人备注乙'}],has_more:false};
   else if(path.endsWith('/get-user-info'))data={user_id:actor,nick_name:'团队交互验收',phone:'13800000000',phone_binding_policy:{mode:'none'}}
   else if(path.endsWith('/conversations/list'))data={items:body.side==='team'?[conversation('source'),conversation('target')]:[],has_more:false}
   else if(path.endsWith('/conversations/timeline/page'))data={conversation:conversation(body.conversation_uid),messages:body.conversation_uid==='source'?[message]:[],has_more:false}
   else if(path.endsWith('/conversations/messages/extensions'))data={message,items:[{...message,message_uid:'extension-child',seq:2,sender:{nickname:'团队成员'},record:{...message.record,text_content:'延展验收子回复'}}],total_count:1,has_more:false,next_seq:2,through_seq:2}
   else if(path.endsWith('/conversations/read-state/query-list'))data={items:body.conversation_uids.map(conversation_uid=>({conversation_uid,accessible:true,last_seq:1,my_read_seq:1,unread:0}))}
   else if(path.endsWith('/conversations/read-receipts/summary-list'))data={last_seq:1,my_read_seq:1,unread:0,items:body.message_uids.map(message_uid=>({message_uid,team_read:true,summary:{recipient_count:2,read_count:1,unread_count:1},visitor_read:false}))}
   else if(path.endsWith('/conversations/messages/batch-get')){if(stale){code=400;data={reason:'record_version_conflict'}}else data={messages:[message]}}
   else if(path.endsWith('/conversations/messages/forward'))data={message_uid:'accepted-forward',state:'published',side:body.side,seq:9}
   else if(path.endsWith('/conversations/messages/reports/create'))data={report_uid:'frozen-evidence'}
   else if(path.endsWith('/conversations/messages/send'))data={message_uid:'reply-accepted',state:'published',side:body.side,seq:10}
   else if(path.endsWith('/chats/messages/copy-link/get-or-create'))data={sid:'frozen-team-sid',url:'https://example.invalid/s/frozen-team-sid'}
   else if(path.endsWith('/conversations/messages/annotations/batch-query'))data={items:body.message_uids.map(uid=>({message_uid:uid,audience:body.audience,complete:true,revision:0,items:[]}))}
   else if(path.endsWith('/conversations/messages/annotations/change'))data={complete:true,revision:1,items:[]}
   else if(path.endsWith('/message-channel/get'))data=channel
   else if(path.endsWith('/join-requests/list'))data={items:[],has_more:false}
   else if(path.endsWith('/conversations/attention'))data={team:false,external:false,applications:false}
   if(reactionsOnly&&path.startsWith('/api/v1/reactions/'))code=0;
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code,...(code!==200?{message:'record_version_conflict'}:{}),data}))
  }catch(error){console.error('TEAM_FIXTURE_ERROR',String(error));res.writeHead(500);res.end(JSON.stringify({error:String(error)}))}
 })
let child,browser,page;
try {
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`https://127.0.0.1:${server.address().port}`;
 const env={...process.env,DSH_HOME:home,COREPACK_ENABLE_AUTO_PIN:'0',npm_config_auto_install_peers:'false',NODE_EXTRA_CA_CERTS:cert,PATH:node.slice(0,node.lastIndexOf('/'))+':'+process.env.PATH};
 const artifact=resolve(process.env.ARKME_PACKED_ARTIFACT);
 execFileSync(node,[cli,'plugin','--profile','web','add','-w',artifact],{cwd:root,env,stdio:['ignore',await import('node:fs').then(m=>m.openSync(join(root,'install.log'),'w')), await import('node:fs').then(m=>m.openSync(join(root,'install.err.log'),'w'))],timeout:180000});
 const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'));manifest.dsh.profile.bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@senguoyun/dsh-arkme'];await writeFile(join(profile,'package.json'),JSON.stringify(manifest,null,2));
 const probe=join(root,'login-probe.mjs');await writeFile(probe,`import {randomUUID} from 'node:crypto';export const name='visual-login-probe';export const inject=['arkmeData','agents','tools'];export function apply(ctx){void (async()=>{await ctx.get('loader').await();await ctx.arkmeData.testLogin(${actor});const handle=await ctx.agents.create({sessionId:'team-acceptance-'+randomUUID(),meta:{cwd:${JSON.stringify(root)}},agentOptions:{provider:'deepseek-official',model:'deepseek-v4-flash'}});try{for(const name of ['arkme_team_messages','arkme_team_message_forward','arkme_team_message_copy_link','arkme_team_message_report','arkme_team_mark_change','arkme_team_message_send']){if(!ctx.tools.get(name,handle.agent))throw new Error('Team tool unavailable: '+name)}const result=await ctx.tools.execute({callId:randomUUID(),name:'arkme_team_messages',arguments:{side:'team'},agent:handle.agent,signal:AbortSignal.timeout(15000)});if(result.isError||!JSON.stringify(result).includes('接待团队'))throw new Error('Team tool did not read the real owner');const directory=await ctx.arkmeData.listTeamConversations('team');const timeline=await ctx.arkmeData.readTeamMessages(directory.items[0].ref);const extensionFocus=timeline.messages.find(row=>row.state==='published'&&row.contentStatus==='available');if(!extensionFocus)throw new Error('No readable fixture source');const extensions=await ctx.tools.execute({callId:randomUUID(),name:'arkme_team_messages',arguments:{conversation_ref:directory.items[0].ref,message_ref:extensionFocus.ref,extensions:true,limit:2},agent:handle.agent,signal:AbortSignal.timeout(15000)});if(extensions.isError||!JSON.stringify(extensions).includes('totalCount'))throw new Error('Team extension tool failed');console.log('TEAM_EXTENSION_TOOL_READY');console.log('TEAM_OFFICIAL_TOOLS_READY');if(${reactionsOnly}){const rows=await ctx.arkmeData.listTeamConversations('team');const timeline=await ctx.arkmeData.readTeamMessages(rows.items[0].ref);const result=await ctx.tools.execute({callId:randomUUID(),name:'arkme_reactions_read',arguments:{request_json:JSON.stringify({action:'query',actorPresentation:'deferred',accountKey:'test:${actor}',targets:[{id:'probe',teamConversationRef:rows.items[0].ref,teamMessageRef:timeline.messages[0].ref}]})},agent:handle.agent,signal:AbortSignal.timeout(15000)});await (await import('node:fs/promises')).writeFile(${JSON.stringify(join(capture,'tool-result.json'))},JSON.stringify(result,null,2));if(result.isError||!JSON.stringify(result).includes('收到'))throw new Error('Reaction tool did not return Team facts');console.log('TEAM_REACTION_TOOL_READY')}}finally{await handle.dispose()}console.log('TEAM_VISUAL_AUTH_READY')})().catch(e=>console.error(e));}`);
 const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:'com.senqisi.scene-'+randomUUID(),allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin};for(const name of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[name+'BaseUrl']=origin;
 const net=await import('node:net');const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
 await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'webserver',config:{port,host:'127.0.0.1'}},{id:'arkme-self',config},{insert:[{id:'visual-login-probe',name:probe}]}]));
 const fs=await import('node:fs');const log=join(root,'host.log');child=spawn(node,[cli,'--profile','web','--no-open'],{cwd:root,env,stdio:['ignore',fs.openSync(log,'w'),fs.openSync(log,'a')]});
 let url;for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,500));const value=readFileSync(log,'utf8');const match=value.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);if(match&&value.includes('TEAM_VISUAL_AUTH_READY')){url=match[0];break;}if(child.exitCode!==null)throw new Error('official host exited '+child.exitCode)}if(!url)throw new Error('official host startup timeout; inspect isolated host log');
 const {chromium}=createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ANCHOR))('playwright');browser=await chromium.launch({channel:'chrome'});page=await browser.newPage({viewport:{width:1280,height:860}});page.on('pageerror',e=>console.log('PAGE_ERROR',e.message));
 let fixtureTeamRef='team-fixture';await page.route('**/arkme-self/api',async route=>{const {operation,params={}}=route.request().postDataJSON();let value;
 if(operation==='directory.list'||operation==='team.app.directory')value={section:params.section??'teams',items:params.section&&params.section!=='teams'?[]:[{kind:'team',teamRef:fixtureTeamRef,displayName:'接待团队',publicId:'fixture_team',role:'owner'}],total:1,hasMore:false};
 else if(operation==='team.app.members')value={team:{teamRef:fixtureTeamRef,name:'接待团队',jotmoId:'fixture_team',currentUserRole:'owner',createdAtMillis:1,updatedAtMillis:1},items:[],totalCount:0,hasMore:false};
 else if(!live&&!reactionsOnly&&operation==='reactions')value=params.action==='library-query'?{revision:0,items:[]}:params.action==='query'?{items:params.targets.map(t=>({target_id:t.id,mine:{revision:0,selections:[]},groups:[],has_more:false,actors_visible:true,private:false}))}:{items:[],has_more:false};else {await route.continue();return;}await route.fulfill({json:{ok:true,value}})});
 await page.goto(url);await page.waitForTimeout(2000);const initial=await page.evaluate(async()=>await fetch('/arkme-self/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'team.messages.conversations',params:{side:'team'}})}).then(r=>r.json()));fixtureTeamRef=(live?initial.value.items.find(c=>c.channel.name==='接待团队7'):initial.value.items[0]).channel.teamRef;await page.screenshot({path:join(capture,'00-start.png')});
 // A separate installed SDK consumer reads the same Host owner as UI and Tools.
 const installed=createRequire(join(profile,'package.json'));
 const {createArkmeSdk}=await import(pathToFileURL(installed.resolve('@senguoyun/dsh-arkme/sdk')).href);
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const r=await page.evaluate(async init=>{const r=await fetch('/arkme-self/api',init);return {status:r.status,text:await r.text()}},init);return new Response(r.text,{status:r.status})}});
 const sdkRows=await sdk.listTeamConversations('team');const sdkSource=live?sdkRows.items.find(c=>c.channel.name==='接待团队7'):sdkRows.items[0];assert.ok(sdkSource);
 const sdkSelected=(await sdk.readTeamMessages(sdkSource.ref)).messages.find(m=>m.content?.text_content===text);assert.ok(sdkSelected);
 assert.equal((await sdk.preflightTeamMessages(sdkSource.ref,[{messageRef:sdkSelected.ref,version:sdkSelected.version}]))[0].content.text_content,text);
 const extensionPage=await sdk.readTeamExtensions(sdkSource.ref,sdkSelected.ref);assert.equal(extensionPage.message.key,sdkSelected.key);if(!live)assert.equal(extensionPage.totalCount,1);console.log('TEAM_EXTENSION_SDK_READY');
 await page.getByRole('button',{name:'联系人',exact:true}).click();const directory=page.locator('[data-directory-section="teams"]');const toggle=directory.locator('.arkme-contact-directory-section-header');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await directory.getByRole('button',{name:/接待团队/}).click();await page.getByRole('button',{name:/团队消息通道/}).click();await page.getByRole('button',{name:/查看团队对话/}).click();await page.locator('[data-team-side="team"]').filter({hasText:live?/用户\s*2/:'验收来访者'}).click();
 if(!live){const teamPane=page.locator('.team-conversation-pane');await teamPane.getByText(text,{exact:true}).first().click();const details=page.getByRole('dialog',{name:'消息详情',exact:true});await details.getByText('延展验收子回复',{exact:true}).waitFor();assert.equal(await teamPane.locator('[data-team-composer]').count(),1);await details.getByRole('textbox',{name:'团队消息内容',exact:true}).fill('详情中保留的草稿');await page.screenshot({path:join(capture,'00-extension-detail.png')});await details.getByRole('button',{name:'关闭详情',exact:true}).click();assert.ok((await teamPane.getByRole('textbox',{name:'团队消息内容',exact:true}).textContent()).includes('详情中保留的草稿'));await teamPane.getByRole('textbox',{name:'团队消息内容',exact:true}).fill('');console.log('TEAM_EXTENSION_UI_READY');}
 if(live&&!reactionsOnly){
  const teamPane=page.locator('.team-conversation-pane');await teamPane.getByText(text,{exact:true}).first().click();const details=page.getByRole('dialog',{name:'消息详情',exact:true});await details.locator('[data-arkme-note-extension-count]').waitFor();
  const replyText='PC详情直接延展 '+randomUUID();await details.getByRole('textbox',{name:'团队消息内容',exact:true}).fill(replyText);await details.getByRole('button',{name:'发送',exact:true}).click();
  await poll(()=>ownerPost('team','/api/v1/team/conversations/timeline/page',{conversation_uid:sourceUID,side:'team'}),value=>value.messages.some(m=>m.record?.text_content===replyText&&m.reply?.message_uid===sourceMessageUID));
  await details.getByText(replyText,{exact:true}).waitFor();await page.screenshot({path:join(capture,'00-extension-direct-send.png')});await details.getByRole('button',{name:'关闭详情',exact:true}).click();console.log('TEAM_EXTENSION_DEFAULT_SEND_READY');
 }
 const pane=page.locator('.team-conversation-pane');await pane.getByText(text,{exact:true}).first().waitFor();const menu=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await pane.locator('[data-team-message-key]').filter({hasText:text}).first().getByLabel('消息操作',{exact:true}).click({button:'right'})};
 if(extensionSendOnly){
  assert.equal(live,false,'latency scenario requires the isolated synthetic upstream');
  await menu();await page.getByRole('menuitem',{name:'延展',exact:true}).click();
  const target=pane.locator('[data-arkme-composer-extension-target]');
  const card=pane.locator('[data-arkme-primary-composer]');
  const editor=pane.getByRole('textbox',{name:'团队消息内容',exact:true});
  const geometry=[];
  for(const width of [1280,850]){
   await page.setViewportSize({width,height:860});
   await editor.fill('交付时间已确认');
   await editor.focus();
   const shape=await card.evaluate(node=>{
    const style=getComputedStyle(node),parent=node.previousElementSibling;
    return {radius:style.borderRadius,top:style.borderTopWidth,color:style.borderColor,
     joined:Math.abs(node.getBoundingClientRect().top-parent.getBoundingClientRect().bottom)<1,
     fits:node.getBoundingClientRect().right<=innerWidth};
   });
   assert.equal(shape.top,'0px');assert.equal(shape.radius,'0px 0px 15px 15px');
   assert.ok(shape.joined&&shape.fits);geometry.push({width,...shape});
   await page.screenshot({path:join(capture,`extension-compose-${width}.png`)});
  }
  let releaseAdmission,clientUid;
  const admissionGate=new Promise(resolve=>{releaseAdmission=resolve});
  await page.route('**/arkme-self/api',async route=>{
   const body=route.request().postDataJSON();
   if(body.operation!=='team.app.send.enqueue')return route.fallback();
   clientUid=body.params.clientUid;
   await admissionGate;
   await route.continue();
  });
  await pane.getByRole('button',{name:'发送',exact:true}).click();
  await poll(async()=>clientUid,Boolean);
  assert.equal(await target.count(),0,'reply must leave the next draft before Host acknowledgement');
  assert.equal((await editor.innerText()).trim(),'');
  const reply=pane.locator('[data-team-message-key]').filter({hasText:'交付时间已确认'}).last();
  await reply.locator('[data-arkme-extension-parent-preview]').getByText(text,{exact:true}).waitFor();
  assert.equal(await reply.getAttribute('data-team-message-key'),clientUid);
  await editor.fill('下一条普通消息');
  await page.screenshot({path:join(capture,'extension-before-ack.png')});
  releaseAdmission();
  await poll(()=>reply.getAttribute('data-team-message-key'),key=>key&&key!==clientUid);
  await reply.locator('[data-arkme-extension-parent-preview]').getByText(text,{exact:true}).waitFor();
  assert.equal(await target.count(),0);
  assert.equal((await editor.innerText()).trim(),'下一条普通消息');
  assert.ok(calls.some(call=>call.path.endsWith('/conversations/messages/send')&&call.body.reply_to==='source-message'));
  await page.screenshot({path:join(capture,'extension-after-minimal-ack.png')});
  await writeFile(join(capture,'extension-send-acceptance.json'),JSON.stringify({passed:true,
   installedArtifact:artifact,officialHost:true,upstream:'isolated synthetic HTTP',geometry,
   targetConsumedBeforeHostAck:true,parentVisibleWhileSending:true,parentVisibleAfterMinimalAck:true,
   nextDraftPreserved:true,timelineStillBehind:true},null,2));
  console.log('PASS: packaged Team composer parity, immediate reply consumption and stable minimal-ACK presentation');
 }else if(reactionsOnly){
  const target={id:'sdk-team',teamConversationRef:sdkSource.ref,teamMessageRef:sdkSelected.ref};
  const facts=await sdk.reactions({action:'query',actorPresentation:'deferred',accountKey:`test:${actor}`,targets:[target]});
  assert.equal(facts.items[0].groups[0].count,1);assert.equal(facts.items[0].groups[0].actors[0].presentationPending,true);
  const full=await sdk.reactions({action:'query',accountKey:`test:${actor}`,targets:[target]});assert.equal(full.items[0].groups[0].actors[0].displayName,'私人备注乙');
  const bubble=pane.locator('.arkme-timed-bubble').filter({hasText:text}).first();
  await bubble.getByRole('button',{name:'添加收到',exact:true}).waitFor();
  assert.equal(await bubble.locator('[data-arkme-message-reactions]').count(),1);
  const reactionRow=bubble.locator('xpath=ancestor::*[@data-team-message-key]');
  const receiptGeometry=[];
  for(const width of [1280,850]){
   await page.setViewportSize({width,height:860});
   const indicator=reactionRow.locator('[data-arkme-read-receipt-indicator="partial-read"]');await indicator.waitFor();
   await page.mouse.move(5,5);const before=await bubble.boundingBox();await bubble.hover();
   const trigger=reactionRow.locator('.arkme-reaction-hover-trigger');
   assert.equal(await trigger.evaluate(node=>getComputedStyle(node).opacity),'1');
   const entry=await trigger.boundingBox(),receipt=await indicator.boundingBox(),after=await bubble.boundingBox();
   assert.deepEqual(after,before,'hover must not move the message');
   assert.ok(entry&&receipt&&after);
   assert.ok(entry.y+entry.height<=receipt.y||entry.y>=receipt.y+receipt.height||entry.x+entry.width<=receipt.x||entry.x>=receipt.x+receipt.width,'reaction entry must not overlap the receipt');
   assert.ok(await indicator.evaluate(node=>{const r=node.getBoundingClientRect();return !!document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('[data-arkme-read-receipt]')}),'receipt center must still receive pointer clicks');
   await page.screenshot({path:join(capture,`reaction-receipt-hover-${width}.png`)});
   await page.mouse.click(receipt.x+receipt.width/2,receipt.y+receipt.height/2);
   await page.getByRole('dialog',{name:'查看阅读状态',exact:true}).waitFor();
   await page.keyboard.press('Escape');
   await trigger.click();await page.getByRole('group',{name:'全部表情',exact:true}).waitFor();await trigger.click();
   receiptGeometry.push({width,entry,receipt});
  }
  await page.setViewportSize({width:1280,height:860});
  const add=bubble.getByRole('button',{name:'继续表态',exact:true});
  for(const visible of [true,false,true]){await add.click();assert.equal(await page.locator('[aria-label="表态面板"]').count(),Number(visible));}
  await page.getByRole('button',{name:'收到',exact:true}).click();
  await bubble.getByRole('button',{name:'取消我的收到',exact:true}).waitFor();
  await bubble.getByRole('button',{name:'查看团队交互验收的资料',exact:true}).waitFor();
  await page.screenshot({path:join(capture,'reaction-added.png')});
  await bubble.getByRole('button',{name:'取消我的收到',exact:true}).click();
  await bubble.getByRole('button',{name:'添加收到',exact:true}).waitFor();
  await menu();await page.getByRole('menuitem',{name:'表态',exact:true}).click();
  await page.getByRole('group',{name:'全部表情',exact:true}).waitFor();
  await page.screenshot({path:join(capture,'reaction-picker.png')});
  await page.setViewportSize({width:850,height:700});await page.waitForTimeout(400);
  await page.screenshot({path:join(capture,'reaction-picker-narrow.png')});
  assert.ok(readFileSync(log,'utf8').includes('TEAM_REACTION_TOOL_READY'));
  await writeFile(join(capture,'reaction-acceptance.json'),JSON.stringify({passed:true,installedSdk:true,officialSessionToolRead:true,realHostTransport:true,upstream:'isolated synthetic HTTP',bubblePlacement:true,inlineToggle:true,addRemove:true,selfName:true,remark:true,receiptGeometry,artifact},null,2));
  console.log('PASS: packaged Team reactions UI, SDK and real DSH session Tool share the Host owner');
 }else{
 await menu();await page.screenshot({path:join(capture,'initial-menu.png')});await page.getByRole('menuitem',{name:'延展',exact:true}).click();await page.waitForTimeout(250);await page.screenshot({path:join(capture,'01-reply.png')});if(live){await pane.getByRole('textbox',{name:'团队消息内容',exact:true}).fill('PC正式包引用回复');await pane.getByRole('button',{name:'发送',exact:true}).click();await poll(()=>ownerPost('team','/api/v1/team/conversations/timeline/page',{conversation_uid:sourceUID,side:'team'}),page=>page.messages.some(m=>m.record?.text_content==='PC正式包引用回复'&&m.reply?.message_uid===sourceMessageUID));await pane.getByText('PC正式包引用回复',{exact:true}).last().waitFor();await pane.locator('[data-team-message-key]').filter({hasText:'PC正式包引用回复'}).last().locator('[data-arkme-quote-preview], [data-arkme-extension-parent-preview]').getByText(text,{exact:true}).waitFor({timeout:15000});await page.screenshot({path:join(capture,'01-reply-sent.png')});}else await pane.getByRole('button',{name:'取消延展',exact:true}).click();
 const body=pane.locator('[data-team-message-key]').filter({hasText:text}).first().locator('[data-arkme-text-selection]').first();const selectText=async()=>await body.evaluate(node=>{node.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));const text=document.createTreeWalker(node,NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.setStart(text,5);range.setEnd(text,14);window.getSelection().removeAllRanges();window.getSelection().addRange(range);node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}))});
 await selectText();await page.getByRole('toolbar',{name:'选中文字操作'}).getByRole('button',{name:'回复',exact:true}).click();
 if(live){
  await pane.getByRole('textbox',{name:'团队消息内容',exact:true}).fill('PC正式包选区回复');await pane.getByRole('button',{name:'发送',exact:true}).click();
  await poll(()=>ownerPost('team','/api/v1/team/conversations/timeline/page',{conversation_uid:sourceUID,side:'team'}),page=>page.messages.some(m=>m.record?.text_content==='PC正式包选区回复'&&m.reply?.message_uid===sourceMessageUID&&m.reply?.quote?.text===text.slice(5,14)));
  await pane.locator('[data-team-message-key]').filter({hasText:'PC正式包选区回复'}).last().locator('[data-arkme-quote-preview]').getByText(text.slice(5,14),{exact:true}).waitFor({timeout:15000});
  await page.screenshot({path:join(capture,'01-selected-reply-sent.png')});
 }else await pane.getByRole('button',{name:'取消引用',exact:true}).click();
 await selectText();await page.getByRole('toolbar',{name:'选中文字操作'}).getByRole('button',{name:'团队内部',exact:true}).click();if(live){await page.getByRole('toolbar',{name:'选中文字操作'}).getByRole('button',{name:'标记',exact:true}).click();await poll(()=>ownerPost('team','/api/v1/team/conversations/messages/annotations/query',{conversation_uid:sourceUID,message_uid:sourceMessageUID,side:'team',audience:'team'}),v=>v.items.length>0);}await page.screenshot({path:join(capture,'02-mark.png')});await page.keyboard.press('Escape');await page.evaluate(()=>window.getSelection().removeAllRanges());
 await menu();await page.getByRole('menuitem',{name:'表态',exact:true}).click();await page.waitForTimeout(500);if(live){await page.getByRole('group',{name:'全部表情',exact:true}).getByRole('button').first().click();await poll(async()=>calls.filter(c=>c.path.endsWith('/reactions/team/set')&&[0,200].includes(c.response?.code)),rows=>rows.length>0);await pane.locator('[data-team-message-key]').filter({hasText:text}).first().getByRole('button',{name:/取消我的/}).waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}await page.screenshot({path:join(capture,'03-reaction.png')});await page.keyboard.press('Escape');
 await menu();await page.getByRole('menuitem',{name:'转发',exact:true}).click();const picker=page.getByRole('dialog',{name:'转发给',exact:true});await picker.getByRole('button',{name:live?/接待团队8/:/转发目标/}).click();await picker.getByRole('textbox',{name:'转发附言',exact:true}).fill('请帮客户确认配送时间。');await page.screenshot({path:join(capture,'04-forward.png')});if(live){const refreshed=page.waitForResponse(r=>{try{return r.url().endsWith('/arkme-self/api')&&r.request().postDataJSON().operation==='team.app.timeline'}catch{return false}});await picker.getByRole('button',{name:'发送转发',exact:true}).click();await picker.waitFor({state:'hidden'});await refreshed;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await poll(()=>ownerPost('team','/api/v1/team/conversations/timeline/page',{conversation_uid:targetUID,side:'team'}),p=>p.messages.some(m=>m.record?.content_payload?.forward_records?.summary_lines?.some(line=>line.includes(text))));}else await page.keyboard.press('Escape');
 await menu();await page.getByRole('menuitem',{name:'举报',exact:true}).click();const report=page.getByRole('dialog',{name:'举报和反馈',exact:true});await report.getByRole('radio',{name:'垃圾广告',exact:true}).click();await page.screenshot({path:join(capture,'05-report.png')});if(live){await report.getByRole('button',{name:'提交举报',exact:true}).click();await report.waitFor({state:'hidden'});await poll(()=>ownerPost('team','/api/v1/team/conversations/messages/reports/list',{status:'pending',limit:20},88),p=>p.items.some(r=>r.message_uid===sourceMessageUID));}else await report.getByRole('button',{name:'关闭举报',exact:true}).click();
 // Observe the public bridge without substituting its implementation or acknowledgement.
 await page.evaluate(()=>{for(const iframe of document.querySelectorAll('iframe')){try{const bridge=iframe.contentWindow.__arkmeHarnessAttachmentDraft;if(bridge){const original=bridge.prepare.bind(bridge);bridge.prepare=async(request)=>{window.__sceneAskCalls=(window.__sceneAskCalls||0)+1;try{const result=await original(request);window.__sceneAskResult={...result,files:await Promise.all(request.files.map(async f=>({name:f.name,text:f.type.startsWith('text/')?await f.text():undefined})))};return result}catch(e){window.__sceneAskError={message:e?.message};throw e}}}}catch{}}});
 // A stale exact-version read must fail before creating or opening any native draft.
 if(!live){stale=true;await menu();await page.getByRole('menuitem',{name:'问 DSH',exact:true}).click();
 await page.getByText('record_version_conflict',{exact:false}).first().waitFor();
 assert.equal(await page.evaluate(()=>window.__sceneAskCalls||0),0);
 stale=false;}await menu();await page.screenshot({path:join(capture,'06-ask-entry.png')});
 await page.getByRole('menuitem',{name:'问 DSH',exact:true}).click();
 await page.waitForFunction(()=>window.__sceneAskResult||window.__sceneAskError,null,{timeout:90000});
 assert.equal(await page.evaluate(()=>window.__sceneAskError),undefined);
 const result=await page.evaluate(()=>window.__sceneAskResult);
 assert.ok(result.sessionId);assert.equal(result.files[0].name,'快记摘录.md');assert.ok(result.files[0].text.includes(text));
 const native=page.frames().find(f=>f!==page.mainFrame()&&f.url().includes('harness'));
 assert.ok(native,'native DSH iframe');await native.getByText('快记摘录.md',{exact:true}).waitFor();
 const composer=native.locator('[data-composer-card] [contenteditable="true"][role="textbox"]');
 await composer.waitFor();assert.equal((await composer.innerText()).trim(),'');
 await page.screenshot({path:join(capture,'06-ask-result.png')});
 await writeFile(join(capture,'official-cli-acceptance.json'),JSON.stringify({passed:true,sessionCreated:true,attachmentName:result.files[0].name,containsCompleteSource:true,composerEmpty:true,staleReadDeniedBeforeDraft:live?"covered in synthetic failure run":true,realServices:live,uiWritesVerified:live,selectedTextReplyVerified:live,installedSdk:true,officialSessionToolRead:true,artifact},null,2));
 console.log(live?'PASS: installed SDK + official session Tool + six real-service UI flows and native attachment draft':'PASS: installed SDK + official session Tool + native attachment draft; stale read rejected before native preparation');

 }
} catch(error){if(page){await page.screenshot({path:join(capture,'failure.png')}).catch(()=>{});await writeFile(join(capture,'failure-body.txt'),await page.locator('body').innerText()).catch(()=>{})}await writeFile(join(capture,'calls.json'),JSON.stringify(calls,null,2));console.error(error);process.exitCode=1;} finally{await browser?.close();child?.kill('SIGTERM');server.closeAllConnections();server.close();}
