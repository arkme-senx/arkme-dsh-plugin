// Immutable installed plugin + unmodified official Harness + isolated HTTPS owners.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const checkout = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!checkout || !profile) throw new Error('Use an isolated officially installed packed-plugin profile')
const { launchWebScaffold } = await import(/* @vite-ignore */ pathToFileURL(join(checkout, 'apps/web/tests/scaffold.ts')).href)

it('serves a complete recording day through HTTP before occupied background reads finish', async () => {
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  expect(manifest.dependencies['@senguoyun/dsh-arkme']).toMatch(/^file:.*\.tgz$/)
  const root = await mkdtemp(join(tmpdir(), 'recording priority acceptance '))
  const day = new Date(2026, 9, 12).getTime()
  const backgroundDays = [new Date(2026, 9, 10).getTime(), new Date(2026, 9, 11).getTime()]
  const jwt = [{ alg: 'HS256', typ: 'JWT' }, { user_id: 10001, client_id: 20001 }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.fixture'
  let release, scaffold, blockers = [], backgroundStarted = 0, backgroundCompleted = 0, profileReads = 0
  const gate = new Promise(resolve => { release = resolve })
  const upstream = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const input = body ? JSON.parse(body) : {}
    let data = { items: [], users: [], session_ls: [], has_more: false }
    if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: jwt, refresh_token: 'isolated-fixture' }
    if (req.url === '/api/v1/auth/get-user-info') data = { user_id: 10001, nick_name: '录音验收', phone: '13800000000', phone_binding_policy: { mode: 'none' } }
    if (req.url === '/api/v1/auth/get-public-users-by-ids') {
      if (input.user_ids.includes(7)) profileReads++
      data = { items: input.user_ids.map(user_id => ({ user_id, nick_name: user_id === 7 ? '说话人甲' : '录音验收' })) }
    }
    if (req.url === '/api/v1/audio/get-speaker-ls') data = { spk_ls: [{ speaker_id: 'speaker', ref_usr_id: 7, nick_name: '说话人甲' }] }
    if (req.url === '/api/v1/audio/one-day-trans') {
      if (backgroundDays.includes(input.start_at)) { backgroundStarted++; await gate; backgroundCompleted++; data = { session_ls: [], child_ls: [] } }
      else data = {
        session_ls: [{ id: 'session', user_id: 10001, belong_usr: 10001, start_at: input.start_at, duration: 3000, spk_ls: [{ num: 1, spk_id: 'speaker' }] }],
        child_ls: [{ id: 'child', session_id: 'session', start_at: 0, asr: [{ s: 1000, e: 2000, n: 1, t: '隔离验收录音内容' }] }],
      }
    }
    if (req.url === '/api/v1/summary/list-timeline-by-range') data = { audio_summary_ls: [{ id: 'version', kind: input.kind, status: 2, create_at: day,
      answer: input.kind === 1 ? '## 09:00 讨论方案\n隔离验收时间轴' : '隔离验收总结' }] }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 200, data }))
  })
  try {
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
    const origin = `https://127.0.0.1:${upstream.address().port}`
    const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.recording-priority-${randomUUID()}`,
      allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false,
      toolProfile: 'business', shareWebsite: origin }
    for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
    const overlay = join(root, 'overlay.json')
    await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-recording-priority', name: '@senguoyun/dsh-arkme', config }] }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')] })
    expect(await scaffold.ctx.get('arkmeData').testLogin(10001)).toMatchObject({ status: 'authenticated', userId: 10001 })
    const call = async (operation, params) => {
      const response = await scaffold.hostFetch('/arkme-self/api', { method: 'POST', headers: { 'content-type': 'application/json', Origin: scaffold.baseUrl }, body: JSON.stringify({ operation, params }) })
      expect(response.status).toBe(200)
      const payload = await response.json(); expect(payload.ok).toBe(true); return payload.value
    }
    blockers = backgroundDays.map(dateStamp => call('recordings.totals.bucket', { account: 'test:10001', dateStamp }))
    await expect.poll(() => backgroundStarted).toBe(2)
    const started = performance.now()
    const result = await call('recordings.day', { dateStamp: day })
    expect(backgroundCompleted).toBe(0)
    expect(result.transcript.items[0]).toMatchObject({ text: '隔离验收录音内容', speakerLabel: '说话人甲' })
    expect(result.summary.items[0].status).toBe('done')
    expect(result.timeline.items[0].status).toBe('done')
    expect(result.timeline.items[0].timelineEvents).toHaveLength(1)
    expect(profileReads).toBe(1)
    console.log(JSON.stringify({ acceptance: 'packed-recording-foreground-read', millis: Math.round(performance.now() - started), blockedBackgroundReads: backgroundStarted }))
  } finally {
    release(); await Promise.allSettled(blockers)
    await scaffold?.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)
