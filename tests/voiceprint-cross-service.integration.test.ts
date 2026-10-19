import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeSdk } from '../src/sdk/index.js'

const contractFile = process.env.JOTMO_VOICEPRINT_CONTRACT_FILE
const suite = contractFile ? describe : describe.skip

suite('voiceprint cross-service loopback contract', () => {
  it('runs SDK -> Host -> service -> real audio HTTP -> durable recovery -> signed WAV', async () => {
    const fixture = JSON.parse(await readFile(contractFile!, 'utf8')) as {
      api: string; objects: string; users: Record<string, number>; tokens: Record<string, string>
    }
    const config: ArkmeServiceConfig = {
      environment: 'test', authBaseUrl: fixture.api, subjectBaseUrl: fixture.api,
      recordBaseUrl: fixture.api, chatBaseUrl: fixture.api, botBaseUrl: fixture.api,
      imBaseUrl: fixture.api, webrtcBaseUrl: fixture.api, worldBaseUrl: fixture.api,
      relationBaseUrl: fixture.api, intelligentBaseUrl: fixture.api, audioBaseUrl: fixture.api,
      routePath: '/arkme-self/api', requestTimeoutMs: 5_000, maxTextLength: 20_000,
      geetestCaptchaId: 'contract-only', interwovenMomentsEnabled: true,
    }
    let account = 'caller'
    const requests: string[] = []
    const network: typeof fetch = async (input, init) => {
      const original = new URL(String(input))
      requests.push(original.pathname)
      // Only the test transport redirects the trusted, signed OSS host to its loopback peer.
      if (original.hostname === 'jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com') {
        return await fetch(fixture.objects + original.pathname + original.search, init)
      }
      if (original.origin !== fixture.api) throw new Error('external network forbidden by contract test')
      return await fetch(input, init)
    }
    const service = new ArkmeService(config, {
      read: async () => ({ userId: fixture.users[account]!, accessToken: fixture.tokens[account]!, refreshToken: 'contract-only' }),
      write: async () => {}, delete: async () => {},
    }, { uniqueCode: async () => 'cross-service-contract', revision: async () => 0 } as never, network)
    const host = createServer(async (req, res) => {
      try {
        let body = ''; for await (const chunk of req) body += chunk
        const request = JSON.parse(body)
        const value = await dispatchArkmeHostOperation(service, request.operation, request.params ?? {})
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, value }))
      } catch (error) {
        const failure = error as { code?: string; message: string }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: { code: failure.code, message: failure.message } }))
      }
    })
    await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve))
    const address = host.address() as { port: number }
    const sdk = createArkmeSdk({ route: '/arkme-self/api', fetchImpl: async (input, init) => await fetch(`http://127.0.0.1:${address.port}${String(input)}`, init) })
    try {
      const page = await service.listWorldFeed()
      const record = page.items.find(item => item.authorName === 'world')!
      expect(record).toBeDefined()
      const first = await sdk.generateWorldVoiceprintPlayback({ recordRef: record.recordRef, chunkIndex: 0 })
      expect(first.chunkCount).toBeGreaterThan(1)
      const media = await service.fetchMedia(first.mediaRef)
      const wav = new Uint8Array(await media.response.arrayBuffer())
      expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
      const afterFirst = await (await fetch(fixture.api + '/api/public/v1/contract/state')).json()
      expect(afterFirst.speakers.world.model).toBe('qwen-audio-3.0-tts-flash')
      expect(afterFirst.speakers.world.pending).toBe('')
      expect(afterFirst.speakers.world.creates).toBe(1)
      expect(requests.filter(path => path.endsWith('/generate-playback'))).toHaveLength(2)
      await sdk.generateWorldVoiceprintPlayback({ recordRef: record.recordRef, chunkIndex: 1 })
      const replay = await sdk.generateWorldVoiceprintPlayback({ recordRef: record.recordRef, chunkIndex: 0 })
      expect(replay.cacheHit).toBe(true)
      const final = await (await fetch(fixture.api + '/api/public/v1/contract/state')).json()
      expect(final.speakers.world.creates).toBe(1)

      for (const name of ['missing', 'rejected']) {
        const unavailable = page.items.find(item => item.authorName === name)!
        await expect(sdk.generateWorldVoiceprintPlayback({ recordRef: unavailable.recordRef })).rejects.toMatchObject({ body: { code: 'arkme-code-1103' } })
      }
      account = 'restore'
      const restore = await sdk.call<{ restored: boolean }>('voiceprint.restore')
      expect(restore.restored).toBe(true)
      expect(requests.filter(path => path.endsWith('/restore-playback'))).toHaveLength(1)
      expect(requests.some(path => path.endsWith('/voiceprint/my'))).toBe(true)
      const noToken = await fetch(fixture.api + '/api/v1/audio/voiceprint/my', { method: 'POST', body: '{}' })
      expect(noToken.status).toBe(403)
    } finally {
      service.dispose()
      await new Promise<void>((resolve, reject) => host.close(error => error ? reject(error) : resolve()))
    }
  }, 45_000)
})
