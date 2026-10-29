// Opt-in packed-artifact acceptance against the separately running isolated stack.
// Synthetic login/directory only. Team history, search, jobs, locates and downloads
// all use the production Host adapter and real backend HTTP handlers.
import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {createServer} from 'node:https'
import {once} from 'node:events'
import {spawn,execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
const {ARKME_E2E_OUTPUT:output,ARKME_DSH_CLI:cli,ARKME_ARTIFACT:artifact,ARKME_STACK_ENV:stackFile,ARKME_PLAYWRIGHT_ANCHOR:anchor}=process.env
for(const [key,value] of Object.entries({output,cli,artifact,stackFile,anchor})) assert(value,`${key} is required`)
const root=resolve(output),home=join(root,'isolated home'),profile=join(home,'profiles/team-history')
await mkdir(profile,{recursive:true})
const owners=JSON.parse(await readFile(stackFile,'utf8'))
for(const name of ['team','record','chat']) {const u=new URL(owners[name]);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.protocol,'http:')}
const token=actor=>{const body=[{alg:'HS256',typ:'JWT'},{user_id:actor,client_id:1,iss:'jotmo',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return body+'.'+createHmac('sha256','team-interaction-isolated-stack').update(body).digest('base64url')}
const post=async(path,body,actor)=>{const r=await fetch(owners.team+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(actor)}`},body:JSON.stringify(body)});const value=await r.json();assert([0,200].includes(value.code),JSON.stringify(value));return value.data}
const visitor=500000+Math.floor(Math.random()*1000000),needle='端到端'+randomUUID()
const opened=await post('/api/v1/team/conversations/open',{public_ref:'a'.repeat(32)},visitor)
for(const text of [needle+' 工作 工作','第二条 工作']) await post('/api/v1/team/conversations/messages/send',{conversation_uid:opened.conversation.conversation_uid,side:'external',client_message_uid:randomUUID(),expected_reply_seq:0,content:{text_content:text,template_kind:1}},visitor)
const key=join(root,'tls.key'),cert=join(root,'tls.crt')
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
const calls=[]
const server=createServer({key:await readFile(key),cert:await readFile(cert)},async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks),path=new URL(req.url,'https://localhost').pathname
  if(path.endsWith('/sse/chat/noty')){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': isolated\n\n');return}
  const owner=path.startsWith('/api/v1/team/')?'team':path.startsWith('/api/v1/chats/')?'chat':undefined
  if(owner){calls.push({path,body:JSON.parse(bytes.toString()||'{}')});const upstream=await fetch(owners[owner]+path,{method:req.method,headers:{'Content-Type':'application/json',Authorization:req.headers.authorization??`Bearer ${token(4)}`},body:bytes});res.writeHead(upstream.status,{'content-type':'application/json'});res.end(await upstream.text());return}
  let data={items:[],users:[],has_more:false,total:0}
  if(path.endsWith('/the-best-api-for-testing'))data={access_token:token(4),refresh_token:'isolated-stack-session'}
  else if(path.endsWith('/get-user-info'))data={user_id:4,nick_name:'隔离成员4',phone:'13800000000',phone_binding_policy:{mode:'none'}}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:200,data}))
 }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}))}
})
server.listen(0,'127.0.0.1');await once(server,'listening')
let child,browser,page
try{
 const origin=`https://127.0.0.1:${server.address().port}`
 const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:`com.senqisi.history-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:'https://jotmo-app.senguo.me'}
 for(const key of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[`${key}BaseUrl`]=origin
 await writeFile(join(profile,'package.json'),JSON.stringify({name:'team-history-live-fixture',private:true,packageManager:'pnpm@11.7.0',dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}))
 await writeFile(join(profile,'pnpm-workspace.yaml'),'packages:\n  - .\nautoInstallPeers: false\n')
 const env={...process.env,DSH_HOME:home,NODE_EXTRA_CA_CERTS:cert}
 const install=spawn(process.execPath,[cli,'plugin','--profile','team-history','add','--workspace-root',resolve(artifact)],{env,stdio:['ignore','pipe','pipe']});let installLog='';install.stdout.on('data',b=>installLog+=b);install.stderr.on('data',b=>installLog+=b);const [code]=await once(install,'exit');await writeFile(join(root,'install.log'),installLog);assert.equal(code,0,'official installer failed; see install.log')
 const driverOutput=join(root,'driver.json')
 const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{id:'arkme-self',config},{insert:[{id:'history-live-driver',name:resolve('scripts/team-history-live-driver.mjs'),config:{profileManifest:join(profile,'package.json'),visitor,needle,output:driverOutput}}]}]))
 child=spawn(process.execPath,[cli,'--profile','team-history','--patch',overlay,'--no-open','--port','0'],{env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b)
 let driver
 for(let n=0;n<360;n++){try{driver=JSON.parse(await readFile(driverOutput,'utf8'));break}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,500))}
 await writeFile(join(root,'dsh.log'),log);assert(driver,'installed SDK/Tool failed; see dsh.log')
 const {chromium}=createRequire(resolve(anchor))('playwright')
 browser=await chromium.launch({channel:'chrome'});page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message))
 const source=driver.conversation
 await page.route('**/arkme-self/api',async route=>{const {operation,params={}}=route.request().postDataJSON();let value
  if(operation==='directory.list'||operation==='team.app.directory')value={section:params.section,items:params.section==='teams'||operation==='team.app.directory'?[{kind:'team',teamRef:source.channel.teamRef,displayName:'接待团队7',publicId:'stack_team_7',role:'member'}]:[],total:1,hasMore:false}
  else if(operation==='team.app.members')value={team:{teamRef:source.channel.teamRef,name:'接待团队7',jotmoId:'stack_team_7',currentUserRole:'member',createdAtMillis:1,updatedAtMillis:1},items:[],totalCount:0,hasMore:false}
  else {await route.continue();return}await route.fulfill({json:{ok:true,value}})
 })
 const url=log.match(/dsh web: (http[^\s]+\?token=[^\s]+)/)?.[1];assert(url,'authenticated URL absent')
 await page.goto(url);await page.getByRole('button',{name:'联系人',exact:true}).click()
 const directory=page.locator('[data-directory-section="teams"]'),toggle=directory.locator('.arkme-contact-directory-section-header');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
 await directory.getByRole('button',{name:/接待团队7/}).click();await page.getByRole('button',{name:/团队消息通道/}).click();await page.getByRole('button',{name:/查看团队对话/}).click()
 await page.locator('[data-team-side="team"]').filter({hasText:new RegExp(`用户\\s*${visitor}`)}).click()
 const queryCount=()=>calls.filter(c=>c.path.endsWith('/history/query')).length
 const queriesBefore=queryCount()
 await page.getByRole('button',{name:'搜索团队消息',exact:true}).click()
 const search=page.getByRole('dialog',{name:'查找团队消息',exact:true}),searchbox=search.getByRole('searchbox',{name:'搜索团队聊天关键词',exact:true})
 await search.getByText('输入关键词，查找消息或附件名称',{exact:true}).waitFor()
 assert.equal(await search.locator('input').count(),1);assert.equal(await search.locator('select').count(),0)
 assert.equal(queryCount(),queriesBefore,'empty search never enumerates history')
 await searchbox.fill(needle)
 await search.locator('[data-team-history-hit]').filter({hasText:needle}).first().waitFor()
 assert(calls.some(c=>c.path.endsWith('/history/query')&&c.body.keyword===needle))
 assert.equal(await search.locator('[data-team-history-hit] > span:last-child').first().evaluate(node=>getComputedStyle(node).webkitLineClamp),'3')
 assert.equal(await searchbox.evaluate(node=>getComputedStyle(node).padding),'8px 10px')
 await page.screenshot({path:join(root,'search.png')})
 await search.locator('[data-team-history-hit]').filter({hasText:needle}).first().click()
 await search.waitFor({state:'hidden'})
 assert(calls.some(c=>c.path.endsWith('/timeline/locate')),'search uses the existing bounded locator')
 await page.getByRole('button',{name:'搜索团队消息',exact:true}).click()
 assert.equal(await searchbox.inputValue(),needle)
 await searchbox.fill('');await search.getByText('输入关键词，查找消息或附件名称',{exact:true}).waitFor()
 assert.equal(await search.locator('[data-team-history-hit]').count(),0)
 await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'对话分析',exact:true}).click();const analysis=page.getByRole('dialog',{name:/对话分析/})
 const month=analysis.getByLabel('分析月份',{exact:true}),members=analysis.getByLabel('分析成员',{exact:true})
 assert.equal(await month.getAttribute('type'),'month');assert.equal(await month.inputValue(),'')
 await members.locator('option').filter({hasText:`用户${visitor}`}).waitFor({state:'attached'})
 assert.equal(await analysis.getByText('选择历史发送者',{exact:true}).count(),0)
 await analysis.locator('.ca-bar').first().waitFor()
 assert.equal(await analysis.locator('.ca-bar').count(),24)
 const range=await page.evaluate(()=>{const now=new Date(),y=now.getFullYear(),m=now.getMonth();return {month:`${y}-${String(m+1).padStart(2,'0')}`,from:new Date(y,m,1).getTime(),until:new Date(y,m+1,1).getTime(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}})
 await month.fill(range.month)
 await analysis.locator('.ca-bar').first().waitFor()
 assert(calls.some(c=>c.path.endsWith('/analysis/create')&&c.body.from_at===range.from&&c.body.until_at===range.until&&c.body.timezone===range.timezone))
 const selected=await members.locator('option').filter({hasText:`用户${visitor}`}).getAttribute('value')
 await members.selectOption(selected);await analysis.locator('.ca-bar').first().waitFor()
 assert(calls.some(c=>c.path.endsWith('/analysis/create')&&c.body.sender_user_id===visitor))
 assert(!calls.filter(c=>c.path.endsWith('/analysis/create')).some(c=>c.body.content_kind),'original analysis covers all media')
 await analysis.getByRole('button',{name:'一周内',exact:true}).click();assert.equal(await analysis.locator('.ca-cell').count(),168)
 await analysis.locator('.ca-cell:not(:disabled)').first().click()
 await analysis.locator('[data-team-history-hit]').first().waitFor()
 await analysis.getByRole('button',{name:'返回分布',exact:true}).click()
 await analysis.getByRole('button',{name:'全部时间',exact:true}).click();assert.equal(await month.inputValue(),'')
 await analysis.locator('.ca-cell').first().waitFor()
 await analysis.getByRole('button',{name:'词频分析',exact:true}).click()
 await analysis.getByRole('button',{name:/工作/}).first().waitFor();await analysis.getByRole('button',{name:/工作/}).first().click()
 await analysis.locator('[data-team-history-hit]').filter({hasText:needle}).first().waitFor();await page.screenshot({path:join(root,'word-sources.png')})
 await page.keyboard.press('Escape')
 const row=page.locator('[data-team-message-key]').filter({hasText:needle}).first()
 await row.getByRole('button',{name:/的用户卡片/}).click({button:'right'})
 await page.getByRole('menuitem',{name:'看TA的快记',exact:true}).click()
 const records=page.getByRole('dialog',{name:/的快记/})
 await records.locator('[data-team-visitor-record]').filter({hasText:needle}).first().waitFor()
 assert(calls.some(c=>c.path.endsWith('/messages/batch-get')&&c.body.items.length>0&&c.body.items.length<=50&&c.body.items.every(item=>item.expected_record_version>0)))
 await page.screenshot({path:join(root,'person-records.png')})
 await records.locator('[data-team-visitor-record]').filter({hasText:needle}).getByRole('button',{name:'查看原消息',exact:true}).click()
 await records.waitFor({state:'hidden'})
 await page.getByRole('button',{name:'更多团队对话操作',exact:true}).click()
 const downloadEvent=page.waitForEvent('download')
 await page.getByRole('menuitem',{name:/导出/}).click()
 const downloaded=await downloadEvent;assert.match(downloaded.suggestedFilename(),/-团队对话-\d{4}-\d{2}-\d{2}\.md$/u);await downloaded.saveAs(join(root,'browser-export.md'))
 const markdown=await readFile(join(root,'browser-export.md'),'utf8');assert(markdown.includes(needle.replaceAll('-','\\-')))
 assert.deepEqual(errors,[]);await writeFile(join(root,'acceptance.json'),JSON.stringify({installedArtifact:resolve(artifact),officialRuntime:'0.2.1-rc.2',realSdk:true,realTool:true,browserSearch:true,browserWordSource:true,browserExport:true,originalSearchControls:true,originalMonthMemberControls:true,activity24and168:true,boundedLocate:true,visiblePersonBatchHydration:true,originalFilename:true,backendPaths:[...new Set(calls.map(c=>c.path))],syntheticSeams:['login','account directory'],businessHttp:'real production handlers / isolated Mongo + OpenSearch + tokenizer'},null,2))
 console.log('PASS installed SDK + official Tool + browser search and word sources -> real backend')
}finally{
 if(page)await page.screenshot({path:join(root,'last-page.png')}).catch(()=>{})
 await browser?.close();child?.kill('SIGTERM');server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writeFile(join(root,'http-calls.json'),JSON.stringify(calls,null,2))
}
