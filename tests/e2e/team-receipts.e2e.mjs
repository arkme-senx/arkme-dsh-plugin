// Installed artifact, unmodified official DSH, real Host + SSE + browser.
// Team authority is an isolated HTTP fixture; Mongo membership is covered by Team integration tests.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const dsh = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!dsh || !profile || !process.env.ARKME_E2E_TLS_KEY || !process.env.NODE_EXTRA_CA_CERTS) throw new Error('Isolated official DSH/profile/TLS required')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Install immutable tgz through official CLI')
const { launchWebScaffold } = await import(pathToFileURL(join(dsh, 'apps/web/tests/scaffold.ts')).href)
const { chromium } = createRequire(join(dsh, 'apps/web/package.json'))('playwright')

it('loads bounded summaries, keeps paged totals and refreshes receipts without touching content or the composer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkme team receipts ')), calls = [], streams = new Set(), errors = []
  let scaffold, browser, page, read = 1
  const team = { team_id:42, name:'阅读状态验收团队', jotmo_id:'receipt_fixture', role:1, can_edit_profile:true, avatar:{mode:'default',key:'receipt-team'} }
  const channel = { ...team, public_ref:'a'.repeat(32), enabled:true, revision:1, can_manage:true }
  const conversation = { conversation_uid:'receipt-conversation', channel, side:'team', visitor:{nickname:'回执来访者'}, last_seq:2, my_read_seq:2, unread:0 }
  const messages = [
    { message_uid:'incoming', actor_user_id:99001004, side:'external', sender:{nickname:'回执来访者'}, record:{status:'available',version:1,text_content:'需要团队共同查看的来信',template_kind:1} },
    { message_uid:'colleague', actor_user_id:99001002, side:'team', sender:{nickname:'回复同事'}, record:{status:'available',version:1,text_content:'同事已回复',template_kind:1} },
  ].map((m,i)=>({...m,seq:i+1,revision:1,state:'published',created_at:Date.now()-10000+i,own:false}))
  const summary = () => ({recipient_count:1000,read_count:read,unread_count:1000-read})
  const api = createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    const input=JSON.parse(Buffer.concat(chunks).toString()||'{}'),path=new URL(req.url,'https://localhost').pathname
    calls.push({path,input})
    if(path==='/api/v1/sse/chat/noty') {
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': connected\n\n')
      streams.add(res);res.on('close',()=>streams.delete(res));return
    }
    let data={items:[],users:[],sources:[],has_more:false}
    if(path.endsWith('/the-best-api-for-testing')) {
      const token=[{alg:'none'},{user_id:input.user_id,exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture'
      data={access_token:token,refresh_token:'receipt-fixture'}
    } else if(path.endsWith('/get-user-info')) data={user_id:99001001,nick_name:'回执验收',jotmo_id:'receipt_user',phone:'13800000000'}
    else if(path.endsWith('/team/list-mine')) data={teams:[team]}
    else if(path.endsWith('/team/members/list')) data={items:[],total_count:0,has_more:false}
    else if(path.endsWith('/message-channel/get')) data=channel
    else if(path.endsWith('/conversations/list')) data={items:input.side==='team'?[conversation]:[],has_more:false}
    else if(path.endsWith('/timeline/page')) data={conversation,messages,has_more:false,before_seq:0}
    else if(path.endsWith('/read-receipts/summary-list')) data={items:input.message_uids.map(message_uid=>({message_uid,team_read:true,summary:summary(),...(message_uid==='colleague'?{visitor_read:true}:{})})),last_seq:2,my_read_seq:2,unread:0}
    else if(path.endsWith('/read-receipts/query')) data={summary:summary(),team_read:true,visitor_read:true,has_more:!input.cursor,next_cursor:input.cursor?'':'next',members:(input.cursor?[3]:[1,2]).map(id=>({user_id:99002000+id,identity:{nickname:`成员${id}`},read:read===1000||id===1}))}
    else if(path.endsWith('/attention')) data={external:false,team:false,applications:false}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data}))
  })
  try {
    api.listen(0,'127.0.0.1');await once(api,'listening');const origin=`https://127.0.0.1:${api.address().port}`
    const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:`com.senqisi.receipts-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'disabled',shareWebsite:origin}
    for(const key of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService']) config[`${key}BaseUrl`]=origin
    const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{insert:[{id:'arkme-team-receipts',name:'@senguoyun/dsh-arkme',config}]}]))
    scaffold=await launchWebScaffold({harnessHome:resolve(profile,'../..'),extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'package.json')],replayFixture:resolve(dsh,'snapshots/web/plan-narrow-viewport/session.v3.jsonl'),replayProvidersOnly:true,compareReplaySession:false})
    expect(await scaffold.ctx.get('arkmeData').testLogin(99001001)).toMatchObject({status:'authenticated'})
    browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'})
    page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button',{name:'联系人',exact:true}).click()
    const section=page.locator('[data-directory-section="teams"]'),toggle=section.locator('.arkme-contact-directory-section-header')
    if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
    await section.getByRole('button',{name:/阅读状态验收团队/}).click()
    await page.locator('.arkme-team-detail').getByRole('button',{name:'团队消息通道',exact:true}).click()
    await page.getByRole('dialog',{name:/团队消息通道/}).getByRole('button',{name:'查看团队对话',exact:true}).click()
    await page.getByRole('treeitem').filter({hasText:'回执来访者'}).click()
    const pane=page.locator('.team-conversation-pane'),incoming=pane.locator('article').filter({hasText:'需要团队共同查看的来信'})
    const control=incoming.getByRole('button',{name:/查看阅读状态.*团队已读 1\/1000/})
    await control.waitFor()
    expect(calls.filter(c=>c.path.endsWith('/read-receipts/query'))).toHaveLength(0)
    expect(calls.filter(c=>c.path.endsWith('/summary-list')).every(c=>c.input.message_uids.length<=50)).toBe(true)
    const editor=pane.getByRole('textbox',{name:'团队消息内容'});await editor.fill('尚未发送的草稿')
    await control.click();const details=page.getByRole('dialog',{name:'查看阅读状态',exact:true})
    await details.getByText('成员1',{exact:true}).waitFor()
    expect(await details.innerText()).toContain('1/1000')
    await details.getByRole('button',{name:'更多成员',exact:true}).click();await details.getByText('成员3',{exact:true}).waitFor()
    const before=calls.filter(c=>c.path.endsWith('/timeline/page')).length
    await incoming.locator('.arkme-timed-bubble').evaluate(n=>window.__teamReceiptBubble=n)
    await expect.poll(()=>streams.size).toBeGreaterThan(0)
    read=1000
    for(const stream of streams)stream.write(`data: ${JSON.stringify({t:28,event_uid:randomUUID(),event_at:Date.now(),revision:1,kind:'team.receipt.changed',conversation_uid:'another-coalesced-conversation'})}\n\n`)
    await expect.poll(()=>details.innerText()).toContain('1000/1000')
    await expect.poll(()=>details.getByText('已读',{exact:true}).count()).toBe(3)
    expect(await details.getByText('未读',{exact:true}).count()).toBe(0)
    expect(calls.filter(c=>c.path.endsWith('/timeline/page')).length).toBe(before)
    expect(await editor.textContent()).toBe('尚未发送的草稿')
    expect(await incoming.locator('.arkme-timed-bubble').evaluate(n=>n===window.__teamReceiptBubble)).toBe(true)
    expect(await details.getByText('成员3',{exact:true}).count()).toBe(1)
    const capture=process.env.ARKME_E2E_CAPTURE_DIR
    if(capture){await mkdir(capture,{recursive:true});await page.screenshot({path:join(capture,'team-read-receipts.png')})}
    await page.keyboard.press('Escape');await details.waitFor({state:'hidden'})
    await incoming.getByRole('button',{name:/查看阅读状态.*团队已读 1000\/1000/}).click();await details.waitFor()
    expect(errors).toEqual([])
  } catch(error) {
    console.log(JSON.stringify({calls:calls.slice(-20),page:await page?.locator('body').innerText()}));throw error
  } finally {
    await browser?.close()
    if(scaffold){await scaffold.ctx.get('arkmeData').logout();await scaffold.close()}
    for(const stream of streams)stream.end()
    api.closeAllConnections();await new Promise(resolve=>api.close(resolve));await rm(root,{recursive:true,force:true})
  }
})
