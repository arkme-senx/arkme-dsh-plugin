import { readFileSync } from 'node:fs'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeCallSurface } from '../src/client/ArkmeCallSurface.js'
import { outgoingCallUi } from '../src/client/outgoing-call-ui-controller.js'

const callSurfaceSource = readFileSync(
  new URL('../src/client/ArkmeCallSurface.tsx', import.meta.url),
  'utf8',
)

const mocks = vi.hoisted(() => ({
  callArkme: vi.fn(),
  outgoingCallRequest: vi.fn(),
  outgoingCallSettledListeners: [] as Array<(event: { callRequestId: string; displayName: string; mediaType: 'audio' | 'video'; status: 'ended' | 'failed' }) => void>,
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {
    body = { message: this.message }
  },
}))

vi.mock('../src/client/outgoing-call-ui-controller.js', () => ({
  outgoingCallUi: {
    request: mocks.outgoingCallRequest,
    subscribeSettled: (listener: (event: { callRequestId: string; displayName: string; mediaType: 'audio' | 'video'; status: 'ended' | 'failed' }) => void) => {
      mocks.outgoingCallSettledListeners.push(listener)
      return () => {
        const index = mocks.outgoingCallSettledListeners.indexOf(listener)
        if (index >= 0) mocks.outgoingCallSettledListeners.splice(index, 1)
      }
    },
  },
}))

function tick(): Promise<void> {
  return Promise.resolve()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textContent).join('')
  if (value !== null && typeof value === 'object' && 'children' in value) {
    return textContent((value as { children?: unknown }).children)
  }
  if (value !== null && typeof value === 'object' && 'props' in value) {
    return textContent((value as { props?: { children?: unknown } }).props?.children)
  }
  return ''
}

function buttonByText(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const button = renderer.root.findAllByType('button')
    .find(item => textContent(item.props.children).includes(text))
  if (button === undefined) throw new Error(`button not found: ${text}`)
  return button
}

function buttonByTexts(renderer: ReactTestRenderer, ...texts: string[]): ReactTestInstance {
  const button = renderer.root.findAllByType('button')
    .find(item => {
      const content = textContent(item.props.children)
      return texts.every(text => content.includes(text))
    })
  if (button === undefined) throw new Error(`button not found: ${texts.join(' + ')}`)
  return button
}

function buttonByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.findByProps({ 'aria-label': label })
}

