import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ sockets: [] as any[] }))
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  return { default: class extends EventEmitter {
    static OPEN = 1
    readyState = 1
    sent: any[] = []
    ended = false
    constructor() { super(); state.sockets.push(this) }
    send(raw: string) { this.sent.push(JSON.parse(raw)) }
    terminate() { if (!this.ended) { this.ended = true; this.emit('close') } }
  } }
})
import { DeviceControlRealtime, deviceControlRealtimeOrigin } from '../src/services/device-control-realtime.js'
const connections: DeviceControlRealtime[] = []
afterEach(() => { connections.splice(0).forEach(c => c.close()); state.sockets.splice(0) })
describe('device control realtime wire', () => {
  it('resolves the matching environment without requiring DSH remote configuration', () => {
    expect(deviceControlRealtimeOrigin({environment: 'test'})).toBe('https://jotmo-realtime.senguo.me')
    expect(deviceControlRealtimeOrigin({environment: 'prod', dshRemoteRealtimeBaseUrl: '  '})).toBe('https://realtime.jotmo.cc')
    expect(deviceControlRealtimeOrigin({environment: 'test', dshRemoteRealtimeBaseUrl: ' https://custom.example.test '})).toBe('https://custom.example.test')
  })
  it('uses explicit module identity for subscription and registration and only refreshes its own account', () => {
    const changed = vi.fn()
    const owner = new DeviceControlRealtime('https://realtime.example.test', changed); connections.push(owner)
    owner.connect(42, 'current_session_12345', 'test-access-token')
    const socket = state.sockets[0]
    const receive = (frame: object) => socket.emit('message', Buffer.from(JSON.stringify(frame)))
    socket.emit('open')
    expect(socket.sent[0]).toMatchObject({type: 'connection.open', client_ref: 'current_session_12345'})
    receive({type: 'connection.ready'})
    expect(socket.sent[1]).toMatchObject({type: 'channel.subscribe', module: 'device_control', namespace: 'device_control', channel_ref: '42'})
    receive({type: 'channel.subscribed', request_id: socket.sent[1].request_id})
    expect(socket.sent[2]).toMatchObject({type: 'service.register', module: 'device_control', namespace: 'device_control', protocol: 'jotmo.device-control', descriptor: {}})
    receive({type: 'service.registered', request_id: socket.sent[2].request_id})
    expect(changed).toHaveBeenCalledTimes(1)
    receive({type: 'channel.event', module: 'other', namespace: 'device_control', channel_ref: '42'})
    receive({type: 'channel.event', module: 'device_control', namespace: 'device_control', channel_ref: '43'})
    expect(changed).toHaveBeenCalledTimes(1)
    receive({type: 'channel.event', module: 'device_control', namespace: 'device_control', channel_ref: '42'})
    expect(changed).toHaveBeenCalledTimes(2)
    owner.connect(42, 'new_session_123456789', 'new-access-token')
    expect(socket.ended).toBe(true)
    receive({type: 'channel.event', module: 'device_control', namespace: 'device_control', channel_ref: '42'})
    expect(changed).toHaveBeenCalledTimes(2)
  })
})
