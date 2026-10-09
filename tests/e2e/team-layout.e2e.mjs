// Visual/interaction acceptance of the installed artifact on unmodified DSH.
// Owner responses and image bytes are synthetic. Avatar identity crosses the
// installed Host adapter, including per-refresh OSS signatures; no live backend.
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
  let teamOwnerFixture
  const api = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const path = new URL(req.url, 'https://localhost').pathname
    let data = { items: [], users: [], sources: [], has_more: false }
    if (path.endsWith('/the-best-api-for-testing')) {
      const token = [{ alg: 'none' }, { user_id: input.user_id, exp: Math.floor(Date.now() / 1000) + 3600 }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.fixture'
      data = { access_token: token, refresh_token: 'layout-fixture' }
    } else if (path.endsWith('/get-user-info')) data = { user_id: Number(JSON.parse(Buffer.from(String(req.headers.authorization).split('.')[1], 'base64url')).user_id), nick_name: '布局验收', jotmo_id: 'layout_test', phone: '13800000000' }
    else if (path === '/api/v1/records/detail') data = { record_core: { record_uid: 'personal-team-search', owner_user_id: 99001001, creator_user_id: 99001001,
      origin_kind: 5, source_kind: 4, status: 1, content_access_state: 1, version: 1, template_kind: 1,
      text_content: '搜索打开的完整团队快记正文', send_at: Date.now(), content_payload: {} } }
    else if (path.startsWith('/api/v1/team/') && teamOwnerFixture) data = teamOwnerFixture(path, input)
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: path.startsWith('/api/v1/records/') ? 0 : 200, data }))
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
    page.on('pageerror', error => failures.push(error))
    let owner = true, enabled = true
    let sendTasks = []
    let holdTextDelivery = false, failNextTimeline = false, accountBoundaryFixture = false
    const sendRetries = []
    const teamRef = 'team-app-team.fixture', publicRef = 'b'.repeat(32)
    const channel = () => ({ teamRef, name: 'Arkme Internal Interview', jotmoId: 'arkme_cn', publicRef, link: `https://example.com/team-message?channel=${publicRef}`, enabled, revision: 3, canManage: owner })
    const conversation = () => ({ref: 'conversation-ref', key: 'conversation-key', channel: channel(), side: 'team', visitor: {nickname:'鲨鱼辣椒1998'}, preview:{status:'available',text:'请问可以修改吗？',hasMedia:false}, lastSeq: 3, latestTeamReplySeq: 2, myReadSeq: 3, unread: 0, needsReply: false, blocked: false, revision: 1, updatedAt: Date.now()})
    const secondConversation = () => ({...conversation(), ref:'second-ref', key:'second-key', visitor:{nickname:'第二位来访者'}, preview:{status:'available',text:'我想了解一下团队功能',hasMedia:false}})
    const messages = [
      {key:'own-text',ref:'own-text',seq:1,side:'external',own:true,sender:{nickname:'布局验收'},content:{text_content:'你好，我想反馈一个使用问题。',template_kind:1},media:[]},
      {key:'reply',ref:'reply',seq:2,side:'team',own:false,sender:{nickname:'Loki1999'},content:{text_content:'你好，请发一张截图，我们一起确认。',template_kind:1},media:[]},
      {key:'image-only',ref:'image-only',seq:3,side:'external',own:true,sender:{nickname:'布局验收'},content:{text_content:'',template_kind:2},media:[{ref:'team-image',key:'team-asset',url:'/arkme-self/test-team-media/image',name:'界面截图.png',mimeType:'image/png',size:4096}]},
    ].map((m,i)=>({...m,revision:1,state:'published',createdAt:Date.now()-120000+i*30000,canEdit:m.own,canDelete:m.own,recipientRead:false,version:1,contentStatus:'available'}))
    let grantRevision = 0
    const rawChannel = { team_id: 42, name: 'Arkme Internal Interview', jotmo_id: 'arkme_cn', public_ref: publicRef, enabled: true }
    const rawConversation = { conversation_uid: 'signed-avatar-fixture', channel: rawChannel, side: 'team' }
    let signatureRevision = 0
    let voicePreviewText
    teamOwnerFixture = (path, input) => {
      if (path.endsWith('/conversations/list') && voicePreviewText !== undefined) return {
        items: [{ ...rawConversation, side: input.side, visitor: { nickname: '语音来访者' },
          preview: { status: 'available', text: voicePreviewText, has_media: true, template_kind: 3 } }], has_more: false,
      }
      if (path.endsWith('/conversations/context')) return { conversation_uid: 'signed-avatar-fixture', side:'team', team_name: rawChannel.name }
      if (path.endsWith('/conversations/open')) return { channel: rawChannel, conversation: rawConversation }
      if (path.endsWith('/timeline/page')) {
        const signature = ++signatureRevision
        return { conversation: rawConversation, messages: messages.map(m => ({
          message_uid: m.key, seq: m.seq, side: m.side, own: m.own, state: 'published',
          sender: { nickname: m.sender.nickname, avatar_url: `https://jotmo-userfiles.senguo.me/avatars/${encodeURIComponent(m.sender.nickname)}.png?x-oss-signature=signature-${signature}&x-oss-date=20260924T${String(signature).padStart(6,'0')}Z&x-oss-expires=120&x-oss-process=image%2Fresize%2Cw_80` },
        })) }
      }
      return {}
    }
    const hostOwner = scaffold.ctx.get('arkmeData')
    const avatarConversation = (await hostOwner.executeTeamApp('team.app.open', {publicRef})).conversation
    const mediaRequests=[]
    const fixtureImage=await readFile(new URL('../../assets/branding/jiwo-about-icon.png',import.meta.url))
    // Serve bytes normally: browser-wide interception can suspend about:blank popup requests.
    scaffold.ctx.get('webServer').register({kind:'exact',path:'/arkme-self/test-team-media/image',handler:(req,res)=>{mediaRequests.push(req.url);res.writeHead(200,{'Content-Type':'image/png'});res.end(fixtureImage)}})
    const mockTeamAPI = async route => {
      const { operation: op, params = {} } = route.request().postDataJSON()
      calls.push(op)
      if (accountBoundaryFixture && op.startsWith('team.app.')) { await route.continue(); return }
      if (op === 'team.app.timeline' && failNextTimeline) { failNextTimeline=false; await route.abort('connectionfailed'); return }
      let value
      if (op === 'search.records') value = {items:[{recordUid:'personal-team-search',sourceKind:4,sourceUid:'team-source',routeTargetKind:'record_detail',routeTargetUid:'personal-team-search',sourceTitle:'团队对话',title:'搜索团队快记',textContent:'检索摘要 [im_emoji:yummy_face] [jm_emoji:thumb_up]',snippet:'检索摘要 [im_emoji:yummy_face] [jm_emoji:thumb_up]',sendAtMillis:Date.now(),media:[],files:[]}],sourceAggregates:[],hasMore:false,queryGuard:{state:'ok'}}
      else if (op === 'reactions' && params.action === 'history') value = {items:[],has_more:false}
      else if (op === 'calendar.buckets' || op === 'recordings.calendar') value = {days:[]}
      else if (op === 'calendar.activity') value = {data:{items:params.mode !== 'details' ? [] : params.source === 'record'
        ? [{record_core:{record_uid:'calendar-emoji',title:'日历中的表情',text_content:'文字 [im_emoji:yummy_face] [jm_emoji:thumb_up] 😊 [im_emoji:unknown]'},occurred_at:Date.now()}]
        : params.source === 'chat' ? [{entry_id:'calendar-chat',occurred_at:Date.now(),source_kind:'group_chat',relation_flags:['sent'],source_ref:{chat_session_uid:'fixture-chat'},text:'会话摘要 [im_emoji:yummy_face] [jm_emoji:thumb_up]'}] : [],has_more:false}}
      else if (op === 'team.app.source') value = await hostOwner.executeTeamApp(op, params)
      else if (op === 'team.app.channel' || op === 'team.app.official') value = {...channel(), teamRef:`refreshed-channel-${randomUUID()}`}
      else if (op === 'team.app.channel.configure') { enabled = params.enabled; value = channel() }
      else if (op === 'team.app.members') value = { team: { teamRef, name: channel().name, jotmoId: channel().jotmoId, currentUserRole: owner ? 'owner' : 'member', createdAtMillis: 1, updatedAtMillis: 1 }, items: ['Loki1999', 'Jotmoer', '设计讨论小组', '510'].map((name, i) => ({ key: `member-${i}`, userRef: `team-app-member.${i}`, displayName: name, jotmoId: `member_${i}`, identityState: 'ready', role: i === 0 ? 'owner' : 'member', joinedAtMillis: 1, canRemove: owner && i > 0 })), totalCount: 4, hasMore: false }
      else if (op === 'team.app.directory') value = { section: 'teams', items: params.countOnly ? [] : [{ kind: 'team', teamRef, displayName: channel().name, publicId: 'arkme_cn', role: owner ? 'owner' : 'member' }], total: 1, hasMore: false }
      else if (op === 'directory.list') value = { section: params.section, items: [], total: 0, hasMore: false }
      else if(op === 'team.app.open') value={channel:channel(),conversation:conversation()}
      else if(op === 'team.app.timeline') {
        const revision=++grantRevision
        const avatarPage = await hostOwner.executeTeamApp('team.app.timeline', {conversationRef:avatarConversation.ref})
        value={conversation:params.conversationRef === 'second-ref' ? secondConversation() : conversation(),messages:params.conversationRef === 'second-ref' ? [] : messages.map((m,i)=>({...m,ref:`${m.key}-grant-${revision}`,
          sender:avatarPage.messages[i].sender,
          media:m.media.map(f=>({...f,key:`asset-${m.key}`,ref:`media-grant-${revision}`,url:`/arkme-self/test-team-media/image?grant=${revision}`}))})),hasMore:false,beforeSeq:0}
      }
      else if(op === 'team.app.image') {
        // Make a wrong reload observable, including frames before the next bytes arrive.
        await new Promise(resolve=>setTimeout(resolve,150))
        value={base64:fixtureImage.toString('base64'),mimeType:'image/png'}
      }
      else if(op === 'team.app.send.tasks') value=sendTasks
      else if(op === 'team.app.send.retry-task') {
        sendRetries.push(params)
        const task=sendTasks.find(task=>task.taskRef===params.taskRef)
        const m={...messages[0],key:task.clientUid,ref:task.clientUid,seq:messages.length+1,content:task.content,createdAt:task.createdAtMillis}
        messages.push(m);value={...task,state:'sent',message:m};sendTasks=[value]
      }
      else if(op === 'team.app.send.enqueue') {
        const m={...messages[0],key:`sent-${messages.length}`,ref:`sent-${messages.length}`,seq:messages.length+1,content:params.content,createdAt:Date.now()}
        value={...params,taskRef:`task-${params.clientUid}`,conversationKey:conversation().key,createdAtMillis:Date.now(),state:holdTextDelivery?'sending':'sent',files:params.fileRefs.map(fileRef=>({fileRef,fileName:'pending-photo.png',mimeType:'image/png',fileKind:1,size:fixtureImage.length})),fileRefs:params.fileRefs,attempts:0,nextAttemptAt:0}
        if(holdTextDelivery)sendTasks=[value]
        else {messages.push(m);value.message=m}
      }
      else if(op === 'team.app.receipts') value={teamRead:true,visitorRead:true,hasMore:false,members:[
        {nickname:'Loki1999',read:true,readAt:Date.now(),imageKey:'receipt-avatar',imageRef:'receipt-avatar'},
        {nickname:'设计同事',read:false,readAt:0},{nickname:'研发同事',read:false,readAt:0}]}
      else if(op === 'team.app.read') value={}
      else if(op === 'team.app.create.check') value={available:params.jotmoId !== 'already_taken',reason:params.jotmoId === 'already_taken' ? 'taken' : ''}
      else if (op === 'team.app.conversations' && voicePreviewText !== undefined) value = await hostOwner.executeTeamApp(op, params)
      else if (op === 'team.app.conversations') value = { items: params.side === 'team'
        ? [conversation(), secondConversation()]
        : [{...conversation(),key:'contacted-team',side:'external',channel:{...channel(),name:'设计团队',jotmoId:'design_team'}}], hasMore:false }
      else if (op === 'team.app.applications') value = { items: [], hasMore: false }
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
    expect(await detail.getByText('加入申请',{exact:true}).count()).toBe(0)
    expect(await detail.getByText('正在接收消息',{exact:true}).count()).toBe(0)
    expect(await detail.getByRole('listitem').count()).toBe(4)
    const geometry = await detail.evaluate(node => {
      const header = node.querySelector('.arkme-team-detail-header').getBoundingClientRect()
      const members = node.querySelector('.arkme-team-members').getBoundingClientRect()
      const settings = node.querySelector('.team-settings').getBoundingClientRect()
      return { memberGap: members.top - node.querySelector('.arkme-team-features').getBoundingClientRect().bottom, settingsTop: settings.top, membersBottom: members.bottom, overflow: getComputedStyle(node).overflowY }
    })
    expect(geometry.memberGap).toBeLessThan(40)
    expect(geometry.settingsTop).toBeGreaterThanOrEqual(geometry.membersBottom - 1)
    expect(geometry.overflow).toBe('auto')
    const output = process.env.ARKME_E2E_CAPTURE_DIR
    const capture = async (name, animations = 'disabled') => {
      if (output) {
        await mkdir(output, { recursive: true })
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await page.screenshot({ path: join(output, `${name}.png`), animations })
      }
    }
    expect(await detail.getByRole('button', { name: '刷新消息设置', exact: true }).count()).toBe(0)
    const links = detail.locator('.team-channel-card')
    await links.getByRole('heading', { name: '接收外部消息', exact: true }).waitFor()
    expect(await links.getByRole('textbox', { name: '团队消息分享链接' }).inputValue()).toBe(channel().link)
    expect(await links.getByText('消息链接',{exact:true}).count()).toBe(0)
    await links.getByText('外部用户可通过链接发消息',{exact:true}).waitFor()
    const copyBox = await links.getByRole('button',{name:'复制链接',exact:true}).boundingBox()
    const resetBox = await links.getByRole('button',{name:'重置链接',exact:true}).boundingBox()
    expect(resetBox.x).toBeGreaterThan(copyBox.x + copyBox.width)
    expect(Math.abs(resetBox.y + resetBox.height/2 - copyBox.y - copyBox.height/2)).toBeLessThan(2)
    expect(await links.getByRole('button',{name:'重置链接',exact:true}).textContent()).toBe('')
    await links.getByRole('button', { name: '重置链接', exact: true }).click()
    await detail.getByRole('alert').getByText('重置后旧链接失效，已存在的会话继续保留。确认重置？', { exact: true }).waitFor()
    await detail.getByRole('button', { name: '取消', exact: true }).click()
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
      await dialog.waitFor()
      if (label === '创建团队') {
        await dialog.getByRole('textbox', {name:'团队名称',exact:true}).fill('测试团队')
        await dialog.getByRole('textbox', {name:'团队即我号',exact:true}).fill('你好')
        await dialog.getByText('仅支持字母、数字和下划线',{exact:true}).waitFor()
        expect(await dialog.getByRole('button',{name:'创建团队',exact:true}).isDisabled()).toBe(true)
        await capture('plugin-team-create-validation')
        await dialog.getByRole('textbox', {name:'团队即我号',exact:true}).fill('already_taken')
        await dialog.getByText('该即我号已被占用',{exact:true}).waitFor()
        expect(await dialog.getByRole('button',{name:'创建团队',exact:true}).isDisabled()).toBe(true)
        await dialog.getByRole('textbox', {name:'团队即我号',exact:true}).fill('available_team')
        await expect.poll(()=>dialog.getByRole('button',{name:'创建团队',exact:true}).isEnabled()).toBe(true)
        expect(calls).not.toContain('team.app.create')
      }
      await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    }
    await detail.getByRole('button', { name: '复制链接', exact: true }).click()
    await page.getByText('链接已复制', { exact: true }).waitFor()
    await expect.poll(()=>page.getByRole('alert').filter({hasText:'链接已复制'}).evaluate(node=>getComputedStyle(node).opacity)).toBe('1')
    await capture('plugin-team-link-toast', 'allow')
    await page.getByText('链接已复制', { exact: true }).waitFor({state:'hidden'})
    expect(await detail.locator('.team-settings-notice').count()).toBe(0)
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
    await detail.getByRole('button',{name:'查看团队对话',exact:true}).click()
    const teamDirectory = page.locator('.team-conversation-directory')
    await teamDirectory.getByRole('button',{name:/第二位来访者/}).waitFor()
    await capture('plugin-team-conversation-list')
    await page.setViewportSize({width:640,height:800})
    await teamDirectory.getByRole('button',{name:/第二位来访者/}).waitFor({state:'visible'})
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    const rowBounds = await teamDirectory.getByRole('button',{name:/第二位来访者/}).boundingBox()
    expect(rowBounds.x + rowBounds.width).toBeLessThanOrEqual(640)
    const narrowName = await page.getByRole('treeitem').filter({hasText:'第二位来访者'}).getByText('第二位来访者',{exact:true}).boundingBox()
    expect(narrowName.width).toBeGreaterThan(20)
    await capture('plugin-team-conversation-list-compact')
    await page.setViewportSize({width:1440,height:1000})
    failNextTimeline = true
    await teamDirectory.getByRole('button',{name:/鲨鱼辣椒1998/}).click()
    const replyPane = page.locator('.team-conversation-pane')
    await replyPane.getByRole('alert').getByText('无法连接本机插件，请确认插件正在运行后重试').waitFor()
    await replyPane.getByRole('textbox',{name:'团队消息内容'}).fill('给第一位来访者的草稿')
    await replyPane.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click()
    await replyPane.getByRole('alert').waitFor({state:'hidden'})
    expect(await replyPane.getByRole('textbox',{name:'团队消息内容'}).textContent()).toBe('给第一位来访者的草稿')
    await replyPane.getByRole('button',{name:'添加内容',exact:true}).click()
    await page.getByRole('menuitem',{name:'添加附件',exact:true}).waitFor()
    await page.keyboard.press('Escape')
    await replyPane.getByRole('button',{name:'选择表情',exact:true}).waitFor()
    await replyPane.getByRole('separator',{name:'调整输入框高度',exact:true}).waitFor()
    expect(await replyPane.getByRole('button',{name:'对话选项',exact:true}).count()).toBe(0)
    await capture('plugin-team-conversation-back')
    await replyPane.getByRole('button',{name:'返回团队对话',exact:true}).click()
    await teamDirectory.getByRole('button',{name:/第二位来访者/}).click()
    await expect.poll(()=>replyPane.getByRole('textbox',{name:'团队消息内容'}).textContent()).toBe('')
    await replyPane.getByRole('button',{name:'返回团队对话',exact:true}).click()
    await teamDirectory.getByRole('button',{name:/鲨鱼辣椒1998/}).click()
    await expect.poll(()=>replyPane.getByRole('textbox',{name:'团队消息内容'}).textContent()).toBe('给第一位来访者的草稿')
    await replyPane.getByRole('textbox',{name:'团队消息内容'}).fill('')
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
    expect(calls).not.toContain('team.app.home.visibility')
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
    await expect.poll(()=>pane.locator('[data-arkme-avatar] img').count()).toBe(3)
    const avatars = await pane.locator('[data-arkme-avatar] img').elementHandles()
    await expect.poll(()=>pane.locator('[data-arkme-avatar] img').evaluateAll(nodes=>nodes.every(node=>node.complete && node.naturalWidth>0))).toBe(true)
    const avatarRequests = calls.filter(op=>op==='team.app.image').length
    await pane.evaluate(node=>{
      const images=[...node.querySelectorAll('[data-arkme-avatar] img')]
      const sources=images.map(image=>image.src)
      const check=()=>{window.teamFlashCheck.samples++; if(images.some((image,i)=>!image.isConnected || image.src!==sources[i] || !image.complete || !image.naturalWidth)) window.teamFlashCheck.flashes++}
      window.teamFlashCheck={samples:0,flashes:0,frame:0,observer:new MutationObserver(check)}
      window.teamFlashCheck.observer.observe(node,{childList:true,subtree:true,attributes:true,attributeFilter:['src']})
      const frame=()=>{check();window.teamFlashCheck.frame=requestAnimationFrame(frame)};frame()
    })
    const nextTimeline = () => page.waitForResponse(response => response.url().endsWith('/arkme-self/api') && response.request().postDataJSON()?.operation === 'team.app.timeline')
    const focusRefresh = nextTimeline()
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await focusRefresh
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    expect(await retainedText.evaluate(node=>node.isConnected)).toBe(true)
    expect(calls.filter(op=>op==='team.app.image').length).toBe(avatarRequests)
    const sentRefresh = nextTimeline()
    await pane.getByRole('button',{name:'发送',exact:true}).click()
    await pane.getByText('发送后，已有图片保持原位',{exact:true}).waitFor()
    await expect.poll(()=>input.textContent()).toBe('')
    await sentRefresh
    await expect.poll(()=>pane.locator('[data-arkme-avatar] img').count()).toBe(4)
    for (let i=0;i<3;i++) {
      const refreshed = nextTimeline()
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
      await refreshed
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    }
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    expect(await retainedImage.evaluate(node=>node.isConnected && node === document.querySelector('[data-team-message-key="image-only"] img[alt="界面截图.png"]'))).toBe(true)
    for (const avatar of avatars) expect(await avatar.evaluate(node=>node.isConnected && node.complete && node.naturalWidth>0)).toBe(true)
    const flashCheck=await page.evaluate(()=>{
      const {samples,flashes,frame,observer}=window.teamFlashCheck
      cancelAnimationFrame(frame);observer.disconnect();delete window.teamFlashCheck
      return {samples,flashes}
    })
    expect(flashCheck.samples).toBeGreaterThan(2)
    expect(flashCheck.flashes).toBe(0)
    expect(calls.filter(op=>op==='team.app.image').length).toBe(avatarRequests)
    if(output) await writeFile(join(output,'avatar-refresh-evidence.json'),JSON.stringify({signatureRevision,avatarRequests,afterSend:calls.filter(op=>op==='team.app.image').length,...flashCheck},null,2))
    await expect.poll(() => page.locator('[data-team-side="team"]').getByText('Arkme Internal Interview · 外部用户',{exact:true}).count()).toBe(2)
    await page.locator('[data-team-side="external"]').getByText('设计团队',{exact:true}).last().waitFor()
    await page.locator('[data-team-side="team"]').getByText('鲨鱼辣椒1998', { exact: true }).waitFor()
    await page.locator('[data-team-side="external"]').getByText('设计团队', { exact: true }).first().waitFor()
    const memberRow = page.locator('[data-team-side="team"]').filter({hasText:'鲨鱼辣椒1998'})
    expect(await memberRow.locator('[data-arkme-conversation-content] > span').nth(1).textContent()).toBe('请问可以修改吗？')
    const contextBox = await memberRow.getByText('Arkme Internal Interview · 外部用户', {exact:true}).boundingBox()
    expect(contextBox.width).toBeGreaterThan(20)
    await capture('plugin-team-conversation-roles')
    expect(mediaRequests.length).toBe(readsBefore)
    expect(await pane.getByText('正在读取…',{exact:true}).count()).toBe(0)
    expect((await pane.locator('header').first().boundingBox()).y).toBe(headerBefore.y)
    // A delayed ACK leaves the message visible and the next composer usable,
    // without a separate first-attempt status/cancellation strip.
    holdTextDelivery=true
    await input.fill('等待回执的独立消息')
    await pane.getByRole('button',{name:'发送',exact:true}).click()
    await pane.getByText('等待回执的独立消息',{exact:true}).waitFor()
    await expect.poll(()=>input.textContent()).toBe('')
    expect(await pane.getByRole('status',{name:'发送状态',exact:true}).count()).toBe(0)
    expect(await pane.getByRole('button',{name:'取消发送',exact:true}).count()).toBe(0)
    await input.fill('继续输入下一条')
    expect(await pane.getByRole('button',{name:'发送',exact:true}).isEnabled()).toBe(true)
    await capture('plugin-pending-text-composer')
    holdTextDelivery=false
    const pending=sendTasks[0],ack={...messages[0],key:'pending-ack',ref:'pending-ack',seq:messages.length+1,content:pending.content,createdAt:pending.createdAtMillis}
    messages.push(ack);sendTasks=[{...pending,state:'sent',message:ack}]
    await page.evaluate(()=>window.dispatchEvent(new Event('online')))
    await expect.poll(()=>pane.locator('[data-team-message-key="pending-ack"]').count()).toBe(1)
    expect(await input.textContent()).toBe('继续输入下一条')
    await input.fill('')
    // Stage a real local picture through the installed SDK, then hold admission
    // in every active phase. The image and next draft survive without a footer.
    holdTextDelivery=true
    await input.focus()
    await input.evaluate((node, bytes) => {
      const clipboard = new DataTransfer()
      clipboard.items.add(new File([new Uint8Array(bytes)],'pending-photo.png',{type:'image/png'}))
      node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}))
    }, [...fixtureImage])
    try {
      await expect.poll(()=>pane.getByRole('button',{name:'发送',exact:true}).isEnabled()).toBe(true)
    } catch(error) {
      await capture('plugin-image-staging-failure')
      console.error('Image staging UI:',await pane.innerText())
      throw error
    }
    await expect.poll(()=>input.evaluate(node=>document.activeElement === node)).toBe(true)
    await page.keyboard.press('Enter')
    await expect.poll(()=>sendTasks[0]?.files[0]?.fileName).toBe('pending-photo.png')
    const imageTask=sendTasks[0]
    const pendingImage=pane.locator(`[data-team-message-key="${imageTask.clientUid}"]`)
    await pendingImage.locator('img[alt="pending-photo.png"]').waitFor()
    await expect.poll(()=>pendingImage.locator('img[alt="pending-photo.png"]').evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true)
    await input.fill('图片发送时继续输入')
    for (const state of ['queued','uploading','sending']) {
      sendTasks=[{...imageTask,state}]
      const statusRefresh=page.waitForResponse(res=>res.url().endsWith('/arkme-self/api') && res.request().postDataJSON()?.operation==='team.app.send.tasks')
      await page.evaluate(()=>window.dispatchEvent(new Event('online')))
      await statusRefresh
      expect(await pane.getByRole('status',{name:'发送状态',exact:true}).count()).toBe(0)
      expect(await input.textContent()).toBe('图片发送时继续输入')
    }
    await capture('plugin-pending-image-composer')
    const imageAck={...messages[2],key:imageTask.clientUid,ref:imageTask.clientUid,seq:messages.length+1,createdAt:imageTask.createdAtMillis}
    messages.push(imageAck);sendTasks=[{...imageTask,state:'sent',message:imageAck}];holdTextDelivery=false
    await page.evaluate(()=>window.dispatchEvent(new Event('online')))
    await pendingImage.getByLabel('消息操作',{exact:true}).waitFor()
    await input.fill('')
    // Draft pictures use the ordinary attachment gallery before they are sent.
    await pane.locator('input[type=file]').setInputFiles({name:'draft-preview.png',mimeType:'image/png',buffer:fixtureImage})
    const draftPicture=pane.getByRole('button',{name:'预览 draft-preview.png',exact:true})
    await expect.poll(()=>draftPicture.isEnabled()).toBe(true)
    await draftPicture.click()
    await expect.poll(()=>page.locator('[data-arkme-image-preview-viewport] img').evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true)
    await capture('plugin-draft-picture-preview')
    await page.getByRole('button',{name:'关闭预览',exact:true}).click()
    await pane.getByRole('button',{name:'移除draft-preview.png',exact:true}).click()
    expect(await draftPicture.count()).toBe(0)
    // Legacy reply-cursor state uses the ordinary delivery status, never a confirmation.
    sendTasks=[{conversationRef:conversation().ref,clientUid:'legacy-reply',taskRef:'legacy-task',conversationKey:conversation().key,
      content:{text_content:'历史待发消息',template_kind:1},expectedReplySeq:0,fileRefs:[],files:[],createdAtMillis:Date.now(),
      state:'retrying',reason:'reply_conflict',attempts:1,nextAttemptAt:0}]
    await page.evaluate(()=>window.dispatchEvent(new Event('online')))
    await pane.getByText('历史待发消息',{exact:true}).waitFor()
    expect(await pane.getByText(/其他成员.*回复|仍要发送|仍然发送/).count()).toBe(0)
    expect(await pane.getByRole('textbox',{name:'团队消息内容'}).isEditable()).toBe(true)
    await capture('plugin-legacy-reply-recovery')
    expect(await pane.getByRole('button',{name:'重试',exact:true}).count()).toBe(0)
    expect(await pane.getByRole('button',{name:'取消发送',exact:true}).count()).toBe(0)
    await pane.getByRole('status',{name:'发送状态',exact:true}).getByText('等待发送',{exact:true}).waitFor()
    const legacy=sendTasks[0],legacyAck={...messages[0],key:legacy.clientUid,ref:legacy.clientUid,seq:messages.length+1,content:legacy.content,createdAt:legacy.createdAtMillis}
    messages.push(legacyAck);sendTasks=[{...legacy,state:'sent',message:legacyAck}]
    await page.evaluate(()=>window.dispatchEvent(new Event('online')))
    await pane.getByRole('status',{name:'发送状态',exact:true}).waitFor({state:'hidden'})
    expect(sendRetries).toEqual([])
    expect(calls).not.toContain('team.app.send.confirm')
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

    expect(await pane.getByRole('button',{name:'对话选项',exact:true}).count()).toBe(0)
    expect(await page.getByRole('menuitem',{name:/快记不显示在首页|刷新|关于此对话/}).count()).toBe(0)
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
    await page.unrouteAll({behavior:'wait'})
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
    // Exercise the same idle/focused surface tokens as ordinary conversations;
    // a screenshot alone previously missed white-on-white Team draft text.
    for (const focused of [false, true]) {
      if (focused) await input.focus()
      else await pane.locator('header').first().click()
      const colors = await pane.evaluate((node, focused) => {
        const surface = node.querySelector('[data-team-composer] > div:last-child')
        const probe = document.createElement('div')
        probe.style.background = focused ? 'var(--dsw-specific-input-major)' : 'var(--dsw-alias-bg-base)'
        document.body.append(probe)
        const expected = getComputedStyle(probe).backgroundColor
        probe.remove()
        return { actual: getComputedStyle(surface).backgroundColor, expected }
      }, focused)
      await expect.poll(() => pane.locator('[data-team-composer] > div:last-child')
        .evaluate(node => getComputedStyle(node).backgroundColor)).toBe(colors.expected)
    }
    await capture('plugin-conversation-media-dark')
    await page.evaluate(()=>document.body.removeAttribute('data-ds-dark-theme'))
    await page.setViewportSize({width:1440,height:1000})
    await page.getByRole('button',{name:'搜索对话或消息',exact:true}).click()
    await page.getByRole('textbox',{name:'搜索',exact:true}).fill('团队来源')
    const searchRow = page.getByRole('button').filter({has:page.getByText('搜索团队快记',{exact:true})})
    await searchRow.locator('img[data-arkme-rich-emoji="yummy_face"]').waitFor()
    await searchRow.locator('img[data-arkme-rich-emoji="thumb_up"]').waitFor()
    expect(await searchRow.textContent()).not.toContain('_emoji:')
    await capture('plugin-search-emoji-preview')
    await page.getByText('搜索团队快记',{exact:true}).click()
    await page.locator('[data-arkme-note-detail]').getByText('搜索打开的完整团队快记正文',{exact:true}).waitFor()
    expect(calls).toContain('record.app.detail')
    const teamSource = page.locator('[data-arkme-note-detail]').getByRole('button', {name:'来源：Arkme Internal Interview',exact:true})
    await teamSource.waitFor()
    await capture('plugin-team-search-personal-detail')
    await teamSource.click()
    await page.locator('[data-arkme-note-detail]').waitFor({ state: 'detached' })
    await page.locator('[data-team-composer]').waitFor()
    await capture('plugin-team-source-navigation')
    await page.getByRole('button',{name:'日历',exact:true}).click()
    const day = page.getByRole('region',{name:'我的一天',exact:true})
    await day.locator('[data-activity-id="note:calendar-emoji"] img[data-arkme-rich-emoji="yummy_face"]').waitFor()
    await expect.poll(()=>day.locator('img[data-arkme-rich-emoji]').count()).toBe(4)
    await capture('plugin-calendar-emoji-previews')
    await day.locator('[data-activity-id="note:calendar-emoji"] .arkme-day-entry-content').click()
    const dayDetail = day.locator('.arkme-day-detail')
    await dayDetail.locator('img[data-arkme-rich-emoji="thumb_up"]').waitFor()
    expect(await dayDetail.textContent()).not.toContain('[im_emoji:yummy_face]')
    expect(await dayDetail.textContent()).toContain('[im_emoji:unknown]')
    await capture('plugin-calendar-emoji-detail')
    await day.getByRole('button',{name:'关闭我的一天',exact:true}).click()
    // Exercise raw wire preview -> installed Host adapter -> both directory sides.
    // Do not fabricate a client DTO that would hide a dropped template_kind.
    voicePreviewText = ''
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const directory = page.locator('[data-arkme-retained-directory="conversations"]')
    for (const side of ['team', 'external']) {
      await directory.locator(`[data-team-side="${side}"]`).getByText('[语音]', { exact: true }).waitFor()
    }
    await capture('plugin-voice-preview-before-transcription')
    voicePreviewText = '完成转写后的原文'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    for (const side of ['team', 'external']) {
      await directory.locator(`[data-team-side="${side}"]`).getByText(voicePreviewText, { exact: true }).waitFor()
    }
    expect(await directory.getByText('[附件]', { exact: true }).count()).toBe(0)
    voicePreviewText = '[im_emoji:yummy_face] [jm_emoji:thumb_up]'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    for (const side of ['team', 'external']) {
      const row=directory.locator(`[data-team-side="${side}"]`)
      await row.locator('img[data-arkme-rich-emoji="yummy_face"]').waitFor()
      await row.locator('img[data-arkme-rich-emoji="thumb_up"]').waitFor()
      expect(await row.textContent()).not.toContain('_emoji:')
      const emoji=row.locator('img[data-arkme-rich-emoji="yummy_face"]')
      await expect.poll(()=>emoji.evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true)
      expect((await emoji.boundingBox()).width).toBe(20)
    }
    await capture('plugin-team-emoji-directory-preview')
    voicePreviewText = undefined
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('treeitem',{name:'联系作者',exact:true}).waitFor()
    // A different browser changes this same Host's account. The retained page
    // must not use its old visible identity to read the new account's Team data.
    await page.unrouteAll({behavior:'wait'})
    accountBoundaryFixture = true
    await page.route('**/arkme-self/api', mockTeamAPI)
    const boundaryReads = []
    const externalConversation = {...rawConversation,side:'external'}
    teamOwnerFixture = (path,input) => {
      boundaryReads.push(path)
      if (path.endsWith('/official-feedback-target')) return rawChannel
      if (path.endsWith('/conversations/open')) return {channel:rawChannel,conversation:externalConversation,open_inbox:false}
      if (path.endsWith('/conversations/list')) return {items:input.side==='team'?[]:[externalConversation],has_more:false}
      if (path.endsWith('/timeline/page')) return {conversation:externalConversation,messages:[],has_more:false}
      return {}
    }
    const rejectedAccounts = []
    page.on('response',async response=>{
      if (!response.url().endsWith('/arkme-self/api')) return
      const body=await response.json().catch(()=>({}))
      if(body.error?.code==='team-account-changed') rejectedAccounts.push(body.error.code)
    })
    expect(await hostOwner.testLogin(99001002)).toMatchObject({status:'authenticated',userId:99001002})
    await page.getByRole('treeitem',{name:'联系作者',exact:true}).click()
    await expect.poll(()=>rejectedAccounts.length).toBeGreaterThan(0)
    await expect.poll(()=>page.locator('[data-team-side="team"]').count()).toBe(0)
    await page.getByRole('treeitem',{name:'联系作者',exact:true}).click()
    await pane.locator('header').getByText(rawChannel.name,{exact:true}).waitFor()
    expect(await page.locator('.team-conversation-directory').count()).toBe(0)
    expect(await pane.getByRole('button',{name:'返回团队对话',exact:true}).count()).toBe(0)
    expect(boundaryReads.some(path=>path.endsWith('/conversations/open'))).toBe(true)
    await capture('plugin-external-account-after-switch')

  } catch (error) {
    failures.push(error)
    if (page && process.env.ARKME_E2E_CAPTURE_DIR) await page.screenshot({ path: join(process.env.ARKME_E2E_CAPTURE_DIR, 'failure.png') }).catch(() => {})
  } finally {
    await page?.unrouteAll({behavior:'wait'}).catch(e => failures.push(e))
    await browser?.close().catch(e => failures.push(e))
    if (scaffold) await scaffold.ctx.get('arkmeData').logout().catch(e => failures.push(e))
    await scaffold?.close().catch(e => failures.push(e))
    await new Promise(resolve => api.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
  if (failures.length) throw new AggregateError(failures, failures.map(String).join('\n'))
})
