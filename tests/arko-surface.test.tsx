import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import {
  ArkmeArkoSurface, arkoHistoryHasTerminalRun, arkoPreservedScrollTop,
  arkoRunActivityLabel, latestActiveRun, mergeHistory, shouldShowArkoThinking,
} from '../src/client/ArkmeArkoSurface.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'

function historyItem(overrides: Partial<ArkmeArkoHistoryItem>): ArkmeArkoHistoryItem {
  return {
    messageId: 1,
    sessionId: 88,
    role: 'assistant',
    text: '',
    reasoning: '',
    createdAtMillis: 1_786_000_000_000,
    status: 2,
    createdRecordUids: [],
    ...overrides,
  }
}

describe('Arko surface', () => {
  it('exposes header whitespace for native dragging without marking its action toolbar', () => {
    const dom = new JSDOM(renderToStaticMarkup(<ArkmeArkoSurface />))
    try {
      const header = dom.window.document.querySelector('header')!
      expect(header.getAttribute('data-arkme-window-drag-region')).toBe('conversation')
      const copy = header.querySelector('[data-arkme-window-drag-copy]')!
      expect(copy?.getAttribute('data-arkme-window-drag-region')).toBe('conversation')
      expect(copy?.querySelector('h2')?.textContent).toBe('Arko')
      expect(header.querySelector('[role="toolbar"]')?.hasAttribute('data-arkme-window-drag-region')).toBe(false)
    } finally {
      dom.window.close()
    }
  })

  it('renders an Arko chat panel with loading and send controls', () => {
    const markup = renderToStaticMarkup(<ArkmeArkoSurface />)

    expect(markup).toContain('Arko')
    expect(markup).toContain('正在恢复会话')
    expect(markup).toContain('data-arkme-composer-editor-box')
    expect(markup).toContain('aria-label="选择表情"')
    expect(markup).toContain('<h2')
    expect(markup).toContain('Arko</h2>')
    expect(markup).toContain('内容由 AI 生成，仅供参考')
    expect(markup).not.toContain('data-arkme-topic-tag="Agent"')
    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain('aria-label="Arko 操作"')
    expect(markup).toContain('模型选择')
    expect(markup).toContain('清除上下文')
    expect(markup).not.toContain('aria-label="AI"')
    expect(markup).not.toContain('DeepSeek-R1满血版')
    expect(markup).not.toContain('状态同步失败')
    expect(markup).not.toContain('正在重试')
  })

  it('maps authoritative run states to the client-facing interaction labels', () => {
    expect(arkoRunActivityLabel('queued')).toBe('正在思考')
    expect(arkoRunActivityLabel('running')).toBe('正在处理')
    expect(arkoRunActivityLabel('waiting_tool')).toBe('等待客户端操作')
    expect(arkoRunActivityLabel('waiting_user')).toBe('等待你的补充')
    expect(arkoRunActivityLabel('completed')).toBe('已完成')
  })

  it('shows thinking only for an active message or real reasoning content', () => {
    expect(shouldShowArkoThinking('sending')).toBe(true)
    expect(shouldShowArkoThinking('done')).toBe(false)
    expect(shouldShowArkoThinking('done', '')).toBe(false)
    expect(shouldShowArkoThinking('done', '正在读取资料')).toBe(true)
  })

  it('uses matching terminal history as a silent fallback for status polling failures', () => {
    expect(arkoHistoryHasTerminalRun([
      historyItem({ messageId: 302, sessionId: 88, runUid: 'run-1', runStatus: 'completed', text: '最终回答' }),
    ], 88, 302, 'run-1')).toBe(true)
    expect(arkoHistoryHasTerminalRun([
      historyItem({ messageId: 302, sessionId: 88, runUid: 'run-1', runStatus: 'running', text: '正在处理' }),
    ], 88, 302, 'run-1')).toBe(false)
    expect(arkoHistoryHasTerminalRun([
      historyItem({ messageId: 302, sessionId: 77, runUid: 'run-1', runStatus: 'completed', text: '其他会话' }),
      historyItem({ messageId: 303, sessionId: 88, runUid: 'run-2', runStatus: 'completed', text: '其他任务' }),
    ], 88, 302, 'run-1')).toBe(false)
  })

  it('preserves the visible history position when older messages are prepended', () => {
    expect(arkoPreservedScrollTop(120, 900, 1_500)).toBe(720)
    expect(arkoPreservedScrollTop(0, 900, 850)).toBe(0)
  })

  it('restores only the newest active run from the current session', () => {
    const items = [
      historyItem({ messageId: 401, sessionId: 77, runUid: 'old-session', runStatus: 'running', createdAtMillis: 3000 }),
      historyItem({ messageId: 302, sessionId: 88, runUid: 'current-new', runStatus: 'queued', createdAtMillis: 2000 }),
      historyItem({ messageId: 301, sessionId: 88, runUid: 'current-old', runStatus: 'running', createdAtMillis: 1000 }),
    ]

    expect(latestActiveRun(items, 88)).toEqual({
      sessionId: 88,
      assistantMsgId: 302,
      runUid: 'current-new',
    })
  })

  it('orders same-second history by message id so the question precedes the answer', () => {
    const sameSecond = 1_786_000_000_000
    const messages = mergeHistory([], [
      historyItem({ messageId: 102, role: 'assistant', text: '回答', createdAtMillis: sameSecond, status: 1 }),
      historyItem({ messageId: 101, role: 'user', text: '问题', createdAtMillis: sameSecond, status: 1 }),
    ])

    expect(messages.map(message => message.messageId)).toEqual([101, 102])
  })
})
