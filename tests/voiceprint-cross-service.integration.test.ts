import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import { createArkmeHostApi } from '../src/host-api.js'
import { createArkmeMediaHandler } from '../src/rich-media-routes.js'

const contractFile = process.env.JOTMO_VOICEPRINT_CONTRACT_FILE
const suite = contractFile ? describe : describe.skip

suite('voiceprint cross-service loopback contract', () => {
  it('runs a world speaker click -> Client/SDK -> real Host/media routes -> audio HTTP -> durable recovery -> WAV playback', async () => {
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
    const generationCodes: number[] = []
    const realFetch = globalThis.fetch.bind(globalThis)
    const network: typeof fetch = async (input, init) => {
      const original = new URL(String(input))
      requests.push(original.pathname)
      // Only the test transport redirects the trusted, signed OSS host to its loopback peer.
      if (original.hostname === 'jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com') {
        return await realFetch(fixture.objects + original.pathname + original.search, init)
      }
      if (original.origin !== fixture.api) throw new Error('external network forbidden by contract test')
      const response = await realFetch(input, init)
      if (original.pathname.endsWith('/generate-playback')) {
        generationCodes.push((await response.clone().json()).code)
      }
      return response
    }
    const service = new ArkmeService(config, {
      read: async () => ({ userId: fixture.users[account]!, accessToken: fixture.tokens[account]!, refreshToken: 'contract-only' }),
      write: async () => {}, delete: async () => {},
    }, { uniqueCode: async () => 'cross-service-contract', revision: async () => 0 } as never, network)
    const options = { expectedPort: 0, allowNonLoopback: false, temporaryDirectory: tmpdir(), maxUploadBytes: 1024 }
    const handleApi = createArkmeHostApi(service, options)
    const handleMedia = createArkmeMediaHandler(service, options)
    const host = createServer((req, res) => {
      void (req.url?.startsWith('/arkme-self/api/media?') ? handleMedia(req, res) : handleApi(req, res))
    })
    await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve))
    const address = host.address() as { port: number }
    options.expectedPort = address.port
    const origin = `http://127.0.0.1:${address.port}`
    // Supply the browser's relative-URL transport before loading the default SDK.
    // Client, SDK, Host and service logic are all the production implementations.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), origin)
      if (url.origin !== origin) throw new Error('UI attempted external network')
      return await realFetch(url, { ...init, headers: { ...init?.headers, Origin: origin } })
    })
    const played: string[] = []
    const blobs: Blob[] = []
    class FixtureAudio {
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      onplaying: (() => void) | null = null
      ontimeupdate: (() => void) | null = null
      currentTime = 0
      preload = ''
      constructor(readonly src: string) {}
      load() {}
      pause() {}
      removeAttribute() {}
      async play() {
        played.push(this.src)
        this.onplaying?.()
        queueMicrotask(() => this.onended?.())
      }
    }
    vi.stubGlobal('Audio', FixtureAudio)
    const createObjectURL = URL.createObjectURL.bind(URL)
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob); return createObjectURL(blob) })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    let view: ReactTestRenderer | undefined
    try {
      const { createArkmeSdk } = await import('../src/sdk/index.js')
      const { ArkmeWorldSurface } = await import('../src/client/ArkmeWorldSurface.js')
      const sdk = createArkmeSdk()
      await act(async () => { view = create(createElement(ArkmeWorldSurface, { currentUserId: fixture.users.caller! })) })
      const speakerButton = () => view!.root.findAllByType('button').find(button => button.props['aria-label'] === '播放world的声纹')
      await vi.waitFor(() => expect(speakerButton()).toBeDefined(), { timeout: 5_000 })
      await act(async () => { speakerButton()!.props.onClick() })
      const stopButton = () => view!.root.findAllByType('button').find(button => button.props['aria-label'] === '正在生成world的声纹，点击停止')
      expect(stopButton()).toBeDefined()
      await vi.waitFor(async () => {
        // Wait for DEPLOYING to be observed, not only for the earlier Mongo write.
        expect(generationCodes).toContain(1106)
        const pending = await (await realFetch(fixture.api + '/api/public/v1/contract/state')).json()
        expect(pending.speakers.world.pending).not.toBe('')
      }, { timeout: 5_000 })
      await act(async () => { stopButton()!.props.onClick() })
      const requestsAtStop = requests.filter(path => path.endsWith('/generate-playback')).length
      // Cover an entire retry interval: disconnect must abort Host's waiting loop.
      await new Promise(resolve => setTimeout(resolve, 3_200))
      expect(requests.filter(path => path.endsWith('/generate-playback'))).toHaveLength(requestsAtStop)
      expect(played).toHaveLength(0)
      expect(speakerButton()).toBeDefined()
      // Retry resumes the durable candidate; it must not create a second voice.
      await act(async () => { speakerButton()!.props.onClick() })
      await vi.waitFor(() => {
        expect(played.length).toBeGreaterThan(1)
        expect(speakerButton()).toBeDefined()
      }, { timeout: 15_000 })
      expect(blobs).toHaveLength(played.length)
      expect(revoke).toHaveBeenCalledTimes(played.length)
      for (const blob of blobs) {
        expect(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 4))).toBe('RIFF')
      }
      await act(async () => { view!.unmount() }); view = undefined
      const page = await service.listWorldFeed()
      const record = page.items.find(item => item.authorName === 'world')!
      expect(record).toBeDefined()
      const first = await sdk.generateWorldVoiceprintPlayback({ recordRef: record.recordRef, chunkIndex: 0 })
      expect(first.chunkCount).toBeGreaterThan(1)
      expect(first.cacheHit).toBe(true)
      expect(played).toHaveLength(first.chunkCount)
      const media = await fetch(`/arkme-self/api/media?ref=${encodeURIComponent(first.mediaRef)}`)
      expect(media.status).toBe(200)
      const wav = new Uint8Array(await media.arrayBuffer())
      expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
      const afterFirst = await (await realFetch(fixture.api + '/api/public/v1/contract/state')).json()
      expect(afterFirst.speakers.world.model).toBe('qwen-audio-3.0-tts-flash')
      expect(afterFirst.speakers.world.pending).toBe('')
      expect(afterFirst.speakers.world.creates).toBe(1)
      // One preparing response, one successful request per chunk, then SDK replay.
      expect(requests.filter(path => path.endsWith('/generate-playback'))).toHaveLength(first.chunkCount + 2)
      await sdk.generateWorldVoiceprintPlayback({ recordRef: record.recordRef, chunkIndex: 1 })
      const replay = await sdk.generateWorldVoiceprintPlayback({ recordRef: record.recordRef, chunkIndex: 0 })
      expect(replay.cacheHit).toBe(true)
      const final = await (await realFetch(fixture.api + '/api/public/v1/contract/state')).json()
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
      const noToken = await realFetch(fixture.api + '/api/v1/audio/voiceprint/my', { method: 'POST', body: '{}' })
      expect(noToken.status).toBe(403)
    } finally {
      if (view) await act(async () => { view!.unmount() })
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      service.dispose()
      await new Promise<void>((resolve, reject) => host.close(error => error ? reject(error) : resolve()))
    }
  }, 45_000)
})
