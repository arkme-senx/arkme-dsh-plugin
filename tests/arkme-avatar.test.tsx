import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ArkmeDirectorySourceAvatar,
  ArkmeSourceAvatar,
  ArkmeUserAvatar,
} from '../src/client/ArkmeAvatar.js'
import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'

const mocks = vi.hoisted(() => ({
  callArkme: vi.fn(),
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
}))

function tick(): Promise<void> {
  return Promise.resolve()
}

function imageDataUrl(value: string): string {
  return `data:image/png;base64,${Buffer.from(value).toString('base64')}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('ArkmeAvatar', () => {
  let scopeRevision = 0

  beforeEach(() => {
    scopeRevision += 1
    arkmeAvatarImages.activateScope(`test:${String(scopeRevision)}`)
    mocks.callArkme.mockReset()
    mocks.callArkme.mockImplementation(async (_operation: string, input: { imageRef: string }) => ({
      mediaType: 'image/png',
      dataBase64: Buffer.from(input.imageRef).toString('base64'),
    }))
  })

  afterEach(() => { arkmeAvatarImages.activateScope(undefined) })

  it('renders a cached user avatar on the first frame when re-entering the page', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeUserAvatar avatarRef="avatar-user-a" fallback={{ kind: 'default' }} />)
      await tick()
      await tick()
    })
    expect(renderer.root.findAllByType('img')).toHaveLength(1)

    act(() => { renderer.unmount() })
    const second = create(<ArkmeUserAvatar avatarRef="avatar-user-a" fallback={{ kind: 'default' }} />)

    expect(second.root.findAllByType('img')).toHaveLength(1)
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
    expect(mocks.callArkme).toHaveBeenCalledWith('image.read', { imageRef: 'avatar-user-a' })
    act(() => { second.unmount() })
  })

  it('renders a cached source avatar on the first frame when the source is mounted again', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSourceAvatar kind="single" avatarRef="avatar-source-a" />)
      await tick()
      await tick()
    })
    expect(renderer.root.findAllByType('img')).toHaveLength(1)

    act(() => { renderer.unmount() })
    const second = create(<ArkmeSourceAvatar kind="single" avatarRef="avatar-source-a" />)

    expect(second.root.findAllByType('img')).toHaveLength(1)
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
    expect(mocks.callArkme).toHaveBeenCalledWith('image.read', { imageRef: 'avatar-source-a' })
    act(() => { second.unmount() })
  })

  it('does not reload unchanged group slots when only computedAtMillis changes', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    const first = {
      memberCount: 1,
      strategy: 'owner_recent_speakers_v1',
      computedAtMillis: 1,
      slots: [{ avatarRef: 'avatar-a' }],
    }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSourceAvatar kind="group" groupAvatar={first} />)
      await tick()
      await tick()
    })
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
    now.mockReturnValue(13 * 60 * 1000)

    await act(async () => {
      renderer.update(<ArkmeSourceAvatar kind="group" groupAvatar={{ ...first, computedAtMillis: 2 }} />)
      await tick()
    })
    now.mockRestore()

    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
    expect(renderer.root.findByType('img').props.src).toBe(imageDataUrl('avatar-a'))
    act(() => { renderer.unmount() })
  })

  it('keeps the last image while active avatar revalidation is pending and applies changed content', async () => {
    mocks.callArkme.mockResolvedValueOnce({
      mediaType: 'image/png',
      dataBase64: Buffer.from('old').toString('base64'),
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeUserAvatar avatarRef="avatar-a" />)
      await tick()
      await tick()
    })
    const pending = deferred<{ mediaType: string; dataBase64: string }>()
    mocks.callArkme.mockImplementationOnce(async () => await pending.promise)

    let refresh!: Promise<void>
    await act(async () => {
      refresh = arkmeAvatarImages.revalidateActive()
      await tick()
    })
    expect(renderer.root.findByType('img').props.src).toBe(imageDataUrl('old'))

    await act(async () => {
      pending.resolve({
        mediaType: 'image/png',
        dataBase64: Buffer.from('new').toString('base64'),
      })
      await refresh
    })
    expect(renderer.root.findByType('img').props.src).toBe(imageDataUrl('new'))
    act(() => { renderer.unmount() })
  })

  it('keeps the last image when active avatar revalidation fails', async () => {
    mocks.callArkme.mockResolvedValueOnce({
      mediaType: 'image/png',
      dataBase64: Buffer.from('old').toString('base64'),
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeUserAvatar avatarRef="avatar-a" />)
      await tick()
      await tick()
    })
    mocks.callArkme.mockRejectedValueOnce(new Error('offline'))

    await act(async () => { await arkmeAvatarImages.revalidateActive() })

    expect(renderer.root.findByType('img').props.src).toBe(imageDataUrl('old'))
    act(() => { renderer.unmount() })
  })

  it('reloads the same mounted ref after an authenticated account scope change', async () => {
    mocks.callArkme
      .mockResolvedValueOnce({ mediaType: 'image/png', dataBase64: Buffer.from('old').toString('base64') })
      .mockResolvedValueOnce({ mediaType: 'image/png', dataBase64: Buffer.from('new').toString('base64') })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeUserAvatar avatarRef="avatar-a" />)
      await tick()
      await tick()
    })

    await act(async () => {
      arkmeAvatarImages.activateScope('prod:next-account')
      await vi.waitFor(() => {
        expect(renderer.root.findByType('img').props.src).toBe(imageDataUrl('new'))
      })
    })

    expect(renderer.root.findByType('img').props.src).toBe(imageDataUrl('new'))
    act(() => { renderer.unmount() })
  })

  it('does not render an old-account image when its in-flight read completes after a scope change', async () => {
    const pending = deferred<{ mediaType: string; dataBase64: string }>()
    mocks.callArkme.mockImplementationOnce(async () => await pending.promise)
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeUserAvatar avatarRef="avatar-a" />)
      await tick()
    })

    await act(async () => { arkmeAvatarImages.activateScope('test:new-account') })
    await act(async () => {
      pending.resolve({
        mediaType: 'image/png',
        dataBase64: Buffer.from('old-account').toString('base64'),
      })
      await vi.waitFor(() => {
        expect(renderer.root.findByType('img').props.src).toBe(imageDataUrl('avatar-a'))
      })
    })

    expect(renderer.root.findByType('img').props.src).toBe(imageDataUrl('avatar-a'))
    expect(renderer.root.findByType('img').props.src).not.toBe(imageDataUrl('old-account'))
    act(() => { renderer.unmount() })
  })

  it('renders an empty group presentation from the explicit semantic kind', () => {
    const renderer = create(<ArkmeSourceAvatar kind="group" />)

    expect(renderer.root.findAll(node => node.props['data-arkme-group-avatar-count'] === 1)).toHaveLength(1)
    act(() => { renderer.unmount() })
  })

  it('derives Source avatar presentation from source kind instead of optional field presence', async () => {
    const group = create(<ArkmeDirectorySourceAvatar source={{
      kind: 'group_chat', avatarRef: 'must-not-be-used-as-a-group-member',
    }} />)
    expect(group.root.findAll(node => node.props['data-arkme-group-avatar-count'] === 1)).toHaveLength(1)
    expect(mocks.callArkme).not.toHaveBeenCalled()
    act(() => { group.unmount() })

    let privateChat!: ReactTestRenderer
    await act(async () => {
      privateChat = create(<ArkmeDirectorySourceAvatar source={{
        kind: 'private_chat', avatarRef: 'private-avatar',
        groupAvatar: { memberCount: 2, strategy: 'unexpected', computedAtMillis: 1, slots: [] },
      }} />)
      await tick()
      await tick()
    })
    expect(privateChat.root.findAll(node => node.props['data-arkme-group-avatar-count'] !== undefined)).toHaveLength(0)
    expect(mocks.callArkme).toHaveBeenCalledWith('image.read', { imageRef: 'private-avatar' })
    act(() => { privateChat.unmount() })
  })
})
