// Visual/interaction acceptance of the installed artifact on unmodified DSH.
// Identity/upstream and Team browser DTOs are synthetic fixtures; this is not a backend E2E.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
const dshRoot = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!dshRoot || !profile || !process.env.ARKME_E2E_TLS_KEY || !process.env.NODE_EXTRA_CA_CERTS) throw new Error('Supply official DSH, fresh artifact profile and isolated TLS fixture')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Install the immutable tgz with the official CLI first')
const { launchWebScaffold } = await import(pathToFileURL(join(dshRoot, 'apps/web/tests/scaffold.ts')).href)
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
it('keeps Team detail compact, uses shared menus and respects member permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkme team layout '))
  let scaffold, browser, page
  const failures = [], calls = []
  const api = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const path = new URL(req.url, 'https://localhost').pathname
    let data = { items: [], users: [], sources: [], has_more: false }
    if (path.endsWith('/the-best-api-for-testing')) {
      const token = [{ alg: 'none' }, { user_id: input.user_id, exp: Math.floor(Date.now() / 1000) + 3600 }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.fixture'
      data = { access_token: token, refresh_token: 'layout-fixture' }
    } else if (path.endsWith('/get-user-info')) data = { user_id: 99001001, nick_name: '布局验收', jotmo_id: 'layout_test', phone: '13800000000' }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 200, data }))
  })
  try {
    api.listen(0, '127.0.0.1'); await once(api, 'listening')
    const origin = `https://127.0.0.1:${api.address().port}`
    const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.layout-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'disabled', shareWebsite: origin }
    for (const key of ['auth', 'subject', 'record', 'data', 'team', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
    const overlay = join(root, 'overlay.json')
    await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-team-layout', name: '@senguoyun/dsh-arkme', config }] }]))
    // The artifact's native imports resolve through its profile's parent fallback,
    // which the official launcher maintains inside this same isolated home.
    scaffold = await launchWebScaffold({ harnessHome: resolve(profile, '../..'), extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], replayFixture: resolve(dshRoot, 'snapshots/web/plan-narrow-viewport/session.v3.jsonl'), replayProvidersOnly: true, compareReplaySession: false })
    expect(await scaffold.ctx.get('arkmeData').testLogin(99001001)).toMatchObject({ status: 'authenticated' })
    browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
    let owner = true, enabled = true
    const teamRef = `team_v1_${'a'.repeat(32)}`, publicRef = 'b'.repeat(32)
    const channel = () => ({ teamRef, name: 'Arkme Internal Interview', jotmoId: 'arkme_cn', publicRef, link: `https://example.com/team-message?channel=${publicRef}`, enabled, revision: 3, canManage: owner })
    const conversation = () => ({ref: 'conversation-ref', key: 'conversation-key', channel: channel(), side: 'team', visitor: {nickname:'布局验收'}, lastSeq: 3, latestTeamReplySeq: 2, myReadSeq: 3, unread: 0, needsReply: false, blocked: false, revision: 1, updatedAt: Date.now()})
    const messages = [
      {key:'own-text',ref:'own-text',seq:1,side:'external',own:true,sender:{nickname:'布局验收'},content:{text_content:'你好，我想反馈一个使用问题。',template_kind:1},media:[]},
      {key:'reply',ref:'reply',seq:2,side:'team',own:false,sender:{nickname:'Loki1999'},content:{text_content:'你好，请发一张截图，我们一起确认。',template_kind:1},media:[]},
      {key:'image-only',ref:'image-only',seq:3,side:'external',own:true,sender:{nickname:'布局验收'},content:{text_content:'',template_kind:2},media:[{ref:'team-image',key:'team-asset',url:'/arkme-self/test-team-media/image',name:'界面截图.png',mimeType:'image/png',size:4096}]},
    ].map((m,i)=>({...m,revision:1,state:'published',createdAt:Date.now()-120000+i*30000,canEdit:m.own,canDelete:m.own,recipientRead:false,version:1,contentStatus:'available'}))
    let grantRevision = 0
    const mediaRequests=[]
    const fixtureImage=await readFile(new URL('../../assets/branding/jiwo-about-icon.png',import.meta.url))
    // Serve bytes normally: browser-wide interception can suspend about:blank popup requests.
    scaffold.ctx.get('webServer').register({kind:'exact',path:'/arkme-self/test-team-media/image',handler:(req,res)=>{mediaRequests.push(req.url);res.writeHead(200,{'Content-Type':'image/png'});res.end(fixtureImage)}})
    const mockTeamAPI = async route => {
      const { operation: op, params = {} } = route.request().postDataJSON()
      calls.push(op)
      let value
      if (op === 'team.app.channel' || op === 'team.app.official') value = channel()
      else if (op === 'team.app.channel.configure') { enabled = params.enabled; value = channel() }
      else if (op === 'team.app.members') value = { team: { teamRef, name: channel().name, jotmoId: channel().jotmoId, currentUserRole: owner ? 'owner' : 'member', createdAtMillis: 1, updatedAtMillis: 1 }, items: ['Loki1999', 'Jotmoer', '设计讨论小组', '510'].map((name, i) => ({ userRef: `usr_v1_${String(i).repeat(32)}`, displayName: name, jotmoId: `member_${i}`, identityState: 'ready', role: i === 0 ? 'owner' : 'member', joinedAtMillis: 1, canRemove: owner && i > 0 })), totalCount: 4, hasMore: false }
      else if (op === 'team.app.directory') value = { section: 'teams', items: params.countOnly ? [] : [{ kind: 'team', teamRef, displayName: channel().name, publicId: 'arkme_cn', role: owner ? 'owner' : 'member' }], total: 1, hasMore: false }
      else if (op === 'directory.list') value = { section: params.section, items: [], total: 0, hasMore: false }
      else if(op === 'team.app.open') value={channel:channel(),conversation:conversation()}
      else if(op === 'team.app.timeline') {
        const revision=++grantRevision
        value={conversation:conversation(),messages:messages.map(m=>({...m,ref:`${m.key}-grant-${revision}`,
          sender:{...m.sender,imageKey:`avatar-${m.sender.nickname}`,imageRef:`avatar-${revision}-${m.sender.nickname}`},
          media:m.media.map(f=>({...f,key:`asset-${m.key}`,ref:`media-grant-${revision}`,url:`/arkme-self/test-team-media/image?grant=${revision}`}))})),hasMore:false,beforeSeq:0}
      }
      else if(op === 'team.app.image') value={base64:fixtureImage.toString('base64'),mimeType:'image/png'}
      else if(op === 'team.app.send') {
        const m={...messages[0],key:`sent-${messages.length}`,ref:`sent-${messages.length}`,seq:messages.length+1,content:params.content,createdAt:Date.now()}
        messages.push(m);value={message:m}
      }
      else if(op === 'team.app.receipts') value={teamRead:true,visitorRead:true,hasMore:false,members:[
        {nickname:'Loki1999',read:true,readAt:Date.now(),imageKey:'receipt-avatar',imageRef:'receipt-avatar'},
        {nickname:'设计同事',read:false,readAt:0},{nickname:'研发同事',read:false,readAt:0}]}
      else if(op === 'team.app.read') value={}
      else if(op === 'team.app.home.visibility') value={version:1,showInHome:true}
      else if (op === 'team.app.applications' || op === 'team.app.conversations') value = { items: [], hasMore: false }
      else if (op === 'team.app.attention') value = { team: false, external: false, applications: false }
      else { await route.continue(); return }
      await route.fulfill({ json: { ok: true, value } })
    }
    await page.route('**/arkme-self/api', mockTeamAPI)
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '联系人', exact: true }).click()
    const section = page.locator('[data-directory-section="teams"]')
    const toggle = section.locator('.arkme-contact-directory-section-header')
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await section.getByRole('button', { name: /Arkme Internal Interview/ }).click()
    const detail = page.locator('.arkme-team-detail')
    await detail.getByRole('heading', { name: '团队成员', exact: true }).waitFor()
    await detail.getByRole('switch', { name: '接收外部消息' }).waitFor()
    expect(await detail.getByRole('listitem').count()).toBe(4)
    const geometry = await detail.evaluate(node => {
      const header = node.querySelector('.arkme-team-detail-header').getBoundingClientRect()
      const members = node.querySelector('.arkme-team-members').getBoundingClientRect()
      const settings = node.querySelector('.team-settings').getBoundingClientRect()
      return { memberGap: members.top - header.bottom, settingsTop: settings.top, membersBottom: members.bottom, overflow: getComputedStyle(node).overflowY }
    })
    expect(geometry.memberGap).toBeLessThan(40)
    expect(geometry.settingsTop).toBeGreaterThanOrEqual(geometry.membersBottom - 1)
    expect(geometry.overflow).toBe('auto')
    const output = process.env.ARKME_E2E_CAPTURE_DIR
    const capture = async name => { if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, `${name}.png`) }) } }
    await capture('plugin-owner-team')
    await section.getByRole('button', { name: '团队操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '创建团队', exact: true }).waitFor()
    await capture('plugin-team-menu')
    await page.keyboard.press('Escape')
    expect(await page.getByRole('menuitem', { name: '创建团队', exact: true }).count()).toBe(0)
    for (const label of ['创建团队', '加入团队', '通过链接发消息']) {
      await section.getByRole('button', { name: '团队操作', exact: true }).click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: label, exact: true })
      await dialog.waitFor(); await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    }
    await detail.getByRole('button', { name: '复制消息链接', exact: true }).click()
    await detail.getByText('通道链接已复制', { exact: true }).waitFor()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(channel().link)
    await detail.getByRole('switch').click()
    await expect.poll(() => detail.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    await detail.getByRole('switch').click()
    await expect.poll(() => detail.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    await page.setViewportSize({ width: 1024, height: 768 })
    const edges = await detail.evaluate(node => ['.arkme-team-detail-header-main', '.arkme-team-members-container', '.team-settings'].map(selector => { const rect = node.querySelector(selector).getBoundingClientRect(); return { left: rect.left, right: rect.right } }))
    expect(Math.max(...edges.map(v => v.left)) - Math.min(...edges.map(v => v.left))).toBeLessThan(2)
    expect(Math.max(...edges.map(v => v.right)) - Math.min(...edges.map(v => v.right))).toBeLessThan(2)
    await capture('plugin-owner-compact')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    expect(await detail.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgb(255, 255, 255)')
    await capture('plugin-owner-dark')
    await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
    await page.setViewportSize({ width: 1024, height: 768 })
    owner = false; await page.reload()
    await page.getByRole('button', { name: '联系人', exact: true }).click()
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await section.getByRole('button', { name: /Arkme Internal Interview/ }).click()
    await detail.getByRole('button', { name: '退出团队', exact: true }).waitFor()
    expect(await detail.getByRole('switch').count()).toBe(0)
    expect(await detail.getByRole('button', { name: '移除', exact: true }).count()).toBe(0)
    await capture('plugin-member-team')
    expect(calls).toContain('team.app.members')
    await page.setViewportSize({width:1440,height:1000})
    await page.getByRole('button',{name:'对话',exact:true}).click()
    await page.getByRole('treeitem',{name:'联系作者',exact:true}).click()
    const pane=page.locator('.team-conversation-pane')
    const imageRow=pane.locator('[data-team-message-key="image-only"]')
    const thumb=imageRow.getByRole('img',{name:'界面截图.png',exact:true})
    await expect.poll(()=>thumb.evaluate(node=>node.complete && node.naturalWidth>0)).toBe(true)
    expect(await imageRow.locator('p').filter({hasText:/^$/}).count()).toBe(0)
    expect(await pane.locator('textarea').count()).toBe(0)
    expect(await pane.getByRole('textbox',{name:'团队消息内容'}).getAttribute('contenteditable')).toBe('true')
    expect(await pane.getByRole('button',{name:'刷新',exact:true}).count()).toBe(0)
    await capture('plugin-conversation-media')
    const retainedImage=await thumb.elementHandle()
    const readsBefore=mediaRequests.length
    const headerBefore=await pane.locator('header').first().boundingBox()
    const input=pane.getByRole('textbox',{name:'团队消息内容'})
    await input.fill('发送后，已有图片保持原位')
    const retainedText = await input.evaluateHandle(node => node.firstChild)
    const avatars = await pane.locator('.team-avatar img').elementHandles()
    const timelineRequests = calls.filter(op=>op==='team.app.timeline').length
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await expect.poll(()=>calls.filter(op=>op==='team.app.timeline').length).toBeGreaterThan(timelineRequests)
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    expect(await retainedText.evaluate(node=>node.isConnected)).toBe(true)
    await pane.getByRole('button',{name:'发送',exact:true}).click()
    await pane.getByText('发送后，已有图片保持原位',{exact:true}).waitFor()
    await expect.poll(()=>input.textContent()).toBe('')
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    expect(await retainedImage.evaluate(node=>node.isConnected && node === document.querySelector('[data-team-message-key="image-only"] img[alt="界面截图.png"]'))).toBe(true)
    for (const avatar of avatars) expect(await avatar.evaluate(node=>node.isConnected && node.complete && node.naturalWidth>0)).toBe(true)
    expect(mediaRequests.length).toBe(readsBefore)
    expect(await pane.getByText('正在读取…',{exact:true}).count()).toBe(0)
    expect((await pane.locator('header').first().boundingBox()).y).toBe(headerBefore.y)
    const receiptTarget=pane.locator('[data-team-message-key="own-text"]').getByLabel('消息操作',{exact:true})
    await receiptTarget.scrollIntoViewIfNeeded()
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await pane.locator('[data-team-message-key="own-text"]').getByRole('button',{name:'未读，查看阅读状态',exact:true}).click()
    const receiptPanel=page.getByRole('dialog',{name:'查看阅读状态',exact:true})
    await receiptPanel.getByText('Loki1999',{exact:true}).waitFor()
    expect(await receiptPanel.getAttribute('data-arkme-read-receipt-panel-placement')).toMatch(/above|below/)
    expect(await receiptPanel.getByLabel('未读',{exact:true}).count()).toBe(2)
    expect(await page.locator('[data-arkme-confirm-dialog-backdrop]').count()).toBe(0)
    const receiptBox=await receiptPanel.boundingBox()
    expect(receiptBox.x).toBeGreaterThanOrEqual(0)
    expect(receiptBox.y+receiptBox.height).toBeLessThanOrEqual(1000)
    await capture('plugin-team-read-receipts')
    await page.keyboard.press('Escape')
    expect(await receiptPanel.count()).toBe(0)

    await pane.getByRole('button',{name:'对话选项',exact:true}).click()
    await page.getByRole('menuitem',{name:'快记不显示在首页'}).waitFor()
    expect(await page.getByRole('menuitem',{name:/刷新|关于此对话/}).count()).toBe(0)
    await page.keyboard.press('Escape')
    await pane.getByRole('textbox',{name:'团队消息内容'}).fill('尚未发送的草稿')
    await pane.locator('[data-team-message-key="own-text"]').getByLabel('消息操作',{exact:true}).click({button:'right'})
    await page.getByRole('menuitem',{name:'编辑',exact:true}).click()
    await pane.locator('[data-team-composer="reedit"]').waitFor()
    expect(await page.getByRole('dialog',{name:'编辑消息',exact:true}).count()).toBe(0)
    await capture('plugin-inline-reedit')
    await pane.getByRole('button',{name:'关闭重新编辑'}).click()
    expect(await pane.getByRole('textbox',{name:'团队消息内容'}).textContent()).toBe('尚未发送的草稿')
    // Browser fallback uses the same gallery as ordinary conversations.
    await imageRow.getByRole('button',{name:'预览图片 界面截图.png',exact:true}).click()
    const preview=page.locator('[data-arkme-image-preview-viewport] img')
    await expect.poll(()=>preview.evaluate(node=>node.complete && node.naturalWidth>0)).toBe(true)
    expect(await preview.getAttribute('src')).toContain('/arkme-self/test-team-media/')
    await capture('plugin-image-preview')
    await page.getByRole('button',{name:'关闭预览',exact:true}).click()
    // Desktop preview capability opens a separate React root: Team grants must survive it.
    await page.evaluate(()=>{window.arkmeAttachmentPreview={version:1,focus(){},close(){}}})
    // Chrome's request interception stalls requests in an initial about:blank.
    // The preview uses the real fixture byte route, so remove interception while it is open.
    await page.unroute('**/arkme-self/api', mockTeamAPI)
    const popupPromise=page.waitForEvent('popup')
    await imageRow.getByRole('button',{name:'预览图片 界面截图.png',exact:true}).click()
    const popup=await popupPromise
    const popupImage=popup.locator('[data-arkme-image-preview-viewport] img')
    await expect.poll(()=>popupImage.count()).toBe(1)
    await expect.poll(()=>popupImage.evaluate(node=>node.complete && node.naturalWidth>0),{timeout:3000}).toBe(true)
    expect(await popupImage.getAttribute('src')).toContain('/arkme-self/test-team-media/')
    if(output) await popup.screenshot({path:join(output,'plugin-image-window.png')})
    await page.route('**/arkme-self/api', mockTeamAPI)
    await popup.close()
    expect(mediaRequests.length).toBeGreaterThanOrEqual(1)
    await page.setViewportSize({width:1024,height:768})
    expect(await pane.evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(false)
    await capture('plugin-conversation-media-compact')
    await page.evaluate(()=>document.body.setAttribute('data-ds-dark-theme',''))
    await capture('plugin-conversation-media-dark')
  } catch (error) {
    failures.push(error)
    if (page && process.env.ARKME_E2E_CAPTURE_DIR) await page.screenshot({ path: join(process.env.ARKME_E2E_CAPTURE_DIR, 'failure.png') }).catch(() => {})
  } finally {
    await browser?.close().catch(e => failures.push(e))
    if (scaffold) await scaffold.ctx.get('arkmeData').logout().catch(e => failures.push(e))
    await scaffold?.close().catch(e => failures.push(e))
    await new Promise(resolve => api.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
  if (failures.length) throw new AggregateError(failures, failures.map(String).join('\n'))
})
