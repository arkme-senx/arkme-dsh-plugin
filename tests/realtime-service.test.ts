import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../src/keychain-store.js'
import { ArkmeRealtimeService } from '../src/realtime/service.js'
import { ProfileService } from '../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'
import { SourceService } from '../src/services/source-service.js'

class Sessions implements ArkmeSessionStore {
  constructor(private session: ArkmeSessionCredentials | undefined) {}
  async read() { return this.session }
  async write(session: ArkmeSessionCredentials) { this.session = session }
  async delete() { this.session = undefined }
}

const servers: Array<{
  close(callback?: (error?: Error) => void): void
  clients?: Set<{ terminate(): void }>
  closeAllConnections?: () => void
}> = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    for (const client of server.clients ?? []) client.terminate()
    server.closeAllConnections?.()
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
  }
})

describe('Arkme Host realtime capability', () => {
  it('multiplexes two extension services over one authenticated upstream socket', async () => {
    const receivedFrames: Array<Record<string, unknown>> = []
    const receivedHttp: Array<{ path: string; body: Record<string, unknown> }> = []
    let connections = 0
    let realtimeAcceptFailure = false
    const authorizationHeaders: Array<string | undefined> = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      receivedHttp.push({ path: request.url ?? '', body })
      if (realtimeAcceptFailure && request.url?.endsWith('/realtime/invites/accept') === true) {
        response.writeHead(503, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          code: 50301, message: 'provider offline',
          data: { error_code: 'SERVICE_OFFLINE', retryable: true },
        }))
        return
      }
      const data = request.url?.endsWith('/realtime-invites/send') === true
        ? {
            invite: {
              invite_ref: 'invite_1234567890123456', expires_at: Date.now() + 60_000,
              participant_limit: 2, delivery_state: 'activated',
            },
            state: 'waiting',
          }
        : request.url?.endsWith('/realtime-invites/join-grant') === true
          ? { join_grant: 'signed-grant', expires_at: Date.now() + 30_000 }
          : request.url?.endsWith('/realtime/invites/accept') === true
            ? {
                invite_ref: 'invite_1234567890123456', room_ref: 'room_1234567890123456',
                channel_ref: 'channel_1234567890123456', seat_ref: 'seat_1234567890123456',
                controller_generation: 1, state: 'active',
              }
            : {}
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ code: 200, message: 'ok', data }))
    })
    const websocketServer = new WebSocketServer({ noServer: true })
    server.on('upgrade', (request, socket, head) => {
      authorizationHeaders.push(request.headers.authorization)
      websocketServer.handleUpgrade(request, socket, head, websocket => { websocketServer.emit('connection', websocket, request) })
    })
    websocketServer.on('connection', websocket => {
      connections++
      websocket.on('message', raw => {
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>
        receivedFrames.push(frame)
        const type = frame.type
        if (type === 'connection.open') websocket.send(JSON.stringify({ type: 'connection.ready', connection_generation: 1 }))
        else if (type === 'service.register') websocket.send(JSON.stringify({
          type: 'service.registered', request_id: frame.request_id, namespace: frame.namespace,
          service: frame.service, protocol: frame.protocol, protocol_major: frame.protocol_major,
        }))
        else if (type === 'service.unregister') websocket.send(JSON.stringify({
          type: 'service.unregistered', request_id: frame.request_id,
        }))
        else if (type === 'channel.subscribe') websocket.send(JSON.stringify({
          type: 'channel.subscribed', request_id: frame.request_id,
          channel_ref: frame.channel_ref, seq: frame.after_seq,
        }))
        else if (type === 'channel.publish') {
          websocket.send(JSON.stringify({
            type: 'channel.published', request_id: frame.request_id,
            channel_ref: frame.channel_ref, seq: 1,
          }))
          websocket.send(JSON.stringify({
            type: 'channel.event', namespace: frame.namespace, channel_ref: frame.channel_ref, seq: 1,
            event: {
              channel_ref: frame.channel_ref, command_id: frame.command_id, seq: 1,
              sender_seat_ref: 'seat-peer', controller_generation: 1,
              payload: frame.payload, created_at: Date.now(),
            },
          }))
        } else if (type === 'channel.unsubscribe') websocket.send(JSON.stringify({
          type: 'channel.unsubscribed', request_id: frame.request_id, channel_ref: frame.channel_ref,
        }))
      })
    })
    server.listen(0, '127.0.0.1')
    servers.push(websocketServer, server)
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not expose a port')
    const baseUrl = `http://127.0.0.1:${String(address.port)}`
    const config: ArkmeServiceConfig = {
      environment: 'test', authBaseUrl: baseUrl, subjectBaseUrl: baseUrl, recordBaseUrl: baseUrl,
      chatBaseUrl: baseUrl, botBaseUrl: baseUrl, imBaseUrl: baseUrl, webrtcBaseUrl: baseUrl,
      worldBaseUrl: baseUrl, relationBaseUrl: baseUrl, intelligentBaseUrl: baseUrl, audioBaseUrl: baseUrl,
      realtimeBaseUrl: baseUrl, routePath: '/arkme-self/api', requestTimeoutMs: 3_000,
      maxTextLength: 20_000, geetestCaptchaId: 'captcha-id-123456', interwovenMomentsEnabled: true,
    }
    const sessions = new Sessions({ accessToken: 'access-token', refreshToken: 'refresh-token', userId: 1001 })
    const state = { uniqueCode: async () => 'unique-code-for-realtime-tests' }
    const runtime = new ServiceRuntime(config, sessions, state as never)
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {} as never)
    const service = new ArkmeRealtimeService(runtime, source, sessions)
    expect(() => new ArkmeRealtimeService(runtime, source, sessions, { profileRef: 'profile-only' }))
      .toThrowError(expect.objectContaining({ code: 'realtime-instance-invalid' }))
    const rps = service.forExtension('ext-rps')
    const chess = service.forExtension('ext-chess')
    const rpsDescriptor = {
      service: 'rock-paper-scissors', protocol: 'com.arkme.rps', protocolMajor: 1,
      participantMin: 2, participantMax: 2,
    }
    const disposeRps = await rps.provide(rpsDescriptor)
    const disposeChess = await chess.provide({
      service: 'chess', protocol: 'com.arkme.chess', protocolMajor: 1,
      participantMin: 2, participantMax: 2,
    })

    expect(connections).toBe(1)
    expect(receivedFrames.filter(frame => frame.type === 'service.register').map(frame => frame.namespace)).toEqual([
      'ext-rps', 'ext-chess',
    ])

    const sourceRef = await source.sealSourceRef(1001, 'private_chat', 'chat-session-1', '对战用户')
    const invite = await rps.invite({
      ...rpsDescriptor, sourceRef, participantLimit: 2, fallbackText: '来一局石头剪刀布',
    })
    expect(invite.inviteRef).toBe('invite_1234567890123456')
    expect(receivedHttp.find(entry => entry.path.endsWith('/realtime-invites/send'))?.body).toMatchObject({
      chat_session_uid: 'chat-session-1', extension_id: 'ext-rps', namespace: 'ext-rps',
    })

    const missing = service.forExtension('ext-missing')
    const httpCountBeforeMissingEnter = receivedHttp.length
    await expect(missing.enter({
      schemaVersion: 1, inviteRef: invite.inviteRef, extensionId: 'ext-missing',
      service: rpsDescriptor.service, protocol: rpsDescriptor.protocol, protocolMajor: 1,
      expiresAtMillis: invite.expiresAtMillis, participantLimit: 2, fallbackText: '无服务',
    })).rejects.toMatchObject({ code: 'realtime-service-offline' })
    expect(receivedHttp).toHaveLength(httpCountBeforeMissingEnter)

    const room = await rps.enter({
      schemaVersion: 1, inviteRef: invite.inviteRef, extensionId: 'ext-rps',
      service: rpsDescriptor.service, protocol: rpsDescriptor.protocol, protocolMajor: 1,
      expiresAtMillis: invite.expiresAtMillis, participantLimit: 2, fallbackText: '来一局石头剪刀布',
    })
    let resolveEvent: ((payload: unknown) => void) | undefined
    const event = new Promise<unknown>(resolve => { resolveEvent = resolve })
    const disposeSubscription = await rps.subscribe(room.channelRef, value => { resolveEvent?.(value.payload) })
    await new Promise(resolve => { setTimeout(resolve, 20) })
    await rps.publish(room, { move: 'rock' }, { commandId: 'command-1' })
    await expect(event).resolves.toEqual({ move: 'rock' })
    expect(receivedFrames.find(frame => frame.type === 'channel.subscribe')).toMatchObject({ namespace: 'ext-rps' })
    expect(receivedFrames.find(frame => frame.type === 'channel.publish')).toMatchObject({ namespace: 'ext-rps' })

    realtimeAcceptFailure = true
    await expect(rps.enter({
      schemaVersion: 1, inviteRef: invite.inviteRef, extensionId: 'ext-rps',
      service: rpsDescriptor.service, protocol: rpsDescriptor.protocol, protocolMajor: 1,
      expiresAtMillis: invite.expiresAtMillis, participantLimit: 2, fallbackText: '来一局石头剪刀布',
    })).rejects.toMatchObject({ code: 'SERVICE_OFFLINE', retryable: true })
    realtimeAcceptFailure = false

    await sessions.write({ accessToken: 'access-token-b', refreshToken: 'refresh-token-b', userId: 1001 })
    service.authenticationChanged()
    await expect.poll(() => connections, { timeout: 3_000 }).toBe(2)
    expect(authorizationHeaders).toEqual(['Bearer access-token', 'Bearer access-token-b'])
    await expect.poll(
      () => receivedFrames.filter(frame => frame.type === 'service.register').length,
      { timeout: 3_000 },
    ).toBe(4)
    await expect.poll(
      () => receivedFrames.filter(frame => frame.type === 'channel.subscribe').length,
      { timeout: 3_000 },
    ).toBe(2)

    const multiplexer = (service as unknown as { socket: { socket?: { close(...args: unknown[]): unknown }; handleMessage(socket: unknown, data: Buffer): void } }).socket
    const activeSocket = multiplexer.socket
    if (activeSocket === undefined) throw new Error('active realtime socket missing')
    const closeSpy = vi.spyOn(activeSocket, 'close')
    multiplexer.handleMessage({}, Buffer.from('{"type":"connection.replaced"}'))
    expect(closeSpy).not.toHaveBeenCalled()
    closeSpy.mockRestore()

    await sessions.write({ accessToken: 'access-token-c', refreshToken: 'refresh-token-c', userId: 2002 })
    service.authenticationChanged()
    await expect.poll(() => connections, { timeout: 3_000 }).toBe(3)
    expect(authorizationHeaders).toEqual(['Bearer access-token', 'Bearer access-token-b', 'Bearer access-token-c'])

    const firstOpen = receivedFrames.find(frame => frame.type === 'connection.open')

    disposeSubscription()
    disposeChess()
    disposeRps()
    service.dispose()

    const restarted = new ArkmeRealtimeService(runtime, source, sessions)
    const disposeRestarted = await restarted.forExtension('ext-rps').provide(rpsDescriptor)
    await expect.poll(() => connections, { timeout: 3_000 }).toBe(4)
    const openFrames = receivedFrames.filter(frame => frame.type === 'connection.open')
    expect(openFrames.at(-1)).toMatchObject({
      profile_ref: firstOpen?.profile_ref,
      client_ref: firstOpen?.client_ref,
    })
    disposeRestarted()
    restarted.dispose()
  })
})
