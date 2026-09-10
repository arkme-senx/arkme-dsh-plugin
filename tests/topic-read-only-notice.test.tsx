import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeTopicReadOnlyNotice } from '../src/client/ArkmeTopicReadOnlyNotice.js'

const sdk = vi.hoisted(() => vi.fn(() => { throw new Error('A read-only notice must not read or write settings') }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: sdk }))

describe('system topic read-only notice', () => {
  it('immediately explains the absent composer without controls or settings requests', () => {
    let renderer!: ReactTestRenderer
    act(() => { renderer = create(<ArkmeTopicReadOnlyNotice />) })
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('发给 DSH 的消息')
    expect(text).toContain('不支持在此新增快记')
    for (const absent of ['在首页展示', '正在读取设置', '更多创建时信息', '创建于', '耗时']) {
      expect(text).not.toContain(absent)
    }
    for (const tag of ['input', 'button', 'textarea']) expect(renderer.root.findAllByType(tag)).toHaveLength(0)
    expect(renderer.root.findByType('footer').props).toMatchObject({
      'aria-label': '系统主题说明',
      style: { flexShrink: 0, minHeight: 72, boxSizing: 'border-box' },
    })
    expect(renderer.root.findByType('footer').props['aria-busy']).toBeUndefined()
    act(() => { renderer.update(<ArkmeTopicReadOnlyNotice />); renderer.unmount() })
    expect(sdk).not.toHaveBeenCalled()
  })
})
