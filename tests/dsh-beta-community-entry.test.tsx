import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))
import {
  ArkmeDSHBetaCommunityEntry,
  ArkmeDSHBetaCommunityEntryContent,
  ArkmeDSHBetaCommunityJoinConfirmation,
} from '../src/client/ArkmeDSHBetaCommunityEntry.js'

const avatars = [
  'data:image/png;base64,b3duZXI=',
  'data:image/png;base64,bWVtYmVy',
]

describe('DSH beta community entry UI', () => {
  it('reuses the approved copy, real avatar mosaic, and non-sticky list placement', () => {
    const markup = renderToStaticMarkup(<ArkmeDSHBetaCommunityEntryContent
      avatarUrls={avatars}
      joining={false}
      onActivate={() => {}}
    />)

    expect(markup).toContain('DSH 内测')
    expect(markup).toContain('还没加入 DSH 内测群？')
    expect(markup).toContain('和内测用户一起聊聊')
    expect(markup).toContain('去加入')
    expect(markup.match(/<img/g)).toHaveLength(2)
    expect(markup).not.toContain('position:sticky')
    expect(markup).not.toContain('JOT')
  })

  it('shows the existing confirmation sheet before the join action', () => {
    const markup = renderToStaticMarkup(<ArkmeDSHBetaCommunityJoinConfirmation
      avatarUrls={avatars}
      onCancel={() => {}}
      onConfirm={() => {}}
    />)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('DSH 内测群')
    expect(markup).toContain('加入群聊')
    expect(markup.match(/<img/g)).toHaveLength(2)
    expect(markup).toContain('align-items:center')
    expect(markup).toContain('justify-content:center')
    expect(markup).toContain('width:min(460px, calc(100% - 32px))')
    expect(markup).toContain('border-radius:34px')
    expect(markup).not.toContain('align-items:flex-end')
  })

  it('disables the entry while one join is already in flight', () => {
    const markup = renderToStaticMarkup(<ArkmeDSHBetaCommunityEntryContent
      avatarUrls={avatars}
      joining
      onActivate={() => {}}
    />)

    expect(markup).toContain('disabled=""')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('加入中…')
    expect(markup).not.toContain('去加入')
  })
})


it.each(['already_member', 'failed', 'ready'])('does not reserve blank space while checking membership, then handles %s', async outcome => {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  mocks.callArkme.mockReset().mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no }))
  let view!: ReturnType<typeof create>
  const onJoined = () => undefined
  await act(async () => { view = create(<ArkmeDSHBetaCommunityEntry onJoined={onJoined} />) })
  expect(view.toJSON()).toBeNull()
  await act(async () => { view.update(<ArkmeDSHBetaCommunityEntry onJoined={onJoined} />) })
  expect(mocks.callArkme).toHaveBeenCalledOnce()
  const signal = mocks.callArkme.mock.calls[0]![2] as AbortSignal
  await act(async () => {
    if (outcome === 'failed') reject(new Error('offline'))
    else resolve({ status: outcome, visible: outcome === 'ready', memberCount: 2, avatarRefs: [] })
  })
  if (outcome === 'ready') expect(view.root.findByProps({ 'aria-label': '加入 DSH 内测群' })).toBeDefined()
  else expect(view.toJSON()).toBeNull()
  await act(async () => { view.unmount() })
  expect(signal.aborted).toBe(true)
})
