import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({
  call: vi.fn(),
  read: vi.fn(),
  snapshot: { revision: 1 },
}))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('../src/client/official-notification-store.js', () => ({
  officialNotifications: {
    read: mock.read,
    subscribe: () => () => {},
    getSnapshot: () => mock.snapshot,
  },
}))
import { ArkmeOfficialNotificationDetail } from '../src/client/ArkmeOfficialNotificationDetail.js'
let renderer: ReactTestRenderer | undefined
const notice = {
  id: 'notice-one',
  title: '官方公告',
  summary: '',
  publishedAtMillis: 100,
  readAtMillis: 0,
  bodyMarkdown:
    '正文\n\n<script>alert(1)</script>\n\n![track](https://tracker.example/a)\n\n[bad](javascript:alert) [safe](https://example.com)',
}
beforeEach(() => {
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  mock.call.mockReset().mockResolvedValue(notice)
  mock.read.mockReset().mockResolvedValue({})
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})
it('marks read only after detail is rendered, and strips active content', async () => {
  await act(async () => {
    renderer = create(
      <ArkmeOfficialNotificationDetail
        id="notice-one"
        scope="test:42"
        onClose={() => {}}
      />,
    )
  })
  expect(mock.read).toHaveBeenCalledExactlyOnceWith('test:42', ['notice-one'])
  expect(renderer!.root.findAllByType('script')).toHaveLength(0)
  expect(renderer!.root.findAllByType('img')).toHaveLength(0)
  expect(renderer!.root.findAllByType('a').map((a) => a.props.href)).toEqual([
    'https://example.com',
  ])
})
it('does not mark a hidden, failed or previously read detail', async () => {
  vi.stubGlobal('document', {
    hidden: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  await act(async () => {
    renderer = create(
      <ArkmeOfficialNotificationDetail
        id="notice-one"
        scope="test:42"
        onClose={() => {}}
      />,
    )
  })
  expect(mock.read).not.toHaveBeenCalled()
  await act(async () => renderer?.unmount())
  mock.call.mockRejectedValue(new Error('通知已撤回'))
  await act(async () => {
    renderer = create(
      <ArkmeOfficialNotificationDetail
        id="notice-two"
        scope="test:42"
        onClose={() => {}}
      />,
    )
  })
  expect(mock.read).not.toHaveBeenCalled()
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
})
it('shows an acknowledgement failure without discarding the notice', async () => {
  mock.read.mockRejectedValue(new Error('offline'))
  await act(async () => {
    renderer = create(
      <ArkmeOfficialNotificationDetail
        id="notice-one"
        scope="test:42"
        onClose={() => {}}
      />,
    )
  })
  expect(renderer!.root.findByType('h2').children).toContain('官方公告')
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
})
