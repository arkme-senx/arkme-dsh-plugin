// Six isolated windows, real runtime + WebCrypto, local admission and SDK transport only.
import {build} from '../tools/desktop-call/node_modules/esbuild/lib/main.js'
import {createServer} from 'node:http'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
const {chromium}=await import(process.env.GAME_PLAYWRIGHT_MODULE||'playwright')
const built=await build({entryPoints:['src/client/game/standalone.tsx'],bundle:true,write:false,format:'iife',platform:'browser',alias:{'@tencentcloud/lite-chat':resolve('tests/fixtures/game-multi-sdk.ts')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'smoke-only-runtime-inspection',setup(b){b.onLoad({filter:/game\/standalone\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('const [command, setCommand]', 'window.__gameRuntime = runtime;\n  const [command, setCommand]'),loader:'tsx'}))}}]})
const room={room_id:'a'.repeat(32),game_type:'doudizhu',status:'creating',runtime_id:'',host_membership_id:'m0',im_group_id:'isolated-ddz',membership_version:1,members:Array.from({length:6},(_,i)=>({membership_id:'m'+i,user_id:i+1,client_id:1,registration_id:'u'+i,binding_generation:'b',join_seq:i+1,status:'active',lease_expires_at:Date.now()+60000}))}
const names=['小明','小红','小王','观众甲','观众乙','观众丙']
const parent=i=>`<!doctype html><button id="open">打开游戏</button><script>
let win;document.querySelector('#open').onclick=()=>{win=window.open('/game','_blank','popup,width=1100,height=760')};
addEventListener('message',async e=>{if(e.source!==win||e.origin!==location.origin||e.data.channel!=='arkme.game.window.v1')return;const {action,body,id}=e.data;try{const data=await fetch('/rpc?i=${i}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,body})}).then(r=>r.json());win.postMessage({channel:'arkme.game.window.v1',id,data},location.origin)}catch{win.postMessage({channel:'arkme.game.window.v1',id,error:'测试接口失败'},location.origin)}})
</script>`
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type',url.pathname==='/game.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8')
 if(url.pathname==='/rpc'){
  let raw='';for await(const chunk of req)raw+=chunk
  const {action,body}=JSON.parse(raw),i=Number(url.searchParams.get('i'));let reply
  if(action==='init')reply={command:i===0?{kind:'create'}:{kind:'join',roomId:room.room_id,token:'b'.repeat(64)}}
  else if(action==='profiles')reply={profiles:room.members.map((m,j)=>({membershipId:m.membership_id,registrationId:m.registration_id,userId:m.user_id,name:names[j],avatarUrl:''}))}
  else{
   if(action==='create'){room.runtime_id=body.runtime_id;room.game_type=body.game_type}
   if(action==='activate')room.status='open'
   if(action==='close')room.status='closed'
   if(action==='leave'){room.members[i].status='left';room.membership_version++}
   room.members.forEach(m=>m.lease_expires_at=Date.now()+60000)
   reply={room,membership_id:'m'+i,invite_token:'b'.repeat(64),server_time:Date.now(),credentials:{sdk_app_id:1,user_id:'u'+i,user_sig:'isolated',expires_at:Date.now()+3600000}}
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));return
 }
 res.end(url.pathname==='/game.js'?built.outputFiles[0].text:url.pathname==='/game'?'<div id="game"></div><script src="/game.js"></script>':parent(Number(url.searchParams.get('i')||0)))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({headless:true,executablePath:process.env.GAME_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const pages=[],errors=[]
try{
 for(let i=0;i<6;i++){
  // Each profile represents a different device; production same-device window locks stay intact.
  const context=await browser.newContext({viewport:{width:1100,height:760}});context.setDefaultTimeout(30000)
  await context.route('https://**/*',r=>r.abort())
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
  await context.exposeFunction('__gameTestSend',async message=>{await Promise.all(pages.filter(p=>!p.isClosed()).map(p=>p.evaluate(m=>window.__gameTestDeliver?.(m),message)))})
  const parentPage=await context.newPage();await parentPage.goto('http://127.0.0.1:'+server.address().port+'/?i='+i)
  const opened=parentPage.waitForEvent('popup');await parentPage.click('#open');const page=await opened;pages.push(page)
  if(i===0)await page.getByRole('button',{name:'斗地主 · 3 人',exact:true}).click()
  await page.waitForFunction(()=>!!window.__gameRuntime?.state)
 }
 const all=fn=>Promise.all(pages.map(p=>p.waitForFunction(fn)))
 const privateReady=()=>{const g=window.__gameRuntime,v=g.doudizhuView,b=g.state?.doudizhu;return b&&v&&v.hand.length===b.counts[b.players.indexOf(v.member)]&&!g.paused}
 for(let i=1;i<3;i++){
  await pages[i].getByRole('button',{name:'准备',exact:true}).click()
  await Promise.all(pages.map(p=>p.waitForFunction(id=>window.__gameRuntime.state.ready.includes(id),'m'+i)))
 }
 await pages[0].getByRole('button',{name:'开始游戏',exact:true}).click()
 await all(()=>window.__gameRuntime.state?.doudizhu?.phase==='bidding');await all(privateReady)
 for(const p of pages.slice(0,3))if(await p.locator('[data-ddz-card]').count()!==17)throw Error('initial hand should have 17 cards')
 const publicDeal=await pages[0].evaluate(()=>window.__gameRuntime.state.doudizhu)
 if(publicDeal.bottom!==null||publicDeal.remaining!==null||'hands' in publicDeal)throw Error('public deal leaks hidden cards')
 await mkdir('test-results/game',{recursive:true})
 await pages[0].screenshot({path:'test-results/game/doudizhu-deal.png',fullPage:true})
 const bidder=publicDeal.turn
 await pages[bidder].getByRole('button',{name:'3 分',exact:true}).click()
 await all(()=>window.__gameRuntime.state.doudizhu.phase==='playing');await all(privateReady)
 const landlord=pages[bidder]
 if(await landlord.locator('[data-ddz-card]').count()!==20)throw Error('landlord did not get bottom cards')
 if(await landlord.getByRole('button',{name:'不出',exact:true}).isEnabled())throw Error('leader can pass')
 const cards=landlord.locator('[data-ddz-card]')
 await cards.nth(0).click();await cards.nth(1).click()
 if(await landlord.locator('[data-ddz-card][aria-pressed="true"]').count()!==2)throw Error('card toggle failed')
 await landlord.getByRole('button',{name:'取消选择',exact:true}).click()
 if(await landlord.locator('[data-ddz-card][aria-pressed="true"]').count())throw Error('selection not cleared')
 await landlord.getByRole('button',{name:'提示',exact:true}).click()
 if(await landlord.locator('[data-ddz-card][aria-pressed="true"]').count()!==1)throw Error('leading hint is not the smallest single')
 await landlord.getByRole('button',{name:'出牌',exact:true}).click()
 await all(()=>window.__gameRuntime.state.doudizhu.lastCards.length===1);await all(privateReady)
 if(await landlord.locator('[data-ddz-card][aria-pressed="true"]').count())throw Error('submitted preview retained')
 for(const p of pages.slice(3)){
  await p.getByLabel('观战视角').selectOption('m1')
  await p.waitForFunction(()=>window.__gameRuntime.doudizhuView?.member==='m1')
  if(await p.getByRole('button',{name:'出牌',exact:true}).count()&&await p.getByRole('button',{name:'出牌',exact:true}).isEnabled())throw Error('spectator controls enabled')
 }
 const expected=await pages[1].evaluate(()=>JSON.stringify(window.__gameRuntime.doudizhuView.hand))
 for(const p of pages.slice(3))if(await p.evaluate(()=>JSON.stringify(window.__gameRuntime.doudizhuView.hand))!==expected)throw Error('wrong spectator hand')
 await pages[1].evaluate(()=>window.dispatchEvent(new Event('game-test-disconnect')))
 await pages[1].getByRole('button',{name:'立即重连',exact:true}).click();await pages[1].waitForFunction(privateReady)
 if(await pages[1].evaluate(()=>JSON.stringify(window.__gameRuntime.doudizhuView.hand))!==expected)throw Error('hand changed after reconnect')
 await pages[0].getByLabel('聊天文字').fill('斗地主六窗口联调');await pages[0].getByLabel('聊天文字').press('Enter')
 await Promise.all(pages.map(p=>p.locator('aside p',{hasText:'斗地主六窗口联调'}).waitFor()))
 for(const p of [landlord,pages[3]]){
  const layout=await p.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,cards:[...document.querySelectorAll('[data-ddz-card]')].map(e=>{const r=e.getBoundingClientRect();return r.bottom<=innerHeight+1&&r.left>=-1&&r.right<=innerWidth+1})}))
  if(layout.overflow||layout.cards.some(v=>!v))throw Error('table or hand clipped')
 }
 await landlord.screenshot({path:'test-results/game/doudizhu-playing.png',fullPage:true})
 await pages[3].screenshot({path:'test-results/game/doudizhu-spectator.png',fullPage:true})
 const packets=await pages[0].evaluate(()=>window.__sentGamePackets||[])
 for(const m of packets.filter(m=>m.type==='TIMCustomElem')){
  if(new TextEncoder().encode(m.payload.data).length>4096)throw Error('packet exceeds 4KiB')
  const packet=JSON.parse(m.payload.data)
  if(packet.type==='snapshot'&&packet.payload.doudizhu){const b=packet.payload.doudizhu;if('hands' in b||'deck' in b||(b.phase==='dealing'||b.phase==='bidding')&&b.bottom!==null)throw Error('plaintext private state in group snapshot')}
 }
 await pages[2].evaluate(()=>window.__gameRuntime.leave())
 await Promise.all(pages.filter((_,i)=>i!==2).map(p=>p.waitForFunction(()=>window.__gameRuntime.state.doudizhu?.phase==='ended')))
 await pages[0].screenshot({path:'test-results/game/doudizhu-ended.png',fullPage:true})
 await pages[0].getByRole('button',{name:'下一局',exact:true}).click()
 await pages[0].getByRole('button',{name:'开始游戏',exact:true}).waitFor()
 if(await pages[0].evaluate(()=>!!window.__gameRuntime.state.doudizhu||window.__gameRuntime.state.ready.length!==1))throw Error('next lobby did not reset')
 if(errors.length)throw Error(errors.join('\n'))
 console.log('PASS: six windows, encrypted deal, bid, select/clear/hint/play, spectators, rekey, chat, exit, next and layout')
}catch(error){
 for(let i=0;i<pages.length;i++)console.log('window-status',i,await pages[i].evaluate(()=>{const g=window.__gameRuntime;return {phase:g?.state?.doudizhu?.phase,version:g?.state?.version,viewVersion:g?.doudizhuView?.version,viewMember:g?.doudizhuView?.member,error:g?.error,status:g?.status,paused:g?.paused,pending:g?.awaitingAction}}).catch(()=>({closed:true})))
 console.log('page-errors',errors);throw error
}finally{
 for(const page of [...pages].reverse())await page.evaluate(()=>window.__gameRuntime?.leave()).catch(()=>{})
 await browser.close();await new Promise(r=>server.close(r))
}