describe('ArkmeCallSurface interactions', () => {
  beforeEach(() => {
    mocks.callArkme.mockReset()
    mocks.outgoingCallRequest.mockReset()
    mocks.outgoingCallSettledListeners.length = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return {
        items: [],
        recentContacts: [{ userId: 77, displayName: '重复名' }],
        hasMore: false,
      }
      if (operation === 'sources.list') return {
        directory: 'root',
        items: [{
          sourceRef: 'wrong-same-name-source',
          kind: 'private_chat',
          displayName: '重复名',
          activeAtMillis: 1,
          unreadCount: 0,
        }],
        hasMore: false,
      }
      if (operation === 'chat.private.open') return {
        source: {
          sourceRef: 'resolved-peer-source',
          kind: 'private_chat',
          displayName: '重复名',
          activeAtMillis: 2,
          unreadCount: 0,
        },
      }
      throw new Error(`unexpected operation ${operation}`)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses DSH semantic tokens without maintaining a second theme state', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface initialPickerOpen />)
      await tick()
      await tick()
    })

    const root = renderer.root.findByProps({ 'data-arkme-call-surface': 'true' })
    expect(root.props.style.background).toBe('var(--dsw-alias-bg-base, #ffffff)')
    expect(root.props.style.color).toBe('var(--dsw-alias-label-primary, #17191c)')
    const picker = renderer.root.findByProps({ 'aria-label': '选择通话联系人' })
    const search = renderer.root.findByProps({ 'aria-label': '搜索私聊联系人' }).parent
    expect(picker.props.style.background)
      .toBe('var(--dsw-specific-menu, var(--dsw-alias-bg-layer-3, #ffffff))')
    expect(picker.props.style.border)
      .toBe('1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.10))')
    expect(search?.props.style.height).toBe(36)
    expect(search?.props.style.minHeight).toBe(36)
    expect(search?.props.style.borderRadius).toBe(9)
    expect(search?.props.style.padding).toBe('0 10px')
    expect(search?.props.style.background).toBe('var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-2, #ffffff))')
    expect(search?.props.style.color).toBe('var(--dsw-alias-label-tertiary, #9097a1)')
    expect(renderer.root.findByProps({ 'aria-label': '搜索私聊联系人' }).props.placeholder).toBe('输入即我号或昵称')
    expect(renderer.root.findByProps({ 'aria-label': '搜索私聊联系人' }).props.style.color).toBe('var(--dsw-alias-label-primary, #17191c)')
    expect(renderer.root.findByProps({ 'aria-label': '搜索私聊联系人' }).props.style.fontSize).toBe(12)
    expect(buttonByLabel(renderer, '和即我作者视频通话').findByProps({ 'data-arkme-call-video-icon': 'compact' }).props.style.filter)
      .toBe('var(--arkme-call-video-icon-filter, none)')
    expect(callSurfaceSource).not.toContain('useCallSurfaceDarkMode')
    expect(callSurfaceSource).not.toContain('MutationObserver')
    expect(callSurfaceSource).not.toContain('darkCallStyles')
    expect(callSurfaceSource).not.toContain('data-arkme-call-surface-theme')
  })

  it('refreshes the recent call list when an outgoing call settles', async () => {
    vi.useFakeTimers()
    let listCount = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') {
        listCount += 1
        return {
          items: listCount === 1 ? [] : [{
            callRef: 'fresh-call',
            stableId: 'fresh-call',
            peerDisplayName: '新通话',
            mediaType: 'audio',
            startedAtMillis: 10,
            acceptedAtMillis: 10,
            endedAtMillis: 20,
            durationSeconds: 10,
            callResult: 'NormalEnd',
            resultLabel: '已接通',
            summaryStatus: 'idle',
            canOpenDetail: false,
            canRedial: true,
          }],
          recentContacts: [],
          hasMore: false,
        }
      }
      if (operation === 'sources.list') return { directory: 'root', items: [], hasMore: false }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface />)
      await tick()
      await tick()
    })

    expect(textContent(renderer.toJSON())).not.toContain('新通话')

    await act(async () => {
      mocks.outgoingCallSettledListeners.forEach(listener => {
        listener({ callRequestId: 'request-1', displayName: '新通话', mediaType: 'audio', status: 'ended' })
      })
      await tick()
      await tick()
    })

    expect(textContent(renderer.toJSON())).toContain('新通话')
    expect(listCount).toBe(2)

    await act(async () => {
      vi.advanceTimersByTime(2_400)
      await tick()
      await tick()
    })
    expect(listCount).toBe(3)
    vi.useRealTimers()
  })

  it('resolves recent call contacts by peer user id before opening outgoing call UI', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface />)
      await tick()
      await tick()
    })

    await act(async () => {
      buttonByLabel(renderer, '选择重复名通话方式').props.onClick()
      await tick()
    })
    await act(async () => {
      buttonByText(renderer, '语音通话仅使用麦克风').props.onClick()
      await tick()
      await tick()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('chat.private.open', {
      peerUserId: 77,
      displayName: '重复名',
    })
    expect(outgoingCallUi.request).toHaveBeenCalledWith({
      sourceRef: 'resolved-peer-source',
      displayName: '重复名',
      mediaType: 'audio',
    })
    expect(outgoingCallUi.request).not.toHaveBeenCalledWith(expect.objectContaining({
      sourceRef: 'wrong-same-name-source',
    }))
  })

  it('preloads visible call avatars before switching the call list to ready', async () => {
    const image = deferred<{ mediaType: string; dataBase64: string }>()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return {
        items: [{
          callRef: 'call-1',
          stableId: 'call-1',
          peerDisplayName: '小林',
          peerAvatarRef: 'avatar-call-1',
          mediaType: 'audio',
          startedAtMillis: 1,
          acceptedAtMillis: 1,
          endedAtMillis: 2,
          durationSeconds: 1,
          callResult: 'NormalEnd',
          resultLabel: '已接通',
          summaryStatus: 'idle',
          canOpenDetail: true,
          canRedial: true,
        }],
        recentContacts: [{ userId: 77, displayName: '小林', avatarRef: 'avatar-contact-1' }],
        hasMore: false,
      }
      if (operation === 'sources.list') return { directory: 'root', items: [], hasMore: false }
      if (operation === 'image.read') return image.promise
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface />)
      await tick()
      await tick()
    })

    expect(textContent(renderer.toJSON())).toContain('正在读取通话记录')
    expect(textContent(renderer.toJSON())).not.toContain('阿森')
    expect(textContent(renderer.toJSON())).not.toContain('小林')

    await act(async () => {
      image.resolve({ mediaType: 'image/png', dataBase64: 'AAA=' })
      await tick()
      await tick()
    })

    expect(textContent(renderer.toJSON())).toContain('最近通话')
    expect(textContent(renderer.toJSON())).toContain('小林')
    expect(renderer.root.findAllByType('img').length).toBeGreaterThan(0)
    expect(mocks.callArkme).toHaveBeenCalledWith('image.read', { imageRef: 'avatar-contact-1' })
    expect(mocks.callArkme).toHaveBeenCalledWith('image.read', { imageRef: 'avatar-call-1' })
  })

  it('keeps sample calls at the bottom and renders video sample as a static switchable image', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return {
        items: [{
          callRef: 'real-call-1',
          stableId: 'real-call-1',
          peerDisplayName: '小林',
          mediaType: 'audio',
          startedAtMillis: 1,
          acceptedAtMillis: 1,
          endedAtMillis: 2,
          durationSeconds: 1,
          callResult: 'NormalEnd',
          resultLabel: '已接通',
          summaryStatus: 'idle',
          canOpenDetail: false,
          canRedial: true,
        }],
        recentContacts: [],
        hasMore: false,
      }
      if (operation === 'sources.list') return { directory: 'root', items: [], hasMore: false }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface />)
      await tick()
      await tick()
    })

    const content = textContent(renderer.toJSON())
    expect(content).not.toContain('通话示例')
    const callRowTexts = renderer.root.findAllByType('button')
      .map(button => textContent(button.props.children))
      .filter(text => text.includes('通话'))
    const realIndex = callRowTexts.findIndex(text => text.includes('小林') && text.includes('语音通话'))
    const videoSampleIndex = callRowTexts.findIndex(text => text.includes('林小满') && text.includes('视频通话'))
    const audioSampleIndex = callRowTexts.findIndex(text => text.includes('妈妈') && text.includes('语音通话'))
    expect(realIndex).toBeGreaterThanOrEqual(0)
    expect(realIndex).toBeLessThan(videoSampleIndex)
    expect(videoSampleIndex).toBeLessThan(audioSampleIndex)

    await act(async () => {
      buttonByTexts(renderer, '林小满', '视频通话', '22:14').props.onClick()
      await tick()
    })

    expect(textContent(renderer.toJSON())).toContain('确认了发布会演示顺序；制造业案例数据在彩排前补齐。')
    expect(textContent(renderer.toJSON())).toContain('主画面已经比较稳了，我建议把 Arkme 找到结论的过程放到最前面。')
    const image = renderer.root.findByProps({ alt: '林小满示例主画面' })
    const firstSrc = image.props.src as string
    expect(firstSrc).toBe('/arkme-self/api/call/call-demo-peer.png')
    expect(() => buttonByLabel(renderer, '和林小满视频通话')).toThrow()

    await act(async () => {
      buttonByText(renderer, '切换视角').props.onClick()
      await tick()
    })

    expect(renderer.root.findByProps({ alt: '林小满示例主画面' }).props.src).toBe('/arkme-self/api/call/call-demo-self.png')

    await act(async () => {
      buttonByTexts(renderer, '妈妈', '语音通话', '08:47').props.onClick()
      await tick()
    })

    const audioContent = textContent(renderer.toJSON())
    expect(audioContent).toContain('确认了周末见面的时间和需要准备的物品。')
    expect(audioContent).toContain('周六上午十点过来就好，路上不用太赶。')
    expect(renderer.root.findAllByProps({ 'aria-label': '视频记录' })).toHaveLength(0)
  })

  it('renders real video call records from detail media instead of the sample demo image', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return {
        items: [{
          callRef: 'real-video-ref',
          stableId: 'real-video-1',
          peerDisplayName: '真实用户',
          mediaType: 'video',
          startedAtMillis: 1,
          acceptedAtMillis: 1,
          endedAtMillis: 12,
          durationSeconds: 11,
          callResult: 'NormalEnd',
          resultLabel: '已接通',
          summaryStatus: 'done',
          summaryPreview: '真实视频摘要',
          canOpenDetail: true,
          canRedial: true,
        }],
        recentContacts: [],
        hasMore: false,
      }
      if (operation === 'calls.history.detail') return {
        callRef: 'real-video-ref',
        title: '真实用户',
        mediaType: 'video',
        startedAtMillis: 1,
        acceptedAtMillis: 1,
        endedAtMillis: 12,
        durationSeconds: 11,
        callResult: 'NormalEnd',
        resultLabel: '已接通',
        summaryStatus: 'done',
        summaryText: '真实视频摘要',
        transcriptPending: false,
        transcriptFailed: false,
        videoRecord: {
          available: true,
          source: 'real',
          videoUrl: 'https://media.example/self-view.mp4',
          posterUrl: 'https://media.example/self-view.jpg',
          perspectives: [
            { perspective: 'self', label: '你的视角', videoUrl: 'https://media.example/self-view.mp4', posterUrl: 'https://media.example/self-view.jpg' },
            { perspective: 'peer', label: '真实用户', videoUrl: 'https://media.example/peer-view.mp4', posterUrl: 'https://media.example/peer-view.jpg' },
          ],
        },
        participants: [
          { userId: 27035, displayName: '你', isCurrentUser: true, avatarRef: 'avatar-me' },
          { userId: 27470, displayName: '真实用户', avatarRef: 'avatar-peer' },
        ],
        transcriptSegments: [
          { segmentId: 'seg-peer', speakerDisplayName: '真实用户', speakerUserId: 27470, text: '这是真实用户说的话。', startMillis: 0, endMillis: 1 },
          { segmentId: 'seg-me', speakerDisplayName: '你', speakerUserId: 27035, text: '这是我回复的话。', startMillis: 1, endMillis: 2 },
        ],
      }
      if (operation === 'sources.list') return { directory: 'root', items: [], hasMore: false }
      if (operation === 'image.read') return { mediaType: 'image/png', dataBase64: 'AAA=' }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface />)
      await tick()
      await tick()
    })

    await act(async () => {
      buttonByTexts(renderer, '真实用户', '视频通话', '00:11').props.onClick()
      await tick()
      await tick()
    })

    expect(renderer.root.findAllByType('video')).toHaveLength(0)
    expect(renderer.root.findByProps({ alt: '你的视角视频通话记录画面' }).props.src).toBe('https://media.example/self-view.jpg')
    expect(renderer.root.findByProps({ alt: '真实用户的视角视频通话记录小窗' }).props.src).toBe('https://media.example/peer-view.jpg')
    const titleRow = renderer.root.findByProps({ 'data-arkme-call-video-title-row': 'aligned' })
    expect(titleRow.props.style.width).toBe('100%')
    expect(titleRow.props.style.justifyContent).toBe('space-between')
    expect(titleRow.props.style.margin).toBe('0 auto')
    const switchButton = renderer.root.findByProps({ 'data-arkme-call-video-title-action': 'switch-perspective' })
    expect(textContent(switchButton.props.children)).toContain('切换视角')
    expect(switchButton.props.style.background)
      .toBe('var(--dsw-alias-button-elevated-fill, var(--dsw-alias-bg-layer-2, #ffffff))')
    expect(switchButton.props.style.gap).toBe(6)
    const transcriptHeader = renderer.root.findByProps({ 'data-arkme-call-transcript-header': 'aligned' })
    expect(transcriptHeader.props.style.justifyContent).toBe('flex-start')
    expect(transcriptHeader.props.style.gap).toBe(8)
    expect(transcriptHeader.props.style.borderBottom)
      .toBe('1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04))')
    const transcriptTitle = renderer.root.findAllByType('h3').find(item => textContent(item.props.children) === '通话转写')
    expect(transcriptTitle?.props.style.fontSize).toBe(14)
    const transcriptCount = renderer.root.findAllByType('span').find(item => textContent(item.props.children) === '2 段对话')
    expect(transcriptCount?.props.style.fontSize).toBe(11)

    await act(async () => {
      renderer.root.findByProps({ alt: '你的视角视频通话记录画面' }).props.onError()
      await tick()
    })
    expect(renderer.root.findAllByType('video').map(video => video.props.src)).toEqual(['https://media.example/self-view.mp4'])
    expect(renderer.root.findByProps({ 'aria-label': '你的视角视频通话记录画面' }).props.controls).toBeUndefined()

    const playButton = buttonByLabel(renderer, '播放视频记录')
    expect(playButton.props.style.background).toBe('rgba(255,255,255,.88)')
    expect(playButton.props.style.color).toBe('#171923')

    await act(async () => {
      playButton.props.onClick()
      await tick()
    })

    let videos = renderer.root.findAllByType('video')
    expect(videos.map(video => video.props.src)).toEqual([
      'https://media.example/self-view.mp4',
      'https://media.example/peer-view.mp4',
    ])
    expect(videos.every(video => video.props.controls === false)).toBe(true)
    const controls = renderer.root.findByProps({ 'data-arkme-call-video-controls': 'overlay' })
    expect(controls.props['aria-label']).toBe('视频播放控制')
    expect(controls.props.style.position).toBe('absolute')
    expect(controls.props.style.bottom).toBe(0)
    expect(renderer.root.findAllByProps({ alt: '林小满示例主画面' })).toHaveLength(0)
    expect(textContent(renderer.toJSON())).not.toContain('功能示例 · 完整保留双方画面')
    expect(renderer.root.findAllByType('small').map(item => textContent(item.props.children)).join('\n')).toContain('真实用户')
    expect(renderer.root.findAllByType('small').map(item => textContent(item.props.children)).join('\n')).toContain('你')
    expect(renderer.root.findAllByProps({ 'aria-label': '真实用户头像' }).length).toBeGreaterThan(0)
    expect(renderer.root.findAllByProps({ 'aria-label': '你头像' }).length).toBeGreaterThan(0)

    await act(async () => {
      buttonByText(renderer, '切换视角').props.onClick()
      await tick()
    })

    videos = renderer.root.findAllByType('video')
    expect(videos.map(video => video.props.src)).toEqual(['https://media.example/self-view.mp4'])
    expect(renderer.root.findByProps({ alt: '真实用户的视角视频通话记录画面' }).props.src).toBe('https://media.example/peer-view.jpg')
    expect(renderer.root.findByProps({ 'aria-label': '你的视角视频通话记录小窗' }).props.controls).toBeUndefined()
  })

  it('uses the same visual style for real-call audio and video buttons', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return {
        items: [{
          callRef: 'real-call-2',
          stableId: 'real-call-2',
          peerDisplayName: '小林',
          mediaType: 'audio',
          startedAtMillis: 1,
          acceptedAtMillis: 1,
          endedAtMillis: 2,
          durationSeconds: 1,
          callResult: 'NormalEnd',
          resultLabel: '已接通',
          summaryStatus: 'idle',
          canOpenDetail: false,
          canRedial: true,
        }],
        recentContacts: [],
        hasMore: false,
      }
      if (operation === 'sources.list') return { directory: 'root', items: [], hasMore: false }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface />)
      await tick()
      await tick()
    })
    await act(async () => {
      buttonByText(renderer, '小林').props.onClick()
      await tick()
    })

    expect(buttonByLabel(renderer, '和小林视频通话').props.style).toEqual(buttonByLabel(renderer, '和小林语音通话').props.style)
  })

  it('uses the same visual style for recommended contact audio and video buttons', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return { items: [], recentContacts: [], hasMore: false }
      if (operation === 'sources.list') return {
        directory: 'root',
        items: [{
          sourceRef: 'source-market',
          kind: 'private_chat',
          displayName: '菜市场',
          activeAtMillis: 1,
          unreadCount: 0,
        }],
        hasMore: false,
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface initialPickerOpen />)
      await tick()
      await tick()
    })

    expect(buttonByLabel(renderer, '和即我作者视频通话').props.style).toEqual(buttonByLabel(renderer, '和即我作者语音通话').props.style)
    const recommendation = renderer.root.findByProps({ 'aria-label': '推荐联系人' })
    expect(textContent(recommendation)).toContain('即我作者')
    expect(textContent(recommendation)).toContain('即我作者 · 推荐')
    expect(textContent(recommendation)).not.toContain('菜市场')
    const picker = renderer.root.findByProps({ 'aria-label': '选择通话联系人' })
    expect(picker.props.style.overflowY).toBe('auto')
    expect(picker.props.style.height).toBe('min(620px, calc(100vh - 48px))')
    expect(renderer.root.findByProps({ 'data-arkme-call-picker-list': 'true' }).props.style.overflowY).toBe('visible')
  })

  it('renders the official author public profile without opening a private chat', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return { items: [], recentContacts: [], hasMore: false }
      if (operation === 'sources.list') return { directory: 'root', items: [], hasMore: false }
      if (operation === 'chat.official-author.profile') return {
        userId: 11,
        displayName: '阿森',
        avatarRef: 'author-avatar-ref',
      }
      if (operation === 'image.read') return {
        mediaType: 'image/png',
        dataBase64: 'iVBORw0KGgo=',
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface initialPickerOpen />)
      await tick()
      await tick()
      await tick()
      await tick()
    })

    const recommendation = renderer.root.findByProps({ 'aria-label': '推荐联系人' })
    expect(textContent(recommendation)).toContain('阿森')
    expect(textContent(recommendation)).toContain('即我作者 · 推荐')
    expect(buttonByLabel(renderer, '和阿森视频通话')).toBeTruthy()
    expect(mocks.callArkme).toHaveBeenCalledWith('chat.official-author.profile', {}, expect.any(AbortSignal))
    expect(mocks.callArkme).not.toHaveBeenCalledWith('chat.official-author.private.open')
  })

  it('deduplicates the official author from private and recent contacts by user identity', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return {
        items: [],
        recentContacts: [
          { userId: 11, displayName: 'Tison' },
          { userId: 77, displayName: '小林' },
        ],
        hasMore: false,
      }
      if (operation === 'sources.list') return {
        directory: 'root',
        items: [
          {
            sourceRef: 'author-source',
            sourceKey: 'source-key-author',
            peerUserId: 11,
            kind: 'private_chat',
            displayName: 'Tison',
            activeAtMillis: 2,
            unreadCount: 0,
          },
          {
            sourceRef: 'xiaolin-source',
            sourceKey: 'source-key-xiaolin',
            peerUserId: 77,
            kind: 'private_chat',
            displayName: '小林',
            activeAtMillis: 1,
            unreadCount: 0,
          },
        ],
        hasMore: false,
      }
      if (operation === 'chat.official-author.profile') return {
        userId: 11,
        displayName: 'Tison@即我',
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface initialPickerOpen />)
      await tick()
      await tick()
      await tick()
    })

    const picker = renderer.root.findByProps({ 'aria-label': '选择通话联系人' })
    const content = textContent(picker)
    expect(content).toContain('Tison@即我')
    expect(content).toContain('即我作者 · 推荐')
    expect(content).not.toContain('Tison私聊联系人')
    expect(content).not.toContain('Tison最近联系人')
    expect(buttonByTexts(renderer, '小林', '私聊联系人')).toBeTruthy()
  })

  it('opens the official author chat owner before starting a recommended author call', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return { items: [], recentContacts: [], hasMore: false }
      if (operation === 'sources.list') return {
        directory: 'root',
        items: [{
          sourceRef: 'source-market',
          kind: 'private_chat',
          displayName: '菜市场',
          activeAtMillis: 1,
          unreadCount: 0,
        }],
        hasMore: false,
      }
      if (operation === 'chat.official-author.private.open') return {
        source: {
          sourceRef: 'source-official-author',
          kind: 'private_chat',
          displayName: '真正作者',
          activeAtMillis: 2,
          unreadCount: 0,
        },
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface initialPickerOpen />)
      await tick()
      await tick()
    })

    await act(async () => {
      buttonByLabel(renderer, '和即我作者视频通话').props.onClick()
      await tick()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('chat.official-author.private.open')
    expect(mocks.callArkme).not.toHaveBeenCalledWith('chat.private.open', expect.anything())
    expect(mocks.outgoingCallRequest).toHaveBeenCalledWith({
      sourceRef: 'source-official-author',
      displayName: '真正作者',
      mediaType: 'video',
    })
  })

  it('keeps the contact picker open when choosing a contact row call type', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return { items: [], recentContacts: [], hasMore: false }
      if (operation === 'sources.list') return {
        directory: 'root',
        items: [{
          sourceRef: 'source-lucis',
          kind: 'private_chat',
          displayName: 'lucis',
          activeAtMillis: 1,
          unreadCount: 0,
        }],
        hasMore: false,
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface initialPickerOpen />)
      await tick()
      await tick()
    })

    await act(async () => {
      buttonByTexts(renderer, 'lucis', '私聊联系人').props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ left: 230, top: 260 }),
        },
      })
      await tick()
    })

    expect(renderer.root.findByProps({ 'aria-label': '选择通话联系人' })).toBeTruthy()
    expect(renderer.root.findByProps({ 'aria-label': '选择和lucis的通话方式' })).toBeTruthy()
  })

  it('starts calls directly from recent-contact picker action icons', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return { items: [], recentContacts: [], hasMore: false }
      if (operation === 'sources.list') return {
        directory: 'root',
        items: [
          {
            sourceRef: 'source-market',
            kind: 'private_chat',
            displayName: '菜市场',
            activeAtMillis: 1,
            unreadCount: 0,
          },
          {
            sourceRef: 'source-lucis',
            kind: 'private_chat',
            displayName: 'lucis',
            activeAtMillis: 2,
            unreadCount: 0,
          },
        ],
        hasMore: false,
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface initialPickerOpen />)
      await tick()
      await tick()
    })

    expect(buttonByLabel(renderer, '直接和lucis视频通话').findByProps({ 'data-arkme-call-video-icon': 'compact' }).props.src)
      .toBe('/arkme-self/api/call/arkme-video-linear.svg')

    await act(async () => {
      buttonByLabel(renderer, '直接和lucis视频通话').props.onClick()
      await tick()
    })

    expect(mocks.outgoingCallRequest).toHaveBeenCalledWith({
      sourceRef: 'source-lucis',
      displayName: 'lucis',
      mediaType: 'video',
    })

    mocks.outgoingCallRequest.mockClear()
    await act(async () => {
      renderer = create(<ArkmeCallSurface initialPickerOpen />)
      await tick()
      await tick()
    })
    await act(async () => {
      buttonByLabel(renderer, '直接和lucis语音通话').props.onClick()
      await tick()
    })

    expect(mocks.outgoingCallRequest).toHaveBeenCalledWith({
      sourceRef: 'source-lucis',
      displayName: 'lucis',
      mediaType: 'audio',
    })
  })

  it('starts a call by searching an exact Arkme id in the picker', async () => {
    vi.useFakeTimers()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return { items: [], recentContacts: [], hasMore: false }
      if (operation === 'sources.list') return { directory: 'root', items: [], hasMore: false }
      if (operation === 'contacts.search') return {
        contactRef: 'arkme-contact-v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        identifierKind: 'arkme_id',
        displayName: '木白',
        arkmeId: 'mbr_sylj',
        avatarRef: 'avatar-mubai',
        registered: true,
        inviteBySms: false,
        canAdd: false,
        isSelf: false,
      }
      if (operation === 'image.read') return { mediaType: 'image/png', dataBase64: 'iVBORw0KGgo=' }
      if (operation === 'chat.private.open-from-contact') return {
        source: {
          sourceRef: 'source-mubai',
          kind: 'private_chat',
          displayName: '木白',
          activeAtMillis: 2,
          unreadCount: 0,
        },
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface initialPickerOpen />)
      await tick()
      await tick()
    })

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '搜索私聊联系人' }).props.onChange({
        currentTarget: { value: '@mbr' },
      })
      await tick()
    })

    expect(mocks.callArkme).not.toHaveBeenCalledWith('contacts.search', expect.anything(), expect.anything())
    const pickerContent = textContent(renderer.root.findByProps({ 'aria-label': '选择通话联系人' }).props.children)
    expect(pickerContent).toContain('搜索结果')
    expect(pickerContent).not.toContain('最近联系人')

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '搜索私聊联系人' }).props.onChange({
        currentTarget: { value: '@mbr_sylj' },
      })
      await tick()
    })

    await act(async () => {
      vi.advanceTimersByTime(279)
      await tick()
    })
    expect(mocks.callArkme).not.toHaveBeenCalledWith('contacts.search', expect.anything(), expect.anything())

    await act(async () => {
      vi.advanceTimersByTime(1)
      await tick()
      await tick()
      await tick()
    })

    expect(textContent(renderer.toJSON())).toContain('木白')
    expect(textContent(renderer.toJSON())).toContain('即我号 · 可发起通话')

    await act(async () => {
      buttonByLabel(renderer, '直接和木白视频通话').props.onClick()
      await tick()
      await tick()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('contacts.search', { identifier: '@mbr_sylj' }, expect.any(AbortSignal))
    expect(mocks.callArkme).toHaveBeenCalledWith('chat.private.open-from-contact', {
      contactRef: 'arkme-contact-v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
    expect(mocks.callArkme).not.toHaveBeenCalledWith('contacts.add', expect.anything())
    expect(mocks.outgoingCallRequest).toHaveBeenCalledWith({
      sourceRef: 'source-mubai',
      displayName: '木白',
      mediaType: 'video',
    })
  })

  it('opens the call-type picker only when clicking the recent-contact picker row body', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return { items: [], recentContacts: [], hasMore: false }
      if (operation === 'sources.list') return {
        directory: 'root',
        items: [{
          sourceRef: 'source-lucis',
          kind: 'private_chat',
          displayName: 'lucis',
          activeAtMillis: 2,
          unreadCount: 0,
        }],
        hasMore: false,
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface initialPickerOpen />)
      await tick()
      await tick()
    })

    await act(async () => {
      buttonByLabel(renderer, '选择lucis通话方式').props.onClick()
      await tick()
    })

    expect(mocks.outgoingCallRequest).not.toHaveBeenCalled()
    const content = textContent(renderer.toJSON())
    expect(content).toContain('语音通话')
    expect(content).toContain('视频通话')
    expect(content).toContain('仅使用麦克风')
    expect(content).toContain('使用摄像头和麦克风')
  })

  it('anchors the recent-contact call-type picker near the clicked contact', async () => {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800 })
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return {
        items: [],
        recentContacts: [{ userId: 77, displayName: '小林' }],
        hasMore: false,
      }
      if (operation === 'sources.list') return { directory: 'root', items: [], hasMore: false }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface />)
      await tick()
      await tick()
    })

    expect(renderer.root.findByProps({ 'data-arkme-call-recent-contacts': 'rail' }).props.style.margin).toBe('0 0 13px')

    await act(async () => {
      buttonByLabel(renderer, '选择小林通话方式').props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ left: 92, top: 118 }),
        },
      })
      await tick()
    })

    const typePicker = renderer.root.findByProps({ 'aria-label': '选择和小林的通话方式' })
    expect(typePicker.props['data-arkme-call-type-picker-placement']).toBe('anchored')
    expect(typePicker.props.style.position).toBe('absolute')
    expect(typePicker.props.style.left).toBe(82)
    expect(typePicker.props.style.top).toBe(104)
  })

  it('shows an empty transcript state and no video record for an unanswered cancelled video call', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'calls.history.list') return {
        items: [{
          callRef: 'cancelled-video-ref',
          stableId: 'cancelled-video',
          peerDisplayName: '未接通用户',
          mediaType: 'video',
          startedAtMillis: 1,
          acceptedAtMillis: 0,
          endedAtMillis: 2,
          durationSeconds: 0,
          callResult: 'Canceled',
          resultLabel: '已取消',
          summaryStatus: 'idle',
          canOpenDetail: true,
          canRedial: true,
        }],
        recentContacts: [],
        hasMore: false,
      }
      if (operation === 'calls.history.detail') return {
        callRef: 'cancelled-video-ref',
        title: '未接通用户',
        mediaType: 'video',
        startedAtMillis: 1,
        acceptedAtMillis: 0,
        endedAtMillis: 2,
        durationSeconds: 0,
        callResult: 'Canceled',
        resultLabel: '已取消',
        summaryStatus: 'idle',
        transcriptPending: false,
        transcriptFailed: false,
        participants: [],
        transcriptSegments: [],
      }
      if (operation === 'sources.list') return { directory: 'root', items: [], hasMore: false }
      throw new Error(`unexpected operation ${operation}`)
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeCallSurface />)
      await tick()
      await tick()
    })
    await act(async () => {
      buttonByTexts(renderer, '未接通用户', '视频通话', '00:00').props.onClick()
      await tick()
      await tick()
    })

    const content = textContent(renderer.toJSON())
    expect(content).toContain('暂无转写内容')
    expect(content).toContain('0 段对话')
    expect(renderer.root.findAllByProps({ 'aria-label': '视频记录' })).toHaveLength(0)
    expect(content).not.toContain('视频记录暂不可用')
  })
})
