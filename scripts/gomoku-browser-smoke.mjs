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
addEventListener('message',e=>{if(e.source!==win||e.origin!==location.origin)return;const {action,body,id}=e.data;let data;if(action==='init')data={command:{kind:'create'}};else if(action==='profiles')data={profiles:room.members.map((m,i)=>({membershipId:m.membership_id,registrationId:m.registration_id,userId:m.user_id,name:['小明','小红','小王','小李','很长很长的玩家昵称','小林'][i],avatarUrl:i===1?'https://invalid.example/avatar.png':i===2?'https://avatars.example/test.svg':'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2230%22 height=%2230%22%3E%3Crect width=%2230%22 height=%2230%22 fill=%22%234a91d1%22/%3E%3C/svg%3E'}))};else {if(action==='create'){room.runtime_id=body.runtime_id;room.game_type=body.game_type;}if(action==='activate')room.status='open';room.members.forEach(m=>m.lease_expires_at=Date.now()+60000);data={room,membership_id:'member1',invite_token:'b'.repeat(64),server_time:Date.now(),credentials:{sdk_app_id:123,user_id:'u1',user_sig:'fake',expires_at:Date.now()+3600000}}}win.postMessage({channel:'arkme.game.window.v1',id,data},location.origin)});
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
  await popup.getByRole('button',{name:'多人五子棋 · 2～6 人'}).click()
  await popup.getByRole('button',{name:'复制房间钥匙'}).waitFor()
  const lobbyReady=()=>popup.waitForFunction(()=>{const s=window.__gameTestSnapshot;return s&&!s.gomoku&&s.players.length===s.count&&s.ready.length===s.count})
  await lobbyReady()
  await popup.getByRole('group',{name:'本局人数'}).getByRole('button',{name:'5 人',exact:true}).click()
  await popup.waitForFunction(()=>document.querySelectorAll('.player-card').length===5)
  await lobbyReady()
  await popup.getByRole('group',{name:'本局人数'}).getByRole('button',{name:'2 人',exact:true}).click()
  await lobbyReady()
  await popup.getByRole('button',{name:'90 秒',exact:true}).click()
  await popup.waitForFunction(()=>document.querySelector('[aria-label="每回合时长"] [aria-pressed=true]')?.textContent.includes('90'))
  await lobbyReady()
  await popup.getByRole('button',{name:'开始游戏'}).click()
  await popup.getByRole('group',{name:'24×24 五子棋棋盘'}).waitFor()
  if(await popup.locator('[data-gomoku-cell]').count()!==576)throw Error('wrong board size')
  const grid=await popup.locator('.gomoku-board g[stroke] path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')))
  if(grid.length!==48||grid.some(d=>!/^M[0-9.]+ [0-9.]+[HV]673$/.test(d)))throw Error('invalid 24x24 grid paths')
  const cell=n=>popup.locator(`[data-gomoku-cell="${n}"]`)
  await cell(112).click();await popup.locator('[data-preview=true][data-gomoku-cell="112"]').waitFor()
  await cell(113).click();await popup.locator('[data-preview=true][data-gomoku-cell="113"]').waitFor()
  await popup.getByRole('button',{name:'取消选择'}).click()
  if(await popup.locator('[data-preview=true]').count())throw Error('preview not cancelled')
  await popup.evaluate(()=>window.dispatchEvent(new Event('game-test-disconnect')))
  await popup.getByRole('button',{name:'立即重连',exact:true}).click()
  await popup.getByText('● 轮到你了',{exact:true}).waitFor()
  for(let i=0;i<5;i++){
    await cell(105+i).click()
    if(await cell(105+i).getAttribute('data-stone')!=='0')throw Error('preview submitted prematurely')
    await popup.getByRole('button',{name:'确认落子',exact:true}).click()
    await popup.waitForFunction(n=>document.querySelector(`[data-gomoku-cell="${n}"]`)?.getAttribute('data-stone')==='1',105+i)
    if(i<4){
      await popup.getByText('等待 小红 落子',{exact:true}).waitFor()
      if(await popup.getByRole('button',{name:'确认落子',exact:true}).isEnabled())throw Error('out-of-turn action enabled')
      await popup.waitForFunction(()=>window.__gameTestSnapshot?.gomoku?.turn===1)
      await popup.evaluate(value=>window.dispatchEvent(new CustomEvent('game-test-action',{detail:{value}})),i*2)
      await popup.getByText('● 轮到你了',{exact:true}).waitFor()
    }
  }
  await popup.getByText('小明（你） 五子连珠，获胜！',{exact:true}).waitFor()
  await popup.locator('[data-winning-line]').waitFor({state:'attached'})
  await mkdir('test-results/game',{recursive:true})
  await popup.screenshot({path:'test-results/game/gomoku-win.png',fullPage:true})
  await popup.getByLabel('聊天文字').fill('五子棋联调');await popup.getByLabel('聊天文字').press('Enter')
  await popup.locator('aside p',{hasText:'五子棋联调'}).waitFor()
  await popup.getByRole('button',{name:'下一局',exact:true}).click()
  await popup.getByRole('button',{name:'开始游戏'}).waitFor()
  await popup.getByRole('group',{name:'本局人数'}).getByRole('button',{name:'5 人',exact:true}).click()
  await popup.getByRole('button',{name:'开始游戏'}).click()
  await popup.waitForFunction(()=>document.querySelectorAll('[data-gomoku-player]').length===5)
  if(await popup.locator('[data-gomoku-player]').count()!==5)throw Error('missing five-player identities')
  if(await popup.locator('[data-gomoku-cell]:not([data-stone="0"])').count())throw Error('next round retained stones')
  await popup.waitForFunction(()=>document.querySelector('[data-gomoku-cell="112"]')?.getAttribute('aria-disabled')==='false')
  if(!await popup.getByLabel('剩余时间').textContent().then(t=>Number(t.replace(' 秒',''))>80))throw Error('configured duration lost')
  const fits=await popup.locator('.gomoku-play').evaluate(e=>{const p=e.parentElement;return p.scrollHeight<=p.clientHeight+2})
  if(!fits)throw Error('gomoku board or controls clipped at default window size')
  await popup.screenshot({path:'test-results/game/gomoku-five.png',fullPage:true})
  if(errors.length)throw Error(errors.join('\n'))
  console.log('PASS: gomoku selection, 5 players, preview/cancel/confirm, reconnect, two-player five-in-row, winning line, chat and next round')
  await context.close()
} finally {
  await browser.close()
  server.close()
  await rm(dir, { recursive: true, force: true })
}
