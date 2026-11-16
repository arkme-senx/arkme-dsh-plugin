// Run against an isolated fake backend/SDK. No Tencent or user account requests.
import { build } from '../tools/desktop-call/node_modules/esbuild/lib/main.js'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const { chromium } = await import(process.env.GAME_PLAYWRIGHT_MODULE || 'playwright')
const dir = await mkdtemp(join(tmpdir(), 'arkme-game-smoke-'))
await build({
  entryPoints: ['src/client/game/standalone.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: join(dir, 'game.js'),
  alias: { '@tencentcloud/lite-chat': resolve('tests/fixtures/game-sdk.ts') },
  define: { 'process.env.NODE_ENV': '"production"' },
})
const policyBuild=await build({entryPoints:['src/game-assets.ts'],bundle:true,write:false,format:'esm',platform:'node'})
const {GAME_CONTENT_SECURITY_POLICY}=await import('data:text/javascript;base64,'+Buffer.from(policyBuild.outputFiles[0].text).toString('base64'))
const parent = `<!doctype html><button id="open">打开游戏</button><script>
let win;const room={room_id:'a'.repeat(32),game_type:'chinese_checkers',status:'creating',runtime_id:'',host_membership_id:'member1',im_group_id:'test-group',membership_version:1,members:Array.from({length:6},(_,i)=>({membership_id:'member'+(i+1),user_id:i+1,client_id:1,registration_id:'u'+(i+1),binding_generation:'b',join_seq:i+1,status:'active',lease_expires_at:Date.now()+60000}))};
document.querySelector('#open').onclick=()=>{win=window.open('/game','_blank','popup,width=1100,height=760')};
addEventListener('message',e=>{if(e.source!==win||e.origin!==location.origin)return;const {action,body,id}=e.data;let data;if(action==='init')data={command:{kind:'create'}};else if(action==='profiles')data={profiles:room.members.map((m,i)=>({membershipId:m.membership_id,registrationId:m.registration_id,userId:m.user_id,name:['小明','小红','小王','小李','很长很长的玩家昵称','小林'][i],avatarUrl:i===1?'https://invalid.example/avatar.png':i===2?'https://avatars.example/test.svg':'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2230%22 height=%2230%22%3E%3Crect width=%2230%22 height=%2230%22 fill=%22%234a91d1%22/%3E%3C/svg%3E'}))};else {if(action==='create')room.runtime_id=body.runtime_id;if(action==='activate')room.status='open';room.members.forEach(m=>m.lease_expires_at=Date.now()+60000);data={room,membership_id:'member1',invite_token:'b'.repeat(64),server_time:Date.now(),credentials:{sdk_app_id:123,user_id:'u1',user_sig:'fake',expires_at:Date.now()+3600000}}}win.postMessage({channel:'arkme.game.window.v1',id,data},location.origin)});
</script>`
const server = createServer(async (req, res) => {
  if(req.url==='/game')res.setHeader('Content-Security-Policy',GAME_CONTENT_SECURITY_POLICY)
  res.setHeader('Content-Type', req.url === '/game.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
  res.end(
    req.url === '/game.js'
      ? await readFile(join(dir, 'game.js'))
      : req.url === '/game'
        ? '<div id="game"></div><script src="/game.js"></script>'
        : parent,
  )
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const port = server.address().port
const browser = await chromium.launch({
  headless: true,
  ...(process.env.GAME_CHROME_PATH ? { executablePath: process.env.GAME_CHROME_PATH } : {}),
})
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  await context.route('**/*', r=> {if(r.request().url()==='https://avatars.example/test.svg')return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="#c47c5d"/></svg>'});if(r.request().url().startsWith('https:'))return r.abort();return r.continue()})
  const page = await context.newPage()
  context.setDefaultTimeout(15000)
  const errors = []
  context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message))
  })
  await page.goto('http://127.0.0.1:' + port)
  const popupPromise = page.waitForEvent('popup')
  await page.click('#open')
  const popup = await popupPromise
  await popup.getByRole('button', { name: '跳棋 · 2 / 3 / 4 / 6 人' }).click()
  await popup.getByRole('button', { name: '复制房间钥匙' }).waitFor()
  await popup.getByRole('button', { name: '复制房间钥匙' }).click()
  const copied = await popup.evaluate(() => navigator.clipboard.readText())
  if (copied !== '发送「/game join ' + 'a'.repeat(32) + '.' + 'b'.repeat(64) + '」到群聊加入游戏')
    throw Error('copied key mismatch')
  await mkdir('test-results/game', {recursive:true})
  await popup.screenshot({path:'test-results/game/lobby.png',fullPage:true})
  const labels=await popup.locator('.segmented button').evaluateAll(buttons=>buttons.map(b=>{const range=document.createRange();range.selectNodeContents(b);return new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size}))
  if(labels.some(n=>n!==1))throw Error('player count wraps')
  await popup.getByRole('button', { name: '准备', exact: true }).click()
  await popup.getByRole('button', { name: '开始游戏' }).click({ timeout: 15000 })
  await popup.getByRole('img', { name: '六角星跳棋棋盘' }).waitFor()
  await popup.getByText('● 轮到你了',{exact:true}).waitFor()
  if(await popup.locator('polygon[data-camp]').count()!==6)throw Error('missing colored camps')
  const home=await popup.locator('circle[data-cell="8,-4"]').evaluate(e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))}))
  if(Math.abs(home.x)>0.01||home.y<190)throw Error('home camp is not at bottom')
  await popup.locator('[data-player-badge="member1"]', {hasText:'小明（你）'}).waitFor()
  if(await popup.locator('[data-player-badge]').count()!==6)throw Error('missing player identities')
  await popup.waitForFunction(()=>document.querySelector('[data-player-badge="member1"] img')?.naturalWidth>0)
  await popup.waitForFunction(()=>document.querySelector('[data-player-badge="member3"] img')?.naturalWidth>0)
  if(await popup.locator('[data-player-badge="member2"] img').count())throw Error('broken avatar did not fall back')
  const clearance=await popup.evaluate(()=>[...document.querySelectorAll('[data-player-badge]')].every(b=>{
    const x=Number(b.getAttribute('x')), y=Number(b.getAttribute('y'));
    return Math.hypot(Math.max(0,Math.abs(x+64)-64),Math.max(0,Math.abs(y+24)-24))>=271.9;
  }))
  if(!clearance)throw Error('player card touches board frame/shadow')
  const active=popup.locator('[data-player-badge="member1"] .current');
  await active.getByText('当前回合',{exact:true}).waitFor()
  if(await active.evaluate(e=>getComputedStyle(e).backgroundColor)!=='rgb(35, 100, 83)')throw Error('current player lacks filled highlight')
  const overlap=await popup.evaluate(()=>[...document.querySelectorAll('[data-player-badge]')].some(b=>{
    const r=b.getBoundingClientRect();return [...document.querySelectorAll('[data-cell]')].some(c=>{const q=c.getBoundingClientRect();return r.left<q.right&&r.right>q.left&&r.top<q.bottom&&r.bottom>q.top})
  }))
  if(overlap)throw Error('player identity overlaps a well')
  await popup.screenshot({path:'test-results/game/your-turn.png',fullPage:true})
  if ((await popup.locator('circle[data-cell]').count()) !== 121) throw Error('wrong board')
  await popup
    .locator('circle[data-cell]')
    .filter({ has: popup.locator('title', { hasText: '小明（你） 5,-4' }) })
    .click()
  await popup.locator('[data-landing="4,-4"]').waitFor()
  await popup.screenshot({path:'test-results/game/landings.png',fullPage:true})
  await popup
    .locator('circle[data-cell]')
    .filter({ has: popup.locator('title', { hasText: '空位 4,-4' }) })
    .click()
  await popup.evaluate(()=>{window.animationSegments=[];new MutationObserver(()=>{const e=document.querySelector('[data-animation-segment]');if(e)window.animationSegments.push(e.getAttribute('data-animation-segment'))}).observe(document.body,{subtree:true,childList:true,attributes:true})})
  await popup.getByRole('button', { name: '确认走棋' }).click()
  await popup.getByText('等待 小红 走棋',{exact:true}).waitFor().catch(async e=>{await popup.screenshot({path:'test-results/game/failure.png',fullPage:true});throw e})
  await popup.locator('[data-player-badge="member2"] .current').getByText('当前回合',{exact:true}).waitFor()
  if(await popup.locator('[data-player-badge="member1"] .current').count())throw Error('previous player remains highlighted')
  if(!await popup.evaluate(()=>window.animationSegments.includes('0')))throw Error('confirmed move did not animate')
  await popup.getByLabel('聊天文字').fill('输入法')
  await popup.getByLabel('聊天文字').dispatchEvent('keydown',{key:'Enter',isComposing:true})
  if(await popup.getByLabel('聊天文字').inputValue()!=='输入法')throw Error('IME enter sent a message')
  await popup.getByLabel('聊天文字').press('Shift+Enter')
  if(!(await popup.getByLabel('聊天文字').inputValue()).includes('\n'))throw Error('Shift Enter did not insert newline')
  await popup.getByLabel('聊天文字').fill('内部跳棋测试')
  await popup.getByLabel('聊天文字').press('Enter')
  await popup.locator('aside p').filter({ hasText: '内部跳棋测试' }).waitFor()
  if(!await popup.locator('.message.own .message-content small').filter({hasText:'小明（你）'}).count()||!await popup.locator('.message.own img').count())throw Error('chat identity missing')
  await popup.evaluate(()=>{document.querySelector('.messages').style.height='40px';document.querySelector('.messages').style.flex='none'})
  await popup.waitForTimeout(2100)
  await popup.getByLabel('聊天文字').fill('滚动验证\n'.repeat(15))
  await popup.getByLabel('聊天文字').press('Enter')
  await popup.locator('aside p').filter({hasText:'滚动验证'}).waitFor()
  await popup.locator('.message:not(.own) small', {hasText:'小红'}).first().waitFor()
  if(!await popup.locator('.message:not(.own) .person-avatar').count())throw Error('remote chat avatar missing')
  const atBottom=await popup.locator('.messages').evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight<2)
  if(!atBottom)throw Error('new message did not scroll to bottom')
  await popup.evaluate(()=>{document.querySelector('.messages').style.height='';document.querySelector('.messages').style.flex=''})
  await mkdir('test-results/game', { recursive: true })
  await popup.screenshot({ path: 'test-results/game/window.png', fullPage: true })
  if (errors.length) throw Error(errors.join('\n'))
  console.log(
    'PASS: picker, create, copy exact invitation, six-player lobby/start, 121 cells, legal move, text chat; screenshot test-results/game/window.png',
  )
  await context.close()
} finally {
  await browser.close()
  server.close()
  await rm(dir, { recursive: true, force: true })
}
