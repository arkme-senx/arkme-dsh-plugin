import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeGlobalSearchDialog, ArkmeSearchSurface, RecordRow } from '../src/client/ArkmeSearchSurface.js'
import type { ArkmeSearchRecordItem } from '../src/types.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn(), hasDsh: vi.fn() }))

vi.mock('../src/client/DeepSeekHarnessSurface.js', () => ({ hasEmbeddedDshSession: mocks.hasDsh }))

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
  mocks.hasDsh.mockReset()
  mocks.callArkme.mockImplementation(async (operation: string) => {
    if (operation === 'search.conversations') return { items: [], hasMore: false }
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
  it('finds a name on a later directory page and opens it without requiring a content hit', async () => {
    const original = mocks.callArkme.getMockImplementation()!
    const target = { sourceRef: 'private-ref', kind: 'private_chat', displayName: '周鹏', privateNickname: '狗才', activeAtMillis: 1, unreadCount: 0 }
    const selected = vi.spyOn(arkmeUi, 'selectSource').mockImplementation(() => {})
    const onClose = vi.fn()
    mocks.callArkme.mockImplementation(async (op, params, signal) => {
      if (op === 'search.conversations') return params.cursor ? { items: [{ sourceKind: 3, sourceUid: 'private-zhou', title: '周鹏', nickname: '狗才', targetSource: target }], hasMore: false }
        : { items: [], hasMore: true, nextCursor: 'next' }
      if (op === 'search.records') return { ...arkmeResults(), items: [], sourceAggregates: [] }
      return original(op, params, signal)
    })
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(<ArkmeSearchSurface onClose={onClose} />) })
      act(() => {
        renderer.root.findByProps({ 'aria-label': '搜索' }).props.onChange({ target: { value: '狗才' } })
      })
      act(() => { renderer.root.findAllByType('button').find(button => content(button.props.children) === '主题')!.props.onClick() })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      const row = renderer.root.findByProps({ title: '单击查看关联快记，双击打开会话' })
      expect(content(row.props.children)).toContain('周鹏昵称：狗才名称匹配 · 私聊')
      expect(content(row.props.children)).not.toContain('0条')
      expect(mocks.callArkme.mock.calls.filter(([op]) => op === 'search.conversations').map(([, params]) => params)).toEqual([{ query: '狗才' }, { query: '狗才', cursor: 'next' }])
      await act(async () => { await row.props.onClick() })
      expect(content(renderer.toJSON())).toContain('已匹配会话名称，没有匹配的消息内容')
      await act(async () => { renderer.root.findAllByType('button').find(button => content(button.props.children) === '打开会话')!.props.onClick() })
      expect(selected).toHaveBeenCalledExactlyOnceWith(target)
      expect(onClose).toHaveBeenCalledOnce()
    } finally { act(() => { renderer?.unmount() }); selected.mockRestore() }
  })

  it('deduplicates name and content matches and prioritizes the remark without changing the count', async () => {
    const original = mocks.callArkme.getMockImplementation()!
    const target = { ...arkmeResults().items[0]!.targetSource, kind: 'private_chat', displayName: '周鹏', privateNickname: '狗才' }
    mocks.callArkme.mockImplementation(async (op, params, signal) => {
      if (op === 'search.conversations') return { items: [{ sourceKind: 3, sourceUid: 'source-1', title: '周鹏', targetSource: target }], hasMore: false }
      if (op === 'search.records') return { ...arkmeResults(), sourceAggregates: [
        { ...arkmeResults().sourceAggregates[0], sourceKind: 3, sourceUid: 'another', title: '其他会话' },
        { ...arkmeResults().sourceAggregates[0], sourceKind: 3, title: '狗才', matchedRecordCount: 23, matchedRecordCountExact: true },
      ] }
      return original(op, params, signal)
    })
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(<ArkmeSearchSurface initialQuery="周鹏" />) })
      act(() => { renderer.root.findAllByType('button').find(button => content(button.props.children) === '主题')!.props.onClick() })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      const rows = renderer.root.findAllByProps({ title: '单击查看关联快记，双击打开会话' })
      expect(rows).toHaveLength(2)
      expect(content(rows[0]!.props.children)).toBe('周鹏昵称：狗才23条关联快记')
    } finally { act(() => { renderer?.unmount() }) }
  })

  it('isolates a scoped error from the source list and clears it after successful retry', async () => {
    const original = mocks.callArkme.getMockImplementation()!
    let fail = true
    mocks.callArkme.mockImplementation(async (op, params, signal) => {
      if (op === 'search.records' && params?.sourceUid && fail) throw new Error('临时失败')
      return original(op, params, signal)
    })
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(<ArkmeSearchSurface initialQuery="发布会" />) })
      act(() => { renderer.root.findAllByType('button').find(button => content(button.props.children) === '主题')!.props.onClick() })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      await act(async () => { renderer.root.findByProps({ title: '单击查看关联快记，双击打开会话' }).props.onClick() })
      expect(content(renderer.root.findByProps({ role: 'alert' }).props.children)).toContain('该会话查询失败：临时失败')
      expect(content(renderer.toJSON())).not.toContain('主题暂不可用')
      expect(content(renderer.toJSON())).not.toContain('内容查找暂不可用')
      fail = false
      await act(async () => { renderer.root.findAllByType('button').find(button => content(button.props.children) === '重试')!.props.onClick() })
      expect(content(renderer.toJSON())).not.toContain('临时失败')
      expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
      expect(content(renderer.toJSON())).toContain('Arkme 中的发布会记录')
    } finally { act(() => { renderer?.unmount() }) }
  })

  it('keeps content results when name search fails, with an independent retry', async () => {
    const original = mocks.callArkme.getMockImplementation()!
    let fail = true
    mocks.callArkme.mockImplementation(async (op, params, signal) => {
      if (op === 'search.conversations' && fail) throw new Error('网络暂不可用')
      return original(op, params, signal)
    })
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(<ArkmeSearchSurface initialQuery="发布会" />) })
      act(() => { renderer.root.findAllByType('button').find(button => content(button.props.children) === '主题')!.props.onClick() })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(content(renderer.toJSON())).toContain('会话名称查找未完成')
      expect(content(renderer.toJSON())).toContain('发布会项目群')
      fail = false
      act(() => { renderer.root.findAllByType('button').find(button => content(button.props.children) === '重试名称查找')!.props.onClick() })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(content(renderer.toJSON())).not.toContain('网络暂不可用')
      expect(mocks.callArkme.mock.calls.filter(([op]) => op === 'search.records')).toHaveLength(1)
    } finally { act(() => { renderer?.unmount() }) }
  })
  it.each(['快记', '主题', '录音·转写'])('never shows an empty result during the debounce window: %s', async tab => {
    const original = mocks.callArkme.getMockImplementation()!
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      if (operation === 'search.records' || operation === 'search.recordings') {
        await pending
        return { items: [], sourceAggregates: [], hasMore: false, queryGuard: { state: 'ok' } }
      }
      return original(operation, params, signal)
    })
    const initial = renderToStaticMarkup(<ArkmeSearchSurface initialQuery="武汉" />)
    expect(initial).toContain('搜索中')
    expect(initial).not.toContain('暂无相关内容')
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(<ArkmeSearchSurface />) })
      act(() => {
        renderer.root.findByProps({ 'aria-label': '搜索' }).props.onChange({ target: { value: '武汉' } })
      })
      act(() => { renderer.root.findAllByType('button').find(button => content(button.props.children) === tab)!.props.onClick() })
      expect(content(renderer.toJSON())).toContain('搜索中')
      expect(content(renderer.toJSON())).not.toContain('暂无相关内容')
      await act(async () => { await vi.advanceTimersByTimeAsync(299) })
      expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'search.records')).toBe(false)
      expect(content(renderer.toJSON())).not.toContain('暂无相关内容')
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(content(renderer.toJSON())).toContain('搜索中')
      await act(async () => { finish(); await pending })
      expect(content(renderer.toJSON())).toContain('暂无相关内容')
      act(() => { renderer.root.findByProps({ 'aria-label': '搜索' }).props.onChange({ target: { value: '北京' } }) })
      expect(content(renderer.toJSON())).toContain('搜索中')
      expect(content(renderer.toJSON())).not.toContain('暂无相关内容')
    } finally { act(() => { renderer?.unmount() }) }
  })

  it.each(['double-click', 'Enter', 'uncached', 'unavailable'] as const)('opens the matching source from topic results: %s', async mode => {
    const target = arkmeResults().items[0]!.targetSource
    const selectSource = vi.spyOn(arkmeUi, 'selectSource').mockImplementation(() => {})
    const onClose = vi.fn()
    mocks.callArkme.mockImplementation(async (operation: string, params?: { sourceUid?: string }) => {
      if (operation === 'search.records') return {
        ...arkmeResults(),
        items: mode === 'unavailable' || (mode === 'uncached' && params?.sourceUid === undefined) ? [] : arkmeResults().items,
        sourceAggregates: [{ ...arkmeResults().sourceAggregates[0]!, sourceKind: 3 }],
      }
      if (operation === 'search.history' || operation === 'search.recordings') return { items: [], hasMore: false }
      if (operation === 'search.history.create') return { created: true }
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(<ArkmeSearchSurface initialQuery="发布会" onClose={onClose} />) })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      act(() => { renderer.root.findAllByType('button').find(button => content(button.props.children) === '主题')!.props.onClick() })
      const row = () => renderer.root.findByProps({ title: '单击查看关联快记，双击打开会话' })
      if (mode === 'double-click') {
        await act(async () => { row().props.onClick(); row().props.onClick() })
        expect(selectSource).not.toHaveBeenCalled()
        expect(onClose).not.toHaveBeenCalled()
      }
      await act(async () => {
        if (mode === 'Enter') row().props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() })
        else row().props.onDoubleClick()
      })
      if (mode === 'unavailable') {
        expect(selectSource).not.toHaveBeenCalled()
        expect(onClose).not.toHaveBeenCalled()
        expect(content(renderer.toJSON())).toContain('暂时无法打开该会话，请重试')
      } else {
        expect(selectSource).toHaveBeenCalledExactlyOnceWith(target)
        expect(onClose).toHaveBeenCalledOnce()
      }
    } finally {
      act(() => { renderer?.unmount() })
      selectSource.mockRestore()
    }
  })

  it('starts with quick-note search and exposes image, voice, file, and long-article quick entries', () => {
    const markup = renderToStaticMarkup(<ArkmeSearchSurface />)

    expect(markup).toContain('placeholder="搜索对话、快记或消息"')
    expect(markup).toContain('viewBox="0 0 256 256"')
    expect(markup).toContain('fill="#a3a7af"')
    expect(markup).not.toContain('>搜索</button>')
    expect(markup).toContain('/arkme-self/api/call/gallery-linear.svg')
    expect(markup).not.toContain('/arkme-self/api/call/arkme-video-linear.svg')
    expect(markup).toContain('>图片</span>')
    expect(markup).not.toContain('AI 视频')
    expect(markup).toContain('>语音</span>')
    expect(markup).toContain('>文件</span>')
    expect(markup).toContain('>长文</span>')
    expect(markup).toContain('>外部链接</span>')
    for (const label of ['图片/视频', '录音']) expect(markup).not.toContain(label)
  })

  it('keeps search results in the desktop document flow without AI video', async () => {
    const source = await readFile(new URL('../src/client/ArkmeSearchSurface.tsx', import.meta.url), 'utf8')
    const mediaRouteSource = await readFile(new URL('../src/rich-media-routes.ts', import.meta.url), 'utf8')

    expect(source).not.toContain("height: 'min(600px, calc(100vh - 96px))'")
    expect(source).not.toContain("width: 'min(470px, 100%)'")
    expect(source).toContain("gridTemplateColumns: 'repeat(5, minmax(0, 1fr))'")
    expect(source).toContain("{ key: 'image', label: '图片', tabLabel: '图片库' }")
    expect(source).not.toContain("{ key: 'ai_video', label: 'AI 视频', tabLabel: 'AI 视频' }")
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
    expect(markup).not.toContain('AI 视频')
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

  it('prefills a clicked tag, uses global search, and lets result tags replace the active search', async () => {
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'search.history') return { items: [], hasMore: false }
      if (operation === 'search.records') return {
        ...arkmeResults(),
        items: [{
          ...arkmeResults().items[0],
          title: '标签快记',
          textContent: `进展 #${String(params?.query === '#项目' ? '下一个' : '完成')}`,
          snippet: `进展 #${String(params?.query === '#项目' ? '下一个' : '完成')}`,
        }],
        sourceAggregates: [],
      }
      if (operation === 'search.recordings') return { items: [], hasMore: false, queryGuard: { state: 'ok' } }
      if (operation === 'search.history.create') return { created: true }
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface initialQuery="＃项目" initialQueryRevision={1} />)
      await Promise.resolve(); await Promise.resolve()
    })

    expect(renderer.root.findByProps({ 'aria-label': '搜索' }).props.value).toBe('#项目')
    expect(mocks.callArkme).toHaveBeenCalledWith('search.records', { query: '#项目', limit: 50 }, expect.any(AbortSignal))
    expect(mocks.callArkme).toHaveBeenCalledWith('search.recordings', { query: '#项目', limit: 50 }, expect.any(AbortSignal))
    expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'records.tags.query')).toBe(false)
    expect(renderer.root.findAllByProps({ role: 'link' })).toHaveLength(1)

    await act(async () => {
      renderer.root.findByProps({ role: 'link' }).props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() })
      await Promise.resolve(); await Promise.resolve()
    })
    expect(renderer.root.findByProps({ 'aria-label': '搜索' }).props.value).toBe('#下一个')
    expect(mocks.callArkme).toHaveBeenCalledWith('search.records', { query: '#下一个', limit: 50 }, expect.any(AbortSignal))
    act(() => { renderer.unmount() })
  })

  it.each(['page', 'dialog'] as const)('keeps remaining quick entries usable without AI video in %s', async variant => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'search.history') return { items: [], hasMore: false }
      if (operation === 'images.list') return { items: [], hasMore: false }
      if (operation === 'search.scene' || operation === 'files.search') return { items: [], hasMore: false }
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeSearchSurface variant={variant} />) })
    for (const label of ['图片', '语音', '外部链接', '文件', '长文']) {
      const entry = renderer.root.findAllByType('button').find(button => content(button.props.children) === label)
      expect(entry).toBeDefined()
      await act(async () => { entry!.props.onClick(); await vi.advanceTimersByTimeAsync(1) })
      expect(content(renderer.toJSON())).not.toContain('AI 视频')
      expect(renderer.root.findAllByType('header').flatMap(header => header.findAllByType('button')).map(button => content(button.props.children))).toEqual(['', '图片库', '语音', '外部链接', '文件', '长文'])
      await act(async () => { renderer.root.findByProps({ 'aria-label': '返回搜索' }).props.onClick() })
      expect(renderer.root.findByProps({ 'aria-label': '搜索' }).props.value).toBe('')
    }
    expect(mocks.callArkme.mock.calls.map(([operation]) => operation)).toEqual(['search.history', 'images.list', 'search.scene', 'search.scene', 'files.search', 'search.scene'])
    expect(mocks.callArkme).toHaveBeenCalledWith('search.scene', { scene: 'link', limit: 30 }, expect.any(AbortSignal))
    expect(mocks.callArkme).toHaveBeenCalledWith('search.scene', { scene: 'long_article', limit: 30 }, expect.any(AbortSignal))
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
    await act(async () => { renderer.root.findByProps({ title: '产品截图' }).props.onClick() })
    const preview = renderer.root.findByProps({ role: 'dialog' })
    expect(preview.findByType('img').props.alt).toBe('产品截图.png')
    expect(preview.findAllByType('video')).toHaveLength(0)
    await act(async () => { preview.findByType('button').props.onClick() })
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)

    const videoTab = renderer.root.findAllByType('button').find(button => content(button.props.children) === 'AI 视频')
    expect(videoTab).toBeUndefined()
    expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'ai-video.list')).toBe(false)

    const audioTab = renderer.root.findAllByType('button').find(button => content(button.props.children) === '语音')
    await act(async () => { audioTab?.props.onClick(); await Promise.resolve(); await Promise.resolve() })
    expect(content(renderer.toJSON())).toContain('发布会语音')
    expect(content(renderer.toJSON())).toContain('语音内容')
    expect(content(renderer.toJSON())).toContain('0:12')
    const audioControl = renderer.root.findByProps({ 'aria-label': '播放语音，时长 0:12' })
    expect(audioControl.props.disabled).toBe(false)
    const transcript = renderer.root.findByProps({ 'data-arkme-voice-transcript': 'true' })
    expect(content(transcript)).toBe('语音内容')
    expect(renderer.root.findByProps({ 'data-arkme-voice': 'inline' }).props.style).toMatchObject({ color: 'inherit', fontSize: 15 })
    expect(audioControl.props.style).toMatchObject({ background: 'transparent', border: 0, padding: 0, gap: 5 })
    expect(audioControl.props.style.borderRadius).toBeUndefined()
    expect(renderer.root.findAllByType('audio')).toHaveLength(1)
    expect(renderer.root.findByType('audio').props.controls).toBeUndefined()
    expect(renderer.root.findByType('audio').props.src).toBe('/arkme-self/api/media?ref=voice-media-ref-1')
    expect(mocks.callArkme).toHaveBeenCalledWith('search.scene', { scene: 'audio', limit: 50 }, expect.any(AbortSignal))
    act(() => { renderer.unmount() })
  })

  it.each(['dialog', 'page'] as const)('keeps long quick-find content scrollable in %s layout', async variant => {
    const count = 60
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'search.history') return { items: [], hasMore: false }
      if (operation === 'images.list') return {
        items: Array.from({ length: count }, (_, index) => ({
          itemKey: `image-${index}`, mediaRef: `image-ref-${index}`, recordUid: `record-${index}`,
          sendAtMillis: 1, fileName: `图片-${index}.png`, recordTitle: `图片-${index}`,
        })),
        hasMore: false,
      }
      if (operation === 'search.scene') return {
        ...arkmeResults(),
        items: Array.from({ length: count }, (_, index) => ({
          ...arkmeResults().items[0], recordUid: `voice-${index}`,
          voice: { fileAssetUid: `voice-asset-${index}`, mediaRef: `voice-ref-${index}`, durationMillis: 12_000 },
        })),
      }
      if (operation === 'search.records') return arkmeResults()
      if (operation === 'search.history.create') return { created: true }
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeSearchSurface variant={variant} />) })
    for (const [label, itemType] of [['图片', 'img'], ['语音', 'audio']] as const) {
      await act(async () => {
        renderer.root.findAllByType('button').find(button => content(button.props.children) === label)?.props.onClick()
      })
      const body = renderer.root.findByType('main')
      expect(body.findAllByType(itemType)).toHaveLength(count)
      if (variant === 'dialog') {
        expect(body.parent?.props.style).toMatchObject({ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 })
        expect(renderer.root.findByType('header').props.style).toMatchObject({ flex: 'none' })
        expect(body.props.style).toMatchObject({ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehaviorY: 'contain' })
        expect(body.props.tabIndex).toBe(0)
      } else {
        expect(body.props.style.overflowY).toBeUndefined()
        expect(body.parent?.props.style.flex).toBeUndefined()
      }
    }
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '搜索快记' }).props.onChange({ target: { value: '发布会' } })
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(content(renderer.toJSON())).toContain('发布会快记')
    if (variant === 'dialog') expect(renderer.root.findByType('main').props.style.overflowY).toBe('auto')
    act(() => { renderer.unmount() })
  })

  it.each(['dialog', 'page'] as const)('loads the next image page against the %s scroll viewport', async variant => {
    const scrollNode = {}
    const observerOptions: IntersectionObserverInit[] = []
    const disconnect = vi.fn()
    let intersect!: (entries: Array<{ isIntersecting: boolean }>) => void
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof intersect, options: IntersectionObserverInit) {
        intersect = callback
        observerOptions.push(options)
      }
      observe() {}
      disconnect = disconnect
    })
    mocks.callArkme.mockImplementation(async (operation: string, params?: { cursor?: string }) => {
      if (operation === 'search.history') return { items: [], hasMore: false }
      if (operation === 'images.list') return {
        items: [{
          itemKey: params?.cursor ?? 'first', mediaRef: 'image-ref', recordUid: 'image-record',
          sendAtMillis: 1, fileName: `${params?.cursor ?? 'first'}.png`, recordTitle: '图片',
        }],
        hasMore: params?.cursor === undefined, nextCursor: params?.cursor === undefined ? 'next' : undefined,
      }
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeSearchSurface variant={variant} />, {
        createNodeMock: element => element.type === 'main' ? scrollNode : {},
      })
    })
    await act(async () => {
      renderer.root.findAllByType('button').find(button => content(button.props.children) === '图片')?.props.onClick()
    })
    expect(observerOptions).toHaveLength(1)
    expect(observerOptions[0]?.root).toBe(variant === 'dialog' ? scrollNode : null)
    expect(observerOptions[0]?.rootMargin).toBe('240px 0px')
    await act(async () => { intersect([{ isIntersecting: true }]) })
    expect(mocks.callArkme).toHaveBeenCalledWith('images.list', { limit: 50, cursor: 'next' })
    expect(renderer.root.findByType('main').findAllByType('img')).toHaveLength(2)
    act(() => { renderer.unmount() })
    expect(disconnect).toHaveBeenCalled()
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

  it.each([undefined, 42])('resolves a chat voice with owner %s before playback', async recordOwnerUserId => {
    const audio = { src: '', play: vi.fn(async () => undefined), pause: vi.fn() }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'search.history') return { items: [], hasMore: false }
      if (operation === 'search.scene') return {
        ...arkmeResults(),
        items: [{
          ...arkmeResults().items[0], recordUid: 'voice-record-1', recordOwnerUserId, textContent: '这段转写需要突出显示', snippet: '',
          voice: { fileAssetUid: 'voice-asset-1', durationMillis: 3_000 },
        }],
      }
      if (operation === 'files.assets') return []
      if (operation === (recordOwnerUserId === undefined ? 'source.timeline' : 'source.timeline-around')) return {
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
      renderer = create(<ArkmeSearchSurface variant="dialog" onClose={vi.fn()} />, { createNodeMock: node => node.type === 'audio' ? audio : null })
      await Promise.resolve()
    })
    const audioTab = renderer.root.findAllByType('button').find(button => content(button.props.children) === '语音')
    await act(async () => { audioTab?.props.onClick(); await Promise.resolve(); await Promise.resolve() })
    const play = renderer.root.findByProps({ 'aria-label': '播放语音，时长 0:03' })
    await act(async () => { play.props.onClick(); await Promise.resolve(); await Promise.resolve() })

    expect(mocks.callArkme.mock.calls.some(([op]) => op === 'source.timeline')).toBe(false)
    if (recordOwnerUserId === undefined) {
      expect(audio.play).not.toHaveBeenCalled()
      expect(mocks.callArkme.mock.calls.some(([op]) => op === 'source.timeline-around')).toBe(false)
      await act(async () => renderer.unmount())
      return
    }
    expect(mocks.callArkme).toHaveBeenCalledWith('source.timeline-around', {
      sourceRef: 'source-ref-1', itemUid: 'voice-record-1', recordOwnerUserId, beforeLimit: 1, afterLimit: 1,
    }, expect.any(AbortSignal))
    expect(audio.src).toBe('/arkme-self/api/media?ref=timeline-audio-ref')
    expect(audio.play).toHaveBeenCalledOnce()
    expect(renderer.root.findByProps({ 'data-arkme-voice': 'inline' }).props['data-arkme-voice-state']).toBe('playing')
    const transcript = renderer.root.findByProps({ 'data-arkme-voice-transcript': 'true' })
    expect(content(transcript)).toBe('这段转写需要突出显示')
    act(() => { renderer.unmount() })
  })

  it.each([3, 4])('uses inline voice kind %s for ordinary search hits even without voice metadata', async (templateKind) => {
    const onClick = vi.fn()
    const item: ArkmeSearchRecordItem = {
      ...arkmeResults().items[0]!,
      templateKind, recordDurationMillis: 2_000, snippet: '转写 https://example.com',
    }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<RecordRow item={item} onClick={onClick} />) })
    const play = renderer.root.findByProps({ 'aria-label': '播放语音，时长 0:02' })
    const stopPropagation = vi.fn()
    await act(async () => { play.props.onClick({ stopPropagation }); await Promise.resolve() })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onClick).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ 'data-arkme-text-link': 'true' }).props.href).toBe('https://example.com')
    const navigation = renderer.root.findByProps({ role: 'button' })
    const ElementStub = class {
      closest(selector: string) { return selector.includes('a') ? this : null }
    }
    vi.stubGlobal('Element', ElementStub)
    act(() => { navigation.props.onClick({ target: new ElementStub() }) })
    expect(onClick).not.toHaveBeenCalled()
    act(() => { navigation.props.onClick({ target: {} }) })
    expect(onClick).toHaveBeenCalledOnce()
    const target = {}
    act(() => { navigation.props.onKeyDown({ key: 'Enter', target, currentTarget: {}, preventDefault: vi.fn() }) })
    expect(onClick).toHaveBeenCalledOnce()
    act(() => { navigation.props.onKeyDown({ key: 'Enter', target, currentTarget: target, preventDefault: vi.fn() }) })
    expect(onClick).toHaveBeenCalledTimes(2)
    await act(async () => { renderer.unmount() })
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

  it.each(['double-click', 'Enter', 'unavailable'] as const)('opens DSH tasks from topics and keeps message navigation explicit: %s', async mode => {
    const openDshSession = vi.fn(() => { if (mode === 'unavailable') throw new Error('任务已移除') })
    const onClose = vi.fn()
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
        onClose={onClose}
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
    expect(resultNav.findAllByType('button').map(button => content(button.props.children))).toEqual(['快记', '主题', '录音·转写'])
    expect(content(renderer.toJSON())).toContain('发布会快记')
    const dshTab = resultNav.findAllByType('button').find(button => content(button.props.children) === '主题')
    act(() => { dshTab?.props.onClick() })
    expect(content(renderer.toJSON())).toContain('2个关联主题')
    expect(content(renderer.toJSON())).toContain('发布会方案')
    const dshRow = renderer.root.findAllByType('button').find(button => content(button.props.children).includes('发布会方案'))
    expect(dshRow).toBeDefined()
    act(() => { dshRow?.props.onClick() })
    expect(openDshSession).not.toHaveBeenCalled()
    expect(content(renderer.toJSON())).toContain('请整理发布会讲稿')
    expect(content(renderer.toJSON())).not.toContain('当前 DSH 暂不支持从搜索结果定位具体消息')
    const preventDefault = vi.fn()
    act(() => {
      if (mode === 'Enter') dshRow?.props.onKeyDown({ key: 'Enter', preventDefault })
      else dshRow?.props.onDoubleClick()
    })
    expect(openDshSession).toHaveBeenCalledExactlyOnceWith('session-7')
    if (mode === 'unavailable') {
      expect(onClose).not.toHaveBeenCalled()
      expect(content(renderer.toJSON())).toContain('任务已移除')
    } else expect(onClose).toHaveBeenCalledOnce()
    if (mode === 'Enter') expect(preventDefault).toHaveBeenCalledOnce()
    act(() => { renderer.unmount() })
  })

  it('keeps the DSH selection when an older Arkme source request settles', async () => {
    let resolveSource!: (value: ReturnType<typeof arkmeResults>) => void
    let sourceSignal!: AbortSignal
    const original = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation((operation: string, params: { sourceUid?: string }, signal: AbortSignal) => {
      if (operation === 'search.records' && params.sourceUid !== undefined) {
        sourceSignal = signal
        return new Promise(resolve => { resolveSource = resolve })
      }
      return original(operation, params, signal)
    })
    const searchDshMessages = async () => ({ items: [{ sessionId: 'source-1', title: '原生任务', snippet: 'DSH 命中摘要', updatedAtMillis: 2 }], hasMore: false })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeSearchSurface initialQuery="发布会" searchDshMessages={searchDshMessages} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    act(() => { renderer.root.findAllByType('button').find(button => content(button.props.children) === '主题')!.props.onClick() })
    act(() => { renderer.root.findByProps({ title: '单击查看关联快记，双击打开会话' }).props.onClick() })
    act(() => { renderer.root.findByProps({ title: '单击查看匹配摘要，双击打开 DSH 对话' }).props.onClick() })
    expect(sourceSignal.aborted).toBe(true)
    await act(async () => { resolveSource(arkmeResults()) })
    expect(content(renderer.toJSON())).toContain('DSH 命中摘要')
    expect(content(renderer.toJSON())).not.toContain('Arkme 中的发布会记录')
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
    const dshTab = renderer.root.findAllByType('button').find(button => content(button.props.children) === '主题')
    act(() => { dshTab?.props.onClick() })
    expect(content(renderer.toJSON())).toContain('DSH 任务暂不可用：DSH 离线')
    act(() => { renderer.unmount() })
  })

  it('keeps previous results visible and settles each search domain independently', async () => {
    let resolveRecords!: (value: ReturnType<typeof arkmeResults>) => void
    let resolveRecordings!: (value: { items: Array<{ sessionId: string; dateStamp: number; startAtMillis: number; snippet: string; score: number }>; hasMore: false; queryGuard: { state: 'ok' } }) => void
    mocks.callArkme.mockImplementation(async (operation: string, params?: { query?: string }) => {
      if (operation === 'search.history') return { items: [], hasMore: false }
      if (operation === 'search.history.create') return { created: true }
      if (operation === 'search.records' && params?.query === '第一条') return arkmeResults()
      if (operation === 'search.recordings' && params?.query === '第一条') return {
        items: [{ sessionId: 'old-recording', dateStamp: 1, startAtMillis: 2, snippet: '旧录音结果', score: 1 }],
        hasMore: false, queryGuard: { state: 'ok' },
      }
      if (operation === 'search.records' && params?.query === '第二条') {
        return await new Promise<ReturnType<typeof arkmeResults>>(resolve => { resolveRecords = resolve })
      }
      if (operation === 'search.recordings' && params?.query === '第二条') {
        return await new Promise(resolve => { resolveRecordings = resolve })
      }
      throw new Error(`unexpected Arkme call: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeSearchSurface variant="dialog" onClose={vi.fn()} />); await Promise.resolve() })
    const input = renderer.root.findByProps({ 'aria-label': '搜索' })

    await act(async () => {
      input.props.onChange({ target: { value: '第一条' } })
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
    })
    expect(content(renderer.toJSON())).toContain('发布会快记')

    await act(async () => {
      input.props.onChange({ target: { value: '第二条' } })
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(content(renderer.toJSON())).toContain('发布会快记')
    expect(renderer.root.findByProps({ 'aria-label': '正在搜索快记' })).toBeDefined()

    await act(async () => {
      const next = arkmeResults()
      resolveRecords({
        ...next,
        items: [{ ...next.items[0]!, recordUid: 'record-2', title: '第二条快记', textContent: '新结果', snippet: '新结果' }],
      })
      await Promise.resolve()
    })
    expect(content(renderer.toJSON())).toContain('第二条快记')
    expect(renderer.root.findAllByProps({ 'aria-label': '正在搜索快记' })).toHaveLength(0)

    act(() => {
      renderer.root.findAllByType('button').find(button => content(button.props.children) === '录音·转写')?.props.onClick()
    })
    expect(content(renderer.toJSON())).toContain('旧录音结果')
    expect(renderer.root.findByProps({ 'aria-label': '正在搜索录音·转写' })).toBeDefined()

    await act(async () => {
      resolveRecordings({
        items: [{ sessionId: 'new-recording', dateStamp: 1, startAtMillis: 3, snippet: '新录音结果', score: 1 }],
        hasMore: false, queryGuard: { state: 'ok' },
      })
      await Promise.resolve()
    })
    expect(content(renderer.toJSON())).toContain('新录音结果')
    act(() => { renderer.unmount() })
  })

  it('ignores a stale source-detail response after a newer source selection', async () => {
    let resolveA!: (value: ReturnType<typeof arkmeResults>) => void
    let resolveB!: (value: ReturnType<typeof arkmeResults>) => void
    const base = arkmeResults()
    mocks.callArkme.mockImplementation(async (operation: string, params?: { sourceUid?: string }) => {
      if (operation === 'search.history') return { items: [], hasMore: false }
      if (operation === 'search.history.create') return { created: true }
      if (operation === 'search.recordings') return { items: [], hasMore: false, queryGuard: { state: 'ok' } }
      if (operation === 'search.records' && params?.sourceUid === 'source-a') {
        return await new Promise<ReturnType<typeof arkmeResults>>(resolve => { resolveA = resolve })
      }
      if (operation === 'search.records' && params?.sourceUid === 'source-b') {
        return await new Promise<ReturnType<typeof arkmeResults>>(resolve => { resolveB = resolve })
      }
      if (operation === 'search.records') return {
        ...base,
        items: [
          { ...base.items[0]!, recordUid: 'record-a', sourceUid: 'source-a', sourceTitle: '主题 A', title: 'A 缓存' },
          { ...base.items[0]!, recordUid: 'record-b', sourceUid: 'source-b', sourceTitle: '主题 B', title: 'B 缓存' },
        ],
        sourceAggregates: [
          { ...base.sourceAggregates[0]!, sourceUid: 'source-a', title: '主题 A' },
          { ...base.sourceAggregates[0]!, sourceUid: 'source-b', title: '主题 B' },
        ],
        itemCount: 2,
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeSearchSurface variant="dialog" onClose={vi.fn()} />); await Promise.resolve() })
    const input = renderer.root.findByProps({ 'aria-label': '搜索' })
    await act(async () => { input.props.onChange({ target: { value: '主题' } }); await vi.advanceTimersByTimeAsync(300); await Promise.resolve() })
    act(() => { renderer.root.findAllByType('button').find(button => content(button.props.children) === '主题')?.props.onClick() })
    const sourceButtons = () => renderer.root.findAllByType('button')
    await act(async () => { sourceButtons().find(button => content(button.props.children).includes('主题 A'))?.props.onClick(); await Promise.resolve() })
    await act(async () => { sourceButtons().find(button => content(button.props.children).includes('主题 B'))?.props.onClick(); await Promise.resolve() })

    await act(async () => {
      resolveB({ ...base, items: [{ ...base.items[0]!, recordUid: 'record-b-new', title: 'B 最新结果' }] })
      await Promise.resolve()
    })
    await act(async () => {
      resolveA({ ...base, items: [{ ...base.items[0]!, recordUid: 'record-a-late', title: 'A 迟到结果' }] })
      await Promise.resolve()
    })

    expect(content(renderer.toJSON())).toContain('B 最新结果')
    expect(content(renderer.toJSON())).not.toContain('A 迟到结果')
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

    expect(legacyMarkup).not.toContain('data-arkme-dsh-agent-input-marker="true"')
    expect(legacyMarkup).not.toContain('DSH Agent 输入')
    expect(legacyMarkup).toContain('DSH Agent Input')
  })
})

it.each(['local', 'remote', 'legacy', 'error'] as const)('opens the local DSH conversation from a synced record: %s', async mode => {
 const record = { ...arkmeResults().items[0]!, creationSource: 3, sourceKind: 2, sourceUid: 'system:dsh',
   ...(mode === 'legacy' ? {} : { dshOrigin: { sessionId: 'native-session', eventSeq: 7 } }),
   targetSource: { sourceRef: 'topic-target', kind: 'topic', displayName: 'DSH Agent Input', activeAtMillis: 0, unreadCount: 0 } }
 mocks.hasDsh.mockImplementation(async () => { if (mode === 'error') throw new Error('列表读取失败'); return mode === 'local' })
 mocks.callArkme.mockImplementation(async (operation: string) => operation === 'search.records'
   ? { ...arkmeResults(), items: [record], sourceAggregates: [{ ...arkmeResults().sourceAggregates[0], sourceKind: 2, sourceUid: 'system:dsh', title: 'DSH Agent Input' }] }
   : { items: [], hasMore: false })
 const onOpenRecord = vi.fn(), onOpenDshSession = vi.fn(), onClose = vi.fn()
 let renderer!: ReactTestRenderer
 await act(async () => { renderer = create(<ArkmeSearchSurface initialQuery="武汉" onOpenRecord={onOpenRecord} onOpenDshSession={onOpenDshSession} onClose={onClose} />) })
 await act(async () => { await vi.advanceTimersByTimeAsync(300) })
 await act(async () => { renderer.root.findAllByType('button').find(button => content(button.props.children).includes('发布会快记'))?.props.onClick(); await Promise.resolve() })
 if (mode === 'local') { expect(onOpenDshSession).toHaveBeenCalledWith('native-session'); expect(onOpenRecord).not.toHaveBeenCalled() }
 else if (mode === 'error') { expect(onOpenRecord).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled(); expect(content(renderer.toJSON())).toContain('列表读取失败') }
 else { expect(onOpenRecord).toHaveBeenCalledWith(record); expect(onOpenDshSession).not.toHaveBeenCalled() }
 act(() => renderer.unmount())
})
