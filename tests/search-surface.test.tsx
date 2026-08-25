import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeGlobalSearchDialog, ArkmeSearchSurface, RecordRow } from '../src/client/ArkmeSearchSurface.js'
import type { ArkmeSearchRecordItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {
    body = { message: this.message }
  },
}))

function content(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(content).join('')
  if (value !== null && typeof value === 'object' && 'children' in value) {
    return content((value as { children?: unknown }).children)
  }
  if (value !== null && typeof value === 'object' && 'props' in value) {
    return content((value as { props?: { children?: unknown } }).props?.children)
  }
  return ''
}

function arkmeResults() {
  return {
    items: [{
      recordUid: 'record-1', sourceKind: 3, sourceUid: 'source-1', routeTargetKind: 'chat_timeline', sendAtMillis: 1,
      title: '发布会快记', textContent: 'Arkme 中的发布会记录', snippet: 'Arkme 中的发布会记录', media: [], files: [],
      sourceTitle: '发布会项目群',
      targetSource: { sourceRef: 'source-ref-1', kind: 'group_chat', displayName: '发布会项目群', activeAtMillis: 1, unreadCount: 0 },
    }],
    sourceAggregates: [{ sourceKind: 1, sourceUid: 'source-1', routeTargetKind: 'source', title: '发布会项目群', matchedRecordCount: 1, matchedRecordCountExact: true }],
    hasMore: false, queryGuard: { state: 'ok' }, itemCount: 1,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  })
  mocks.callArkme.mockReset()
  mocks.callArkme.mockImplementation(async (operation: string) => {
    if (operation === 'search.history') return { items: [], hasMore: false }
    if (operation === 'search.records') return arkmeResults()
    if (operation === 'search.recordings') return { items: [{ sessionId: 'recording-1', dateStamp: 1, startAtMillis: 2, snippet: '发布会录音转写', score: 1 }], hasMore: false, queryGuard: { state: 'ok' } }
    if (operation === 'search.history.create') return { created: true }
    throw new Error(`unexpected Arkme call: ${operation}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Arkme search surface', () => {
  it('starts with quick-note search and exposes image, AI video, and voice quick entries', () => {
    const markup = renderToStaticMarkup(<ArkmeSearchSurface />)

    expect(markup).toContain('placeholder="搜索对话、快记或消息"')
    expect(markup).toContain('viewBox="0 0 256 256"')
    expect(markup).toContain('fill="#a3a7af"')
    expect(markup).not.toContain('>搜索</button>')
    expect(markup).toContain('/arkme-self/api/call/gallery-linear.svg')
    expect(markup).toContain('/arkme-self/api/call/arkme-video-linear.svg')
    expect(markup).toContain('>图片</span>')
    expect(markup).toContain('AI 视频')
    expect(markup).toContain('>语音</span>')
    for (const label of ['图片/视频', '录音', '外部链接', '文件', '长文']) expect(markup).not.toContain(label)
  })

  it('keeps the search results and AI video entry in the desktop document flow', async () => {
    const source = await readFile(new URL('../src/client/ArkmeSearchSurface.tsx', import.meta.url), 'utf8')
    const mediaRouteSource = await readFile(new URL('../src/rich-media-routes.ts', import.meta.url), 'utf8')

    expect(source).not.toContain("height: 'min(600px, calc(100vh - 96px))'")
    expect(source).not.toContain("width: 'min(470px, 100%)'")
    expect(source).toContain("gridTemplateColumns: 'repeat(5, minmax(0, 1fr))'")
    expect(source).toContain("{ key: 'image', label: '图片', tabLabel: '图片库' }")
    expect(source).toContain("{ key: 'ai_video', label: 'AI 视频', tabLabel: 'AI 视频' }")
    expect(source).toContain("{ key: 'audio', label: '语音', tabLabel: '语音' }")
    expect(source).toContain('if (!active) void loadQuick(entry.key)')
    expect(source).toContain("controller.signal.aborted ? '加载超时，请重试'")
    expect(source).toContain('if (items.length === 0) return <><Status')
    expect(source).toContain("new IntersectionObserver(entries =>")
    expect(source).toContain("rootMargin: '240px 0px'")
    expect(source).toContain('{loadMoreSentinel}</>')
    expect(source).not.toContain("'加载更多'")
    expect(source).toContain('hasCachedPage')
    expect(source).toContain("src={`${assetRoot}/arrow_left.svg`}")
    expect(mediaRouteSource).toContain("'private, max-age=86400, immutable'")
    expect(mediaRouteSource).toContain("contentType.toLowerCase().startsWith('image/')")
  })

  it('renders the unified search as a modal that retains current Arkme quick entries', () => {
    const markup = renderToStaticMarkup(<ArkmeGlobalSearchDialog onClose={vi.fn()} />)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-label="全局搜索"')
    expect(markup).toContain('aria-label="关闭全局搜索"')
    expect(markup).toContain('width:min(1480px, 84vw, calc(100vw - 48px))')
    expect(markup).toContain('height:min(940px, 84vh, calc(100vh - 48px))')
    expect(markup).toContain('background:color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 22%, transparent)')
    expect(markup).toContain('backdrop-filter:blur(3px)')
    expect(markup).not.toContain('blur(12px)')
    expect(markup).toContain('>图片</span>')
    expect(markup).toContain('AI 视频')
    expect(markup).toContain('>语音</span>')
  })

  it('matches the Demo empty-state hierarchy with history and quick-find pills', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'search.history') return { items: [{ keyword: '发布会' }, { keyword: '客户案例' }], hasMore: false }
      if (operation === 'search.records') return arkmeResults()
      if (operation === 'search.history.create') return { created: true }
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface variant="dialog" onClose={vi.fn()} />)
      await Promise.resolve()
    })

    const sections = renderer.root.findAllByType('section').filter(section => ['搜索历史', '快速查找'].includes(section.props['aria-label']))
    expect(sections.map(section => section.props['aria-label'])).toEqual(['搜索历史', '快速查找'])
    const historyPill = renderer.root.findAllByType('button').find(button => content(button.props.children) === '发布会')
    const quickPill = renderer.root.findAllByType('button').find(button => content(button.props.children) === '图片')
    expect(historyPill?.props.style).toMatchObject({ minHeight: 40, borderRadius: 12, border: 0 })
    expect(quickPill?.props.style).toMatchObject({ minHeight: 44, borderRadius: 12 })
    expect(quickPill?.props.style.border).toContain('1px solid')
    act(() => { renderer.unmount() })
  })

  it('keeps quick-category responses when switching from the unified search view', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'search.history') return { items: [], hasMore: false }
      if (operation === 'images.list') return {
        items: [{
          itemKey: 'image-1', mediaRef: 'media-ref-1', recordUid: 'record-1', sendAtMillis: Date.now(),
          fileName: '产品截图.png', mimeType: 'image/png', size: 128, recordTitle: '产品截图',
        }],
        hasMore: false,
        queryGuard: { state: 'ok' },
      }
      if (operation === 'ai-video.list') return {
        items: [{
          jobId: 'video-1', sessionId: 'session-1', status: 'succeeded', stage: 'succeeded', progress: 100,
          selectedSegmentCount: 1, title: '周会视频', sourceStartedAtMillis: 1, createdAtMillis: 1,
          updatedAtMillis: 1, retryable: false,
        }],
        hasMore: false,
      }
      if (operation === 'search.scene') return {
        ...arkmeResults(),
        items: [{
          ...arkmeResults().items[0], recordUid: 'voice-record-1', title: '发布会语音', snippet: '语音内容',
          voice: { fileAssetUid: 'voice-asset-1', mediaRef: 'voice-media-ref-1', fileName: '发布会.m4a', mimeType: 'audio/mp4', durationMillis: 12_000 },
        }],
      }
      if (operation === 'files.assets') return [{ fileAssetUid: 'voice-asset-1', downloadUrl: '/voice.m4a' }]
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface variant="dialog" onClose={vi.fn()} />)
      await Promise.resolve()
    })

    const imageEntry = renderer.root.findAllByType('button').find(button => content(button.props.children) === '图片')
    await act(async () => { imageEntry?.props.onClick(); await Promise.resolve() })
    expect(renderer.root.findAllByProps({ alt: '产品截图.png' })).toHaveLength(1)

    const videoTab = renderer.root.findAllByType('button').find(button => content(button.props.children) === 'AI 视频')
    await act(async () => { videoTab?.props.onClick(); await Promise.resolve() })
    expect(content(renderer.toJSON())).toContain('周会视频')

    const audioTab = renderer.root.findAllByType('button').find(button => content(button.props.children) === '语音')
    await act(async () => { audioTab?.props.onClick(); await Promise.resolve(); await Promise.resolve() })
    expect(content(renderer.toJSON())).toContain('发布会语音')
    expect(content(renderer.toJSON())).toContain('语音内容')
    expect(content(renderer.toJSON())).toContain('0:12')
    const audioControl = renderer.root.findByProps({ 'aria-label': '播放语音，时长 0:12' })
    expect(audioControl.props.disabled).toBe(false)
    const transcript = renderer.root.findAllByType('p').find(node => content(node.props.children) === '语音内容')
    expect(transcript?.props.style).toMatchObject({ color: expect.stringContaining('label-primary'), fontSize: 14, fontWeight: 500 })
    expect(renderer.root.findAllByType('audio')).toHaveLength(1)
    expect(renderer.root.findByType('audio').props.controls).toBeUndefined()
    expect(renderer.root.findByType('audio').props.src).toBe('/arkme-self/api/media?ref=voice-media-ref-1')
    expect(mocks.callArkme).toHaveBeenCalledWith('search.scene', { scene: 'audio', limit: 50 }, expect.any(AbortSignal))
    act(() => { renderer.unmount() })
  })

  it('opens a concrete search hit in its owning conversation instead of a detail modal', async () => {
    const onOpenRecord = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface variant="dialog" onOpenRecord={onOpenRecord} onClose={vi.fn()} />)
      await Promise.resolve()
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '搜索' }).props.onChange({ target: { value: '发布会' } })
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
    })

    const result = renderer.root.findAllByType('button').find(button => content(button.props.children).includes('发布会快记'))
    act(() => { result?.props.onClick() })
    expect(onOpenRecord).toHaveBeenCalledWith(expect.objectContaining({
      recordUid: 'record-1',
      targetSource: expect.objectContaining({ sourceRef: 'source-ref-1' }),
    }))
    expect(content(renderer.toJSON())).not.toContain('返回搜索结果')
    act(() => { renderer.unmount() })
  })

  it('resolves a chat voice lazily from its owning timeline before playback', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'search.history') return { items: [], hasMore: false }
      if (operation === 'search.scene') return {
        ...arkmeResults(),
        items: [{
          ...arkmeResults().items[0], recordUid: 'voice-record-1', textContent: '这段转写需要突出显示', snippet: '',
          voice: { fileAssetUid: 'voice-asset-1', durationMillis: 3_000 },
        }],
      }
      if (operation === 'files.assets') return []
      if (operation === 'source.timeline') return {
        source: arkmeResults().items[0]?.targetSource,
        items: [{
          itemUid: 'voice-record-1', senderName: 'JoJo', isMe: false, sendAtMillis: 1, title: '',
          textContent: '这段转写需要突出显示', status: 1, sequence: 1,
          contentBlocks: [{
            kind: 'audio', mediaRef: 'timeline-audio-ref', fileAssetUid: 'voice-asset-1',
            fileName: 'voice.m4a', mimeType: 'audio/mp4', size: 128, sortOrder: 0,
          }],
        }],
        hasMore: false,
      }
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface variant="dialog" onClose={vi.fn()} />)
      await Promise.resolve()
    })
    const audioTab = renderer.root.findAllByType('button').find(button => content(button.props.children) === '语音')
    await act(async () => { audioTab?.props.onClick(); await Promise.resolve(); await Promise.resolve() })
    const play = renderer.root.findByProps({ 'aria-label': '播放语音，时长 0:03' })
    await act(async () => { play.props.onClick(); await Promise.resolve(); await Promise.resolve() })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.timeline', {
      sourceRef: 'source-ref-1', limit: 100,
    }, expect.any(AbortSignal))
    expect(renderer.root.findByType('audio').props.src).toBe('/arkme-self/api/media?ref=timeline-audio-ref')
    const transcript = renderer.root.findAllByType('p').find(node => content(node.props.children) === '这段转写需要突出显示')
    expect(transcript?.props.style.color).toContain('label-primary')
    act(() => { renderer.unmount() })
  })

  it('separates the input clear action from the modal close action', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface variant="dialog" onClose={vi.fn()} />)
      await Promise.resolve()
    })
    act(() => {
      renderer.root.findByProps({ 'aria-label': '搜索' }).props.onChange({ target: { value: '测试' } })
    })

    const clear = renderer.root.findByProps({ 'aria-label': '清空搜索' })
    const close = renderer.root.findByProps({ 'aria-label': '关闭全局搜索' })
    expect(clear.parent?.type).toBe('div')
    expect(clear.parent?.props.style).toMatchObject({ flex: 1, background: expect.any(String) })
    expect(close.parent?.type).toBe('div')
    expect(close.parent).not.toBe(clear.parent)
    expect(close.parent?.props.style).toMatchObject({ display: 'flex', gap: 12 })
    act(() => { renderer.unmount() })
  })

  it('restores the client search categories and opens the selected DSH task from its own result structure', async () => {
    const openDshSession = vi.fn()
    const searchDshMessages = vi.fn(async () => ({
      items: [{ sessionId: 'session-7', title: '发布会方案', snippet: '请整理发布会讲稿', updatedAtMillis: 2 }],
      hasMore: false,
    }))
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface
        variant="dialog"
        searchDshMessages={searchDshMessages}
        onOpenDshSession={openDshSession}
        onClose={vi.fn()}
      />)
      await Promise.resolve()
    })

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '搜索' }).props.onChange({ target: { value: '发布会' } })
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
    })

    expect(searchDshMessages).toHaveBeenCalledWith('发布会', expect.any(AbortSignal))
    const resultNav = renderer.root.findByProps({ 'aria-label': '全局搜索结果类型' })
    expect(resultNav.props.style).not.toHaveProperty('borderBottom')
    expect(resultNav.findAllByType('button').map(button => content(button.props.children))).toEqual(['快记', '主题', '录音·转写', 'DSH'])
    expect(content(renderer.toJSON())).toContain('发布会快记')
    const dshTab = resultNav.findAllByType('button').find(button => content(button.props.children) === 'DSH')
    act(() => { dshTab?.props.onClick() })
    expect(content(renderer.toJSON())).toContain('1个关联DSH任务')
    expect(content(renderer.toJSON())).toContain('发布会方案')
    const dshRow = renderer.root.findAllByType('button').find(button => content(button.props.children).includes('发布会方案'))
    expect(dshRow).toBeDefined()
    act(() => { dshRow?.props.onClick() })
    expect(openDshSession).toHaveBeenCalledWith('session-7')
    act(() => { renderer.unmount() })
  })

  it('keeps Arkme results usable when DSH search fails', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface
        variant="dialog"
        searchDshMessages={async () => { throw new Error('DSH 离线') }}
        onClose={vi.fn()}
      />)
      await Promise.resolve()
    })

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '搜索' }).props.onChange({ target: { value: '发布会' } })
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
    })

    const allText = content(renderer.toJSON())
    expect(allText).toContain('发布会快记')
    const dshTab = renderer.root.findAllByType('button').find(button => content(button.props.children) === 'DSH')
    act(() => { dshTab?.props.onClick() })
    expect(content(renderer.toJSON())).toContain('DSH 任务暂不可用：DSH 离线')
    act(() => { renderer.unmount() })
  })

  it('uses distinct topic and recording result layouts', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface variant="dialog" searchDshMessages={async () => ({ items: [], hasMore: false })} onClose={vi.fn()} />)
      await Promise.resolve()
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '搜索' }).props.onChange({ target: { value: '发布会' } })
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
    })

    const topicTab = renderer.root.findAllByType('button').find(button => content(button.props.children) === '主题')
    act(() => { topicTab?.props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '主题搜索结果' }).props.style).toMatchObject({ display: 'grid' })
    expect(content(renderer.toJSON())).toContain('1个关联主题')
    expect(content(renderer.toJSON())).toContain('记录详情')

    const recordingTab = renderer.root.findAllByType('button').find(button => content(button.props.children) === '录音·转写')
    act(() => { recordingTab?.props.onClick() })
    expect(content(renderer.toJSON())).toContain('1个关联录音')
    expect(content(renderer.toJSON())).toContain('发布会录音转写')
    act(() => { renderer.unmount() })
  })

  it('does not repeat a generated title as the result summary', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'search.history') return { items: [], hasMore: false }
      if (operation === 'search.records') return {
        ...arkmeResults(),
        items: [{
          ...arkmeResults().items[0],
          title: '重复的快记标题',
          textContent: '重复的快记标题',
          snippet: '重复的快记标题',
        }],
      }
      if (operation === 'search.history.create') return { created: true }
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface variant="dialog" onClose={vi.fn()} />)
      await Promise.resolve()
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '搜索' }).props.onChange({ target: { value: '重复' } })
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
    })

    expect(renderer.root.findAllByType('p').filter(node => content(node.props.children) === '重复的快记标题')).toHaveLength(1)
    act(() => { renderer.unmount() })
  })

  it('aborts a stale DSH request when the query changes', async () => {
    const signals: AbortSignal[] = []
    const searchDshMessages = vi.fn((_: string, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<{ items: []; hasMore: false }>(() => undefined)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface variant="dialog" searchDshMessages={searchDshMessages} onClose={vi.fn()} />)
      await Promise.resolve()
    })
    const input = renderer.root.findByProps({ 'aria-label': '搜索' })

    await act(async () => {
      input.props.onChange({ target: { value: '第一条' } })
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)
    await act(async () => {
      input.props.onChange({ target: { value: '第二条' } })
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(signals[0]?.aborted).toBe(true)
    expect(signals).toHaveLength(2)
    act(() => { renderer.unmount() })
  })

  it('keeps image-library text search scoped to Arkme records', async () => {
    const searchDshMessages = vi.fn(async () => ({ items: [], hasMore: false }))
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface variant="dialog" searchDshMessages={searchDshMessages} onClose={vi.fn()} />)
      await Promise.resolve()
    })
    const imageEntry = renderer.root.findAllByType('button').find(button => content(button.props.children) === '图片')
    await act(async () => { imageEntry?.props.onClick(); await Promise.resolve() })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '搜索快记' }).props.onChange({ target: { value: '发布会' } })
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('search.records', { query: '发布会', limit: 50 }, expect.any(AbortSignal))
    expect(searchDshMessages).not.toHaveBeenCalled()
    act(() => { renderer.unmount() })
  })

  it('renders DSH Agent input search records with the shared marker instead of the hidden topic name', () => {
    const item: ArkmeSearchRecordItem = {
      recordUid: 'record-dsh-input',
      sourceKind: 1,
      routeTargetKind: 'topic',
      sendAtMillis: new Date(2026, 7, 25, 11, 9).getTime(),
      title: '',
      textContent: '测试搜索',
      snippet: '测试搜索',
      creationSource: 3,
      sourceTitle: 'DSH Agent Input',
      media: [],
      files: [],
    }

    const markup = renderToStaticMarkup(<RecordRow item={item} onClick={() => {}} />)

    expect(markup).toContain('data-arkme-dsh-agent-input-marker="true"')
    expect(markup).toContain('DSH Agent 输入')
    expect(markup).toContain('fill="currentColor"')
    expect(markup).not.toContain('DSH Agent Input')

    const legacyItem: ArkmeSearchRecordItem = { ...item }
    delete legacyItem.creationSource
    const legacyMarkup = renderToStaticMarkup(<RecordRow item={legacyItem} onClick={() => {}} />)

    expect(legacyMarkup).toContain('data-arkme-dsh-agent-input-marker="true"')
    expect(legacyMarkup).toContain('DSH Agent 输入')
    expect(legacyMarkup).not.toContain('DSH Agent Input')
  })
})
