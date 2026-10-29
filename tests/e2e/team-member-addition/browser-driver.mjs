import {join} from 'node:path'
import {createRequire} from 'node:module'
import {readFile,writeFile} from 'node:fs/promises'
const fixtureDir=process.env.ARKME_T22_FIXTURE_DIR, anchor=process.env.ARKME_T22_PLAYWRIGHT_PACKAGE
if(!fixtureDir||!anchor)throw new Error('Isolated fixture directory and Playwright package anchor are required')
const {chromium}=createRequire(anchor)('playwright')
const log=await readFile(join(fixtureDir,'dsh.log'),'utf8'),url=log.match(/dsh web: (http[^\s]+)/)?.[1]
if(!url)throw new Error('DSH not ready')
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1200,height:900}})
try{
 await page.goto(url);await page.waitForTimeout(1500)
 const response=await page.request.post(new URL('/__t22/acceptance',url).href)
 const result=await response.json();if(response.status()!==200)throw new Error(JSON.stringify(result))
 const fixture=JSON.parse(await readFile(join(fixtureDir,'ready.json'),'utf8'))
 if(new URL(fixture.url).hostname!=='127.0.0.1')throw new Error('Loopback fixture required')
 await page.request.post(fixture.url+'/__test/remove',{headers:{Authorization:'Bearer '+fixture.owner_token,'X-Internal-Secret':'t22-isolated-secret'},data:{user_id:99001002}})
 await page.reload();await page.waitForTimeout(1000)
 await page.getByRole('button',{name:'联系人',exact:true}).click()
 const section=page.locator('[data-directory-section="teams"]'),toggle=section.locator('.arkme-contact-directory-section-header')
 if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
 await section.getByRole('button',{name:/批量添加验收团队/}).click()
 await page.getByRole('button',{name:'＋ 添加成员',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:/添加成员/});await dialog.waitFor()
 await dialog.getByRole('checkbox',{name:'同事99001002',exact:true}).click();await dialog.getByRole('checkbox',{name:'同事99001003',exact:true}).click()
 await dialog.getByRole('button',{name:'确认添加（2）',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('.arkme-team-add-dialog')?.textContent.includes('账号不可用，未添加'))
 const text=await dialog.textContent();if(!text.includes('同事99001002：已添加')||!text.includes('同事99001003：账号不可用，未添加'))throw new Error('UI per-person receipt missing')
 if(!await dialog.getByRole('button',{name:'确认添加（1）',exact:true}).isEnabled())throw new Error('rejected selection lost')
 const added=dialog.getByRole('checkbox',{name:'同事99001002',exact:true}),rejected=dialog.getByRole('checkbox',{name:'同事99001003',exact:true})
 await added.waitFor({state:'visible'})
 if(!await added.isDisabled()||!await rejected.isEnabled()||await rejected.getAttribute('aria-checked')!=='true')throw new Error('current candidate authority or rejected selection mismatch')
 for(const width of [1200,800,480]) { await page.setViewportSize({width,height:900}); if(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth))throw new Error('Dialog overflow') }
 await page.screenshot({path:join(fixtureDir,'member-results.png')})
 await dialog.getByRole('button',{name:'关闭',exact:true}).click()
 await page.locator('.arkme-team-member-row').filter({hasText:'同事99001002'}).waitFor({state:'visible'})
 const count=await page.locator('.arkme-team-detail-count strong').textContent()
 const snapshot=await page.request.post(fixture.url+'/api/v1/team/members/snapshot',{headers:{Authorization:'Bearer '+fixture.owner_token},data:{team_id:'42',limit:50}})
 const roster=await snapshot.json()
 if(roster.code!==200||Number(count)!==roster.data.member_count)throw new Error('current member count was not refreshed')
 await writeFile(join(fixtureDir,'acceptance.json'),JSON.stringify({...result,uiPartialResult:true,uiRejectedSelection:true,memberListRefreshed:true,currentCandidateAuthority:true,installedArtifact:true,actualMongo:true}))
 console.log('PASS: installed official DSH, external SDK, session Tool grant and UI actual Mongo receipt')
}catch(error){await writeFile(join(fixtureDir,'browser-failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(fixtureDir,'browser-failure.png')});throw error}finally{await browser.close()}
