import React from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({ subscribe: vi.fn(), subscribeDayDigest: vi.fn(), generateDayDigest: vi.fn() }))
vi.mock('@senguoyun/dsh-arkme/sdk', () => ({ createArkmeSdk: () => sdk }))
import { apply } from '../examples/day-digest/client.js'

it('clears a previously rendered result when generation acknowledges a null result', async () => {
  sdk.subscribe.mockImplementation(callback => { callback({ authStatus: 'authenticated', environment: 'test', userId: 1 }); return () => {} })
  sdk.subscribeDayDigest.mockImplementation((_query, callback) => {
    callback({ supported: true, generationEnabled: true, job: null, result: { coverage: [], summary: [], timeline: [{ title: '此前可读的私密结果', startAtMillis: Date.now() }] } })
    return () => {}
  })
  sdk.generateDayDigest.mockResolvedValue({ supported: true, generationEnabled: true, job: { status: 'queued' }, result: null, resultUnavailableReason: 'source_access_changed' })
  let Component: React.ComponentType = () => null
  apply({ slots: { inject: (_name: string, callback: () => void) => callback(), register: (_descriptor: unknown, component: React.ComponentType) => { Component = component } } } as never)
  let view: ReturnType<typeof create>
  await act(async () => { view = create(<Component />) })
  try {
    expect(JSON.stringify(view!.toJSON())).toContain('此前可读的私密结果')
    await act(async () => { view!.root.findAllByType('button').find(node => node.props.children === '生成时间轴和日总结')!.props.onClick() })
    expect(sdk.generateDayDigest).toHaveBeenCalledOnce()
    expect(JSON.stringify(view!.toJSON())).not.toContain('此前可读的私密结果')
    expect(JSON.stringify(view!.toJSON())).toContain('来源已变化或当前不可访问')
  } finally { act(() => view!.unmount()) }
})
