// Installed-package acceptance on an unmodified DSH Web runtime. All account,
// team and message responses are isolated fixtures; no real sharing is changed.
import {createRequire} from 'node:module'
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const profile = process.env.ARKME_PACKED_PROFILE, anchor = process.env.ARKME_PLAYWRIGHT_ANCHOR
const output = process.env.ARKME_E2E_CAPTURE_DIR, logPath = process.env.ARKME_E2E_LOG
if (!profile || !anchor || !output || !logPath) throw Error('Supply a fresh tgz profile, Playwright anchor, capture directory and temporary DSH log')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
assert(/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? ''), 'Install the immutable tgz using the official CLI first')
const installed = JSON.parse(await readFile(join(profile, 'node_modules/@senguoyun/dsh-arkme/package.json'), 'utf8'))
const log = await readFile(logPath, 'utf8')
const url = [...log.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/g)].at(-1)?.[1]
assert(url, 'temporary DSH is not ready')
await mkdir(output, {recursive: true})
const {chromium} = createRequire(anchor)('playwright')
const team = {key:'team',teamRef:'team-fixture',name:'ABABA1',jotmoId:'ABABA1',currentUserRole:'owner',createdAtMillis:1,updatedAtMillis:1}
let shares = [
  {key:'share-a',ref:'grant-a',teamKey:'team',teamRef:team.teamRef,sharerKey:'member-a',sharerName:'Lucis',peerName:'0158',own:true},
  {key:'share-b',ref:'grant-b',teamKey:'team',teamRef:team.teamRef,sharerKey:'member-a',sharerName:'Lucis',peerName:'项目沟通群的外部联系人',own:true},
  {key:'share-c',ref:'grant-c',teamKey:'team',teamRef:team.teamRef,sharerKey:'member-b',sharerName:'小林',peerName:'周同学',own:false},
]
let releaseDirectory, holdDirectory = true, latest = 90, removed = -1, offline = false, revoked = false
const calls = [], errors = [], geometry = {}
const messages = (before = latest + 1) => Array.from({length:Math.min(50, before - 1)}, (_, i) => before - 1 - i).filter(i => i !== removed).map(i => ({
  itemUid:`message-${i}`,title:'',senderName:i%2 ? '0158':'Lucis',senderSide:i%2 ? 'peer':'sharer',isMe:false,status:1,version:1,
  textContent:i===89 ? '对外私聊保持只读，团队成员可以在这里查看沟通记录。' : i===70 ? '项目确认事项：\n'+('请按确认后的版本执行，遇到问题及时沟通。'.repeat(25)) : i%2 ? '好的，我会整理确认清单，今天下午发给你。':'方案已经确认，预算和排期都按最新版执行。',
  sendAtMillis: Date.UTC(2026,9,26,5,0) + i*60000,contentBlocks:[],
}))
const browser = await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome'})
let page
try {
  page = await browser.newPage({viewport:{width:1440,height:960},locale:'zh-CN'})
  page.on('pageerror', error => errors.push(error.stack))
  page.on('console', message => {if(message.type()==='error' && /TypeError|ReferenceError/.test(message.text()))errors.push(message.text())})
  await page.route('**/arkme-self/api', async route => {
    const {operation:op,params={}} = route.request().postDataJSON(); calls.push({op,params})
    let value
    if (op==='auth.status') value={status:'authenticated',environment:'test',userId:99001001}
    else if (op==='user.profile'||op==='user.profile.refresh') value={profile:{userId:99001001,nickname:'Lucis',arkmeId:'reader_fixture',bindings:{},contact:{phoneMasked:'138****0000'}},cachedAtMillis:Date.now(),revision:1}
    else if (op==='sources.list') value={items:[],hasMore:false}
    else if (op==='directory.list') value={section:params.section,items:[],total:0,hasMore:false}
    else if (op==='team.app.directory') value={section:'teams',items:params.countOnly?[]:[{kind:'team',teamRef:team.teamRef,displayName:team.name,publicId:team.jotmoId,role:'owner'}],total:1,hasMore:false}
    else if (op==='team.app.members') value={team,items:[{key:'self',userRef:'member-fixture',displayName:'Lucis',jotmoId:'lucis',identityState:'ready',role:'owner',joinedAtMillis:1,canRemove:false}],totalCount:1,hasMore:false}
    else if (op==='team.app.channel') value={teamRef:team.teamRef,name:team.name,jotmoId:team.jotmoId,publicRef:'b'.repeat(32),link:'https://example.invalid/team-message',enabled:false,canManage:true,revision:1}
    else if (op==='team.app.attention') value={team:false,external:false,applications:false}
    else if (op==='team.app.external.list') {if(holdDirectory)await new Promise(resolve=>{releaseDirectory=resolve});value={items:shares,hasMore:false}}
    else if (op==='team.app.external.unshare') {shares=shares.filter(share=>share.ref!==params.shareRef);value=null}
    else if (op==='team.app.external.page') {
      if(offline){await route.abort('connectionfailed');return}
      if(revoked){await route.fulfill({json:{ok:false,error:{code:'team-external_chat_not_accessible',message:'已取消共享',retryable:false}}});return}
      const grant=shares.find(share=>share.ref===params.shareRef) ?? shares[0]
      const before=params.beforeSeq || latest+1, items=messages(before).map(item=>({...item,senderName:item.senderSide==='sharer'?grant.sharerName:grant.peerName})), end=items.at(-1)?.itemUid.split('-').at(-1)
      value={items,mediaUrls:{},hasMore:Number(end)>1,beforeSeq:Number(end)||0}
    }
    if(value===undefined){await route.continue();return}
    await route.fulfill({json:{ok:true,value}})
  })
  await page.goto(url,{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'继续',exact:true}).click({timeout:3000}).catch(()=>{})
  await page.getByRole('button',{name:'联系人',exact:true}).click()
  const section=page.locator('[data-directory-section="teams"]'), toggle=section.locator('.arkme-contact-directory-section-header')
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
  await section.getByRole('button',{name:/ABABA1/}).click()
  await page.locator('.arkme-team-detail').getByRole('button',{name:'对外私聊',exact:true}).click()
  const dialog=()=>page.locator('.arkme-team-external-browser')
  const capture=async name=>dialog().screenshot({path:join(output,`${name}.png`)})
  await dialog().locator('.arkme-external-skeleton').first().waitFor()
  const initialBox=await dialog().boundingBox()
  await capture('reader-loading')
  holdDirectory=false;releaseDirectory()
  await dialog().getByRole('button',{name:'查看与 0158 的私聊',exact:true}).waitFor()
  const loadedBox=await dialog().boundingBox()
  assert.equal(initialBox.height,loadedBox.height);assert.equal(initialBox.width,loadedBox.width)
  geometry.stableFrame=loadedBox
  await capture('reader-directory')
  await dialog().getByRole('button',{name:'查看与 0158 的私聊',exact:true}).click()
  await dialog().locator('[data-message-key="message-90"]').waitFor({state:'attached'})
  const scroll=()=>dialog().locator('.arkme-external-messages')
  assert(await scroll().evaluate(node=>node.scrollHeight-node.scrollTop-node.clientHeight<5))
  const sideGeometry=await dialog().evaluate(el=>['left','right'].map(side=>{const row=el.querySelector(`.arkme-external-message[data-side="${side}"]`),avatar=row.querySelector('.arkme-external-avatar').getBoundingClientRect(),bubble=row.querySelector('.arkme-external-bubble').getBoundingClientRect();return{side,avatarX:avatar.x,bubbleX:bubble.x,bubbleRight:bubble.right}}))
  assert(sideGeometry[0].avatarX<sideGeometry[0].bubbleX);assert(sideGeometry[1].avatarX>sideGeometry[1].bubbleRight)
  geometry.sides=sideGeometry
  await capture('reader-messages')
  const anchorMessage=(key)=>scroll().evaluate((node,key)=>{const bounds=node.getBoundingClientRect();const rows=[...node.querySelectorAll('[data-message-key]')];const row=key?rows.find(row=>row.dataset.messageKey===key):rows.find(row=>row.getBoundingClientRect().bottom>bounds.top);return{key:row?.dataset.messageKey,offset:row?row.getBoundingClientRect().top-bounds.top:0}},key)
  await scroll().evaluate(node=>{node.scrollTop=0})
  const beforeHistory=await anchorMessage()
  await dialog().getByRole('button',{name:'查看更早消息',exact:true}).click()
  await dialog().locator('[data-message-key="message-1"]').waitFor({state:'attached'})
  const afterHistory=await anchorMessage(beforeHistory.key);assert.equal(afterHistory.key,beforeHistory.key);assert(Math.abs(afterHistory.offset-beforeHistory.offset)<3)
  await scroll().evaluate(node=>{node.scrollTop=node.scrollHeight/2})
  const beforeRefresh=await anchorMessage();latest=91
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await dialog().locator('[data-message-key="message-91"]').waitFor({state:'attached'})
  const afterRefresh=await anchorMessage(beforeRefresh.key);assert.equal(afterRefresh.key,beforeRefresh.key);assert(Math.abs(afterRefresh.offset-beforeRefresh.offset)<3)
  geometry.historyAnchor={beforeHistory,afterHistory,beforeRefresh,afterRefresh}
  removed=80;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await dialog().locator('[data-message-key="message-80"]').waitFor({state:'detached'})
  offline=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await dialog().getByRole('alert').waitFor();assert.equal(await dialog().locator('[data-message-key]').count(),90)
  offline=false;revoked=true;await dialog().getByRole('button',{name:'重试',exact:true}).click()
  await dialog().getByText('已取消共享',{exact:true}).waitFor();assert.equal(await dialog().locator('[data-message-key]').count(),0)
  revoked=false;await dialog().getByRole('button',{name:'关闭',exact:true}).click()
  await page.locator('.arkme-team-detail').getByRole('button',{name:'对外私聊',exact:true}).click()
  await dialog().getByRole('button',{name:'取消与 0158 的共享',exact:true}).click()
  assert.equal(calls.filter(call=>call.op.endsWith('.unshare')).length,0)
  await dialog().getByRole('button',{name:'确认取消共享',exact:true}).click()
  await dialog().getByRole('button',{name:'查看与 0158 的私聊',exact:true}).waitFor({state:'detached'})
  assert.equal(calls.filter(call=>call.op.endsWith('.unshare')).length,1)
  await page.setViewportSize({width:390,height:760})
  const narrowBox=await dialog().boundingBox();assert(narrowBox.width<=358&&narrowBox.x>=16&&narrowBox.y>=16&&narrowBox.y+narrowBox.height<=744)
  await dialog().getByRole('button',{name:'查看与 周同学 的私聊',exact:true}).click()
  await dialog().locator('[data-message-key="message-91"]').waitFor({state:'attached'})
  assert.equal(await dialog().locator('.arkme-external-directory').isVisible(),false)
  const overflow=await dialog().evaluate(el=>({dialog:el.scrollWidth>el.clientWidth,reader:el.querySelector('.arkme-external-reader').scrollWidth>el.querySelector('.arkme-external-reader').clientWidth}))
  assert(!overflow.dialog&&!overflow.reader)
  geometry.narrow={...narrowBox,overflow}
  await capture('reader-narrow')
  await dialog().getByRole('button',{name:'返回共享私聊列表',exact:true}).click()
  assert.equal(await dialog().locator('.arkme-external-directory').isVisible(),true)
  await dialog().getByRole('button',{name:'关闭',exact:true}).click()
  shares=shares.slice(0,1)
  await page.locator('.arkme-team-detail').getByRole('button',{name:'对外私聊',exact:true}).click()
  await dialog().locator('[data-message-key="message-91"]').waitFor({state:'attached'})
  assert.equal(await dialog().locator('.arkme-external-workspace').getAttribute('data-reading'),'true')
  assert.equal(await dialog().locator('textarea,[contenteditable="true"]').count(),0)
  await page.emulateMedia({colorScheme:'dark'})
  await capture('reader-system-theme')
  assert.equal(errors.length,0)
  const result={version:installed.version,checks:['stable loading and directory frame','participant avatars and opposing bubbles','initial scroll to latest','older-page anchor preserved','refresh reading position preserved','withdrawn message disappears','transient error keeps content','revoked access clears content','explicit revoke confirmation','narrow layout and back navigation','single chat opens directly','read-only surface'],geometry,pageErrors:errors}
  await writeFile(join(output,'reader-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
} catch(error) {
  if(page){await page.screenshot({path:join(output,'reader-failure.png')});await writeFile(join(output,'reader-failure.txt'),await page.locator('body').innerText());await writeFile(join(output,'reader-errors.json'),JSON.stringify({errors,calls},null,2))}
  throw error
} finally {await browser.close()}
