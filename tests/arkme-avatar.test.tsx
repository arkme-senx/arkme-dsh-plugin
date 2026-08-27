import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeSourceAvatar, ArkmeUserAvatar, clearArkmeAvatarCache } from '../src/client/ArkmeAvatar.js'

const mocks = vi.hoisted(() => ({
  callArkme: vi.fn(),
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
}))

function tick(): Promise<void> {
  return Promise.resolve()
}

describe('ArkmeAvatar', () => {
  beforeEach(() => {
    clearArkmeAvatarCache()
    mocks.callArkme.mockReset()
    mocks.callArkme.mockImplementation(async (_operation: string, input: { imageRef: string }) => ({
      mediaType: 'image/png',
      dataBase64: Buffer.from(input.imageRef).toString('base64'),
    }))
  })

  it('renders a cached user avatar on the first frame when re-entering the page', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeUserAvatar avatarRef="avatar-user-a" fallback={{ kind: 'default' }} />)
      await tick()
      await tick()
    })
    expect(renderer.root.findAllByType('img')).toHaveLength(1)

    renderer.unmount()
    const second = create(<ArkmeUserAvatar avatarRef="avatar-user-a" fallback={{ kind: 'default' }} />)

    expect(second.root.findAllByType('img')).toHaveLength(1)
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
    expect(mocks.callArkme).toHaveBeenCalledWith('image.read', { imageRef: 'avatar-user-a' })
    second.unmount()
  })

  it('renders a cached source avatar on the first frame when the source is mounted again', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSourceAvatar avatarRef="avatar-source-a" />)
      await tick()
      await tick()
    })
    expect(renderer.root.findAllByType('img')).toHaveLength(1)

    renderer.unmount()
    const second = create(<ArkmeSourceAvatar avatarRef="avatar-source-a" />)

    expect(second.root.findAllByType('img')).toHaveLength(1)
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
    expect(mocks.callArkme).toHaveBeenCalledWith('image.read', { imageRef: 'avatar-source-a' })
    second.unmount()
  })
})
