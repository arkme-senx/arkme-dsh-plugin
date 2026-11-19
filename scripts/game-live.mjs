// Real TEST backend + Tencent SDK. Pass authorized test users explicitly.
import { build } from '../tools/desktop-call/node_modules/esbuild/lib/main.js'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
const gameType=process.env.GAME_LIVE_TYPE||'chinese_checkers'
if(!['chinese_checkers','multiplayer_gomoku','doudizhu'].includes(gameType))throw Error('Unsupported game type')
const ids=process.argv.slice(2).map(Number)
if(ids.length<2||ids.some(x=>!Number.isSafeInteger(x)||x<=0)||new Set(ids).size!==ids.length)throw Error('Supply distinct authorized test users')
const {chromium}=await import(process.env.GAME_PLAYWRIGHT_MODULE||'playwright')
const report={started:new Date().toISOString(),accounts:ids,checks:[],result:'running'},sessions=[],pages=[],secrets=[]
const safe=s=>secrets.reduce((v,k)=>k?v.split(k).join('[REDACTED]'):v,String(s))
async function post(base,path,body,token){
 const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)})
 let j;try{j=await r.json()}catch{throw Error(path+' HTTP '+r.status)}
 if(j.code!==200)throw Error(path+' code='+j.code+' reason='+(j.data?.reason??''))
 return j.data
}
const api=(s,p,b={})=>post('https://jotmo-webrtc.senguo.me',p,b,s.token)
const bundle=await build({stdin:{contents:"import {GameRuntime} from './src/client/game/runtime.ts'; window.GameRuntime=GameRuntime;",resolveDir:resolve('.'),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}})
const assetModule=await build({entryPoints:['src/game-assets.ts'],bundle:true,write:false,format:'esm',platform:'node'})
const {GAME_CONTENT_SECURITY_POLICY}=await import('data:text/javascript;base64,'+Buffer.from(assetModule.outputFiles[0].text).toString('base64'))
const csp=process.env.GAME_LIVE_CSP||GAME_CONTENT_SECURITY_POLICY
const server=createServer((q,r)=>{if(csp)r.setHeader('Content-Security-Policy',csp);r.setHeader('Content-Type',q.url==='/game.js'?'text/javascript':'text/html');r.end(q.url==='/game.js'?bundle.outputFiles[0].text:'<script src="/game.js"></script>')})
let browser
const check=(name,extra={})=>{report.checks.push({name,...extra});console.log(name)}
const waitAll=fn=>Promise.all(pages.map(p=>p.waitForFunction(fn,null,{timeout:25000})))
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 browser=await chromium.launch({executablePath:process.env.GAME_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
 for(const id of ids){
  const auth=await post('https://jotmo.senguo.me','/api/public/v1/auth/the-best-api-for-testing',{user_id:id,unique_code:'arkme-game-live-'+randomUUID(),ref:0,keep_cancel:true})
  secrets.push(auth.access_token,auth.refresh_token)
  const s={id,token:auth.access_token};sessions.push(s)
  const reg=await api(s,'/api/v1/device/register',{platform:5,os:'darwin',client_version_name:'game-live-validation',client_version_code:0,request_id:randomUUID(),expected_generation:''})
  s.generation=reg.device.registration_generation
  s.credentials=await api(s,'/api/v1/trtc/credentials');secrets.push(s.credentials.user_sig)
  if(!s.credentials.user_id.startsWith('test_'))throw Error('Non-test Tencent identity rejected')
  const ctx=await browser.newContext(),p=await ctx.newPage();pages.push(p)
  await p.addInitScript(()=>{window.cspViolations=[];addEventListener('securitypolicyviolation',e=>window.cspViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI.split('?')[0]}))})
  await p.exposeFunction('request',async(a,b)=>{
   if(a==='prepare')return {credentials:{...s.credentials,expires_at:Date.now()+3600000}}
   if(a==='ready'){
    if(b.registration_id!==s.credentials.user_id)throw Error('identity mismatch')
    if(!s.binding)s.binding=await api(s,'/api/v1/device/im-binding/register',{registration_generation:s.generation,registration_id:b.registration_id,request_id:randomUUID()})
    check('real_sdk_ready_and_bound',{user:id});return {}
   }
   let r
   try{r=await api(s,'/api/v1/game/room/'+a,b)}catch(e){
    // Match the production GameService boundary so lease recovery is exercised faithfully.
    const reason=e.message.split(' reason=')[1]
    const messages={game_room_unavailable:'房间或成员身份已失效，请退出后重新进入',game_room_closed:'房间已结束',game_device_binding_required:'设备 IM 登记已失效，请重新进入'}
    if(messages[reason])throw Error(messages[reason]);throw e
   }
   if(r.invite_token)secrets.push(r.invite_token)
   if(r.credentials?.user_sig)secrets.push(r.credentials.user_sig)
   if(r.room){s.room=r.room;s.membership=r.membership_id}
   return r
  })
  await p.goto('http://127.0.0.1:'+server.address().port)
  await p.evaluate(()=>{window.game=new window.GameRuntime(window.request,()=>{},()=>{})})
 }
 await pages[0].evaluate(type=>window.game.enter({kind:'create'},type),gameType)
 const createError=await pages[0].evaluate(()=>window.game.error)
 if(createError.includes('game_disabled')||createError.includes('game_im_admin_not_configured')){
  report.result='blocked';report.blocker=createError.includes('game_im_admin_not_configured')?'test_im_admin_not_configured':'test_game_feature_disabled';check('deployed_create_route_configuration_blocked')
  for(const p of pages.slice(1))await p.evaluate(()=>window.game.enter({kind:'create'}));throw Error(report.blocker)
 }
 async function retry(p){for(let i=0;i<8&&await p.evaluate(()=>window.game.initializationFailed);i++){await new Promise(r=>setTimeout(r,3000));await p.evaluate(()=>window.game.retry())}if(await p.evaluate(()=>window.game.initializationFailed))throw Error(await p.evaluate(()=>window.game.error))}
 if(!await pages[0].evaluate(()=>!!window.game.room))throw Error(await pages[0].evaluate(()=>window.game.error)||'No room admitted')
 await retry(pages[0])
 if(process.env.GAME_LIVE_RECREATE==='1'){
  const old=sessions[0].room, oldMembership=sessions[0].membership
  let busy=false
  try{await api(sessions[0],'/api/v1/game/room/create',{request_id:randomUUID(),runtime_id:randomUUID(),game_type:'chinese_checkers'})}
  catch(e){if(!e.message.includes('game_host_room_busy'))throw e;busy=true}
  if(!busy)throw Error('active host room was replaced')
  check('active_host_slot_reports_busy_not_closed')
  await pages[0].evaluate(()=>window.game.leave())
  let closed=false
  for(let i=0;i<15;i++){
   const r=await api(sessions[0],'/api/v1/game/room/get',{room_id:old.room_id,membership_id:oldMembership,runtime_id:old.runtime_id})
   if(r.room.status==='closed'){closed=true;break}
   await new Promise(r=>setTimeout(r,2000))
  }
  if(!closed)throw Error('previous room cleanup timed out')
  await pages[0].evaluate(async()=>{window.game=new window.GameRuntime(window.request,()=>{},()=>{});await window.game.enter({kind:'create'})})
  await retry(pages[0])
  if(!sessions[0].room||sessions[0].room.room_id===old.room_id)throw Error('create reused old room')
  check('fresh_create_after_close_uses_new_room')
 }
 const invite=await pages[0].evaluate(()=>({kind:'join',roomId:window.game.room?.room_id,token:window.game.token}))
 if(!invite.token)throw Error('missing invitation');secrets.push(invite.token)
 check('public_group_created_and_host_activated',{room:invite.roomId})
 for(const p of pages.slice(1)){await p.evaluate(c=>window.game.enter(c),invite);await retry(p)}
 await waitAll(()=>!!window.game.state);check('real_im_snapshot_received',{members:pages.length})
 let chatPages=pages
 if(gameType==='doudizhu'){
  const {validateDoudizhu}=await import('./doudizhu-live-checks.mjs')
  chatPages=await validateDoudizhu(pages,check)
 }else{
 const count=Number(process.env.GAME_LIVE_PLAYERS)||(pages.length>=6?6:[2,3,4].includes(pages.length)?pages.length:2)
 if(!(gameType==='multiplayer_gomoku'?[2,3,4,5,6]:[2,3,4,6]).includes(count)||count>pages.length)throw Error("invalid player count")
 await pages[0].evaluate(n=>window.game.act('count',n),count)
 await new Promise(r=>setTimeout(r,11000))
 for(const p of pages.slice(1,count)){await p.evaluate(()=>window.game.act('ready'));await p.waitForFunction(()=>!window.game.awaitingAction);await new Promise(r=>setTimeout(r,1000))}
 await pages[0].evaluate(()=>window.game.act('start'));await waitAll(()=>!!(window.game.state?.gomoku||window.game.state?.board))
 check('real_im_ready_and_start',{players:count,observers:pages.length-count})
 if(pages.length>count){
  const before=await pages[0].evaluate(()=>JSON.stringify(window.game.state.gomoku||window.game.state.board))
  await pages[count].evaluate(type=>window.game.act(type==='multiplayer_gomoku'?'place':'move',type==='multiplayer_gomoku'?105:[[5,-4],[4,-4]]),gameType)
  await pages[count].waitForFunction(()=>!window.game.awaitingAction&&!!window.game.error)
  if(before!==await pages[0].evaluate(()=>JSON.stringify(window.game.state.gomoku||window.game.state.board)))throw Error('observer changed board')
  check('observer_move_rejected')
 }
 await pages[0].evaluate(type=>window.game.act(type==='multiplayer_gomoku'?'place':'move',type==='multiplayer_gomoku'?105:[[5,-4],[4,-4]]),gameType);await waitAll(()=>(window.game.state?.gomoku||window.game.state?.board)?.turn===1)
 if(new Set(await Promise.all(pages.map(p=>p.evaluate(()=>JSON.stringify(window.game.state.gomoku||window.game.state.board))))).size!==1)throw Error('board mismatch')
 check('real_im_move_and_consistent_board')
 if(gameType==='multiplayer_gomoku'){
  await pages[1].evaluate(()=>window.game.reconnect())
  await pages[1].waitForFunction(()=>!window.game.paused&&!window.game.reconnecting)
  if(new Set(await Promise.all(pages.map(p=>p.evaluate(()=>JSON.stringify(window.game.state.gomoku))))).size!==1)throw Error('reconnected board mismatch')
  check('gomoku_reconnect_preserves_board')
  if(count===2){
   for(let i=0;i<3;i++){
    await pages[1].evaluate(cell=>window.game.act('place',cell),i*2)
    await waitAll(()=>window.game.state.gomoku.turn===0)
    await pages[0].evaluate(cell=>window.game.act('place',cell),106+i)
    await waitAll(()=>window.game.state.gomoku.turn===1||window.game.state.gomoku.ended)
   }
   await waitAll(()=>window.game.state.gomoku.ended&&window.game.state.gomoku.winningLine?.length===4)
   check('gomoku_real_four_in_row_all_members_end')
  }
 }
 }
 await pages[0].evaluate(()=>window.game.text('Arkme 群游戏真实联调'))
 await Promise.all(chatPages.slice(1).map(p=>p.waitForFunction(()=>window.game.messages.some(m=>m.payload.text==='Arkme 群游戏真实联调'))))
 check('real_text_group_chat');report.result='passed'
}catch(e){if(report.result!=='blocked')report.result='failed';report.error=safe(e.message);console.log(report.result+': '+report.error)}finally{
 for(const p of pages){const violations=await p.evaluate(()=>window.cspViolations||[]).catch(()=>[]);if(violations.length)check('csp_violations',{violations})}
 for(const p of [...pages].reverse())await p.evaluate(()=>window.game?.leave()).catch(()=>{})
 if(browser)await browser.close()
 const host=sessions[0]
 if(host?.room){try{
  let closed=false
  for(let i=0;i<12;i++){
   const r=await api(host,'/api/v1/game/room/get',{room_id:host.room.room_id,membership_id:host.membership,runtime_id:host.room.runtime_id})
   if(r.room.status==='closed'){closed=true;break}
   await new Promise(r=>setTimeout(r,2000))
  }
  if(!closed)throw Error('group cleanup not completed within 24 seconds')
  check('room_closed_after_tencent_group_cleanup')
 }catch(e){report.result='failed';check('room_cleanup_unverified',{error:safe(e.message)})}}
 for(const s of sessions){try{
  if(s.binding)await api(s,'/api/v1/device/im-binding/unregister',{registration_generation:s.generation,binding_generation:s.binding.binding_generation})
  if(s.generation)await api(s,'/api/v1/device/unregister',{registration_generation:s.generation})
  check('test_device_cleanup',{user:s.id})
 }catch(e){check('cleanup_failed',{user:s.id,error:safe(e.message)});report.result='failed'}}
 await new Promise(r=>server.close(r));report.finished=new Date().toISOString()
 const path=process.env.GAME_LIVE_REPORT||'/tmp/arkme-game-live-result.json';await writeFile(path,safe(JSON.stringify(report,null,2)))
 console.log('Report: '+path);if(report.result!=='passed')process.exitCode=1
}
