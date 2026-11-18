import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ConversationHistoryStatus } from '../src/client/ConversationHistoryStatus.js'
import { arkmeTheme } from '../src/client/arkme-theme.js'

it('keeps normal paging neutral and stable, with retry reserved for failure', async () => {
  const onLoad = vi.fn(); let r!: ReactTestRenderer
  try {
    await act(async () => { r = create(<ConversationHistoryStatus loading={false} error="" canLoad onLoad={onLoad} />) })
    const status = () => r.root.findByProps({ 'data-arkme-history-status': true })
    expect(status().props.role).toBe('status')
    expect(status().props.style.color).toBe(arkmeTheme.secondary)
    const height = status().props.style.minHeight
    await act(async () => r.root.findByType('button').props.onClick())
    expect(onLoad).toHaveBeenCalledOnce()
    await act(async () => r.update(<ConversationHistoryStatus loading error="" canLoad onLoad={onLoad} />))
    expect(status().props.style.minHeight).toBe(height)
    expect(r.root.findAllByType('button')).toHaveLength(0)
    await act(async () => r.update(<ConversationHistoryStatus loading={false} error="读取失败" canLoad onLoad={onLoad} />))
    expect(status().props.role).toBe('alert')
    expect(r.root.findByType('button').props.children).toBe('重试加载更早消息')
  } finally { await act(async () => r.unmount()) }
})
