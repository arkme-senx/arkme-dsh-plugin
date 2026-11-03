// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))
import { RecordThoughtEntry, RecordThoughtContent, RecordThoughtMessageFooter, RecordThoughtsProvider } from '../src/client/RecordThoughts.js'
import { ArkmeMessageTimestamp } from '../src/client/ArkmeMessageTimestamp.js'
const item = { itemUid: 'note', sendAtMillis: 1, isMe: true, version: 1 }
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers()
  mocks.callArkme.mockReset().mockResolvedValue({ accountScope: 'production:42', items: [{ id: 'one', recordUid: 'note', content: '**建议内容**', biz: 1 }] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const load = () => act(async () => vi.advanceTimersByTimeAsync(32))
function App({ enabled = true, scope = 'production:42', own = true }: { enabled?: boolean; scope?: string; own?: boolean }) {
  const [open, setOpen] = useState(false)
  const record = { ...item, isMe: own }
  return <RecordThoughtsProvider accountScope={scope} enabled={enabled}>
    <p>原始消息正文</p><RecordThoughtEntry item={record} onOpen={() => setOpen(true)}/>
    {open && <RecordThoughtContent item={record}/>}
  </RecordThoughtsProvider>
}
it('opens the full Markdown thought from a quiet message entry without a second read', async () => {
  await act(async () => root.render(<App/>)); await load()
  expect(host.textContent).toContain('Arko · 快记想法')
  expect(host.textContent).not.toContain('建议内容')
  await act(async () => host.querySelector<HTMLButtonElement>('[data-arkme-record-thought-entry]')!.click())
  expect(host.querySelector('[data-arkme-record-thought-content] strong')?.textContent).toBe('建议内容')
  await load(); expect(mocks.callArkme).toHaveBeenCalledOnce()
  expect(mocks.callArkme.mock.calls[0]!.slice(0, 2)).toEqual(['record.thoughts.query', { expectedAccountScope: 'production:42', recordUids: ['note'] }])
})
it('does not reserve space for empty results or expose entry UI outside the enabled self workspace', async () => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [] })
  await act(async () => root.render(<App/>)); await load()
  expect(host.textContent).toBe('原始消息正文')
  await act(async () => root.render(<App enabled={false}/>)); await load()
  expect(host.querySelector('[data-arkme-record-thought-entry]')).toBeNull()
  expect(mocks.callArkme).toHaveBeenCalledOnce()
})
it('never queries another author and clears old account content immediately on account switching', async () => {
  await act(async () => root.render(<App own={false}/>)); await load()
  expect(mocks.callArkme).not.toHaveBeenCalled()
  await act(async () => root.render(<App/>)); await load()
  expect(host.textContent).toContain('Arko · 快记想法')
  await act(async () => root.render(<App scope="production:7"/>))
  expect(host.textContent).not.toContain('Arko · 快记想法')
  await load(); expect(host.textContent).not.toContain('Arko · 快记想法')
})
it('allows a failed detail read to retry without changing the original message', async () => {
  mocks.callArkme.mockRejectedValueOnce(Error('offline'))
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" enabled>
    <p>原始消息正文</p><RecordThoughtContent item={item}/>
  </RecordThoughtsProvider>)); await load()
  expect(host.textContent).toContain('想法暂时无法读取')
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()); await load()
  expect(host.textContent).toContain('建议内容'); expect(host.textContent).toContain('原始消息正文')
  expect(host.textContent).not.toContain('暂时无法读取')
})

it('shows private chat suggestions beneath received messages and cycles candidates locally without sending', async () => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [{ id: 'suggestion', recordUid: 'note', content: '建议一', biz: 1, scene: 5, visibility: 'user', status: 'ready', generation: 1,
    display: { headline: '确认时间', context: '正在约定见面', warnings: [], suggestions: [{ style: '自然', items: ['建议一', '建议二'] }] } }] })
  const fill = vi.fn(), record = { ...item, isMe: false, messageActionRef: 'signed' }
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" sourceRef="chat-source" chat enabled onFill={fill}>
    <RecordThoughtEntry item={record} onOpen={() => {}}/><RecordThoughtContent item={record}/>
  </RecordThoughtsProvider>)); await load()
  expect(mocks.callArkme.mock.calls[0]!.slice(0, 2)).toEqual(['chat.thoughts.query', { expectedAccountScope: 'production:42', sourceRef: 'chat-source', messageActionRefs: ['signed'] }])
  expect(host.textContent).toContain('仅你可见'); expect(host.textContent).toContain('正在约定见面')
  const preview = host.querySelector('[data-arkme-thought-suggestion]')!
  await act(async () => [...preview.querySelectorAll('button')].find(button => button.textContent === '换一句')!.click())
  expect(preview.textContent).toContain('建议二')
  await act(async () => [...preview.querySelectorAll('button')].find(button => button.textContent === '填入输入框')!.click())
  expect(fill).toHaveBeenCalledExactlyOnceWith('建议二'); expect(mocks.callArkme).toHaveBeenCalledOnce()
})
it('separates group-public replies from private whispers and hides invalidated projections', async () => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [
    { id: 'public', recordUid: 'note', content: '公开回答', biz: 2, scene: 2, visibility: 'members', status: 'ready' },
    { id: 'private', recordUid: 'note', content: '私人分析', biz: 2, scene: 3, visibility: 'user', status: 'ready' },
    { id: 'old', recordUid: 'note', content: '旧建议', biz: 1, scene: 5, visibility: 'user', status: 'invalidated' },
  ] })
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" sourceRef="group" chat enabled>
    <RecordThoughtEntry item={{ ...item, messageActionRef: 'signed' }} onOpen={() => {}}/>
    <RecordThoughtContent item={{ ...item, messageActionRef: 'signed' }}/>
  </RecordThoughtsProvider>)); await load()
  expect(host.textContent).toContain('Arko · 回应'); expect(host.textContent).toContain('Arko · 私密想法')
  expect(host.textContent).toContain('公开回答'); expect(host.textContent).toContain('私人分析'); expect(host.textContent).not.toContain('旧建议')
  expect(host.querySelectorAll('[data-arkme-record-thought-entry] button')[0]?.textContent).not.toContain('仅你可见')
  expect(host.querySelectorAll('[data-arkme-record-thought-entry] button')[1]?.textContent).toContain('仅你可见')
})
it('shows generation and failure states without inventing a completed result or automatically generating', async () => {
  const fill = vi.fn()
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [{ id: 'pending', recordUid: 'note', content: '', biz: 2, scene: 1, status: 'generating' }] })
  const render = () => root.render(<RecordThoughtsProvider accountScope="production:42" sourceRef="chat" chat enabled onFill={fill}><RecordThoughtEntry item={{ ...item, messageActionRef: 'signed' }} onOpen={() => {}}/></RecordThoughtsProvider>)
  await act(async () => { render() }); await load(); expect(host.textContent).toContain('Arko 正在思考')
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [{ id: 'pending', recordUid: 'note', content: '', biz: 2, scene: 1, status: 'failed' }] })
  await act(async () => vi.advanceTimersByTimeAsync(4_032)); expect(host.textContent).toContain('暂时没能完成')
  await act(async () => host.querySelector('button')!.click()); expect(fill).toHaveBeenCalledExactlyOnceWith('@阿森 ', true)
  expect(mocks.callArkme.mock.calls.every(([operation]) => operation === 'chat.thoughts.query')).toBe(true)
})

it('keeps the thought entry and original clock inside the bubble and opens its detail once', async () => {
  const open = vi.fn(), bubbleClick = vi.fn(), scroll = vi.fn()
  HTMLElement.prototype.scrollIntoView = scroll
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" enabled>
    <div className="arkme-timed-bubble" onClick={bubbleClick}><p>短消息</p>
      <RecordThoughtMessageFooter item={item} onOpen={open}><ArkmeMessageTimestamp at={item.sendAtMillis}/></RecordThoughtMessageFooter>
    </div>
    <RecordThoughtContent item={item}/>
  </RecordThoughtsProvider>)); await load()
  const entry = host.querySelector<HTMLButtonElement>('[data-arkme-record-thought-entry]')!
  expect(entry.closest('.arkme-timed-bubble')).not.toBeNull()
  expect(entry.parentElement?.hasAttribute('data-arkme-thought-message-footer')).toBe(true)
  expect(entry.parentElement?.querySelector('time')?.dateTime).toBe(new Date(1).toISOString())
  await act(async () => entry.click())
  expect(open).toHaveBeenCalledOnce(); expect(bubbleClick).not.toHaveBeenCalled()
  expect(scroll).not.toHaveBeenCalled()
  await load(); expect(mocks.callArkme).toHaveBeenCalledOnce()
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
})

it.each(['empty', 'invalidated'] as const)('retains the original direct timestamp and no footer for %s thoughts', async mode => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: mode === 'empty' ? [] : [{ id: 'old', recordUid: 'note', content: '过期想法', biz: 1, status: 'invalidated' }] })
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" enabled>
    <div className="arkme-timed-bubble"><p>消息正文</p><RecordThoughtMessageFooter item={item} onOpen={() => {}}><ArkmeMessageTimestamp at={item.sendAtMillis}/></RecordThoughtMessageFooter></div>
  </RecordThoughtsProvider>)); await load()
  expect(host.querySelector('[data-arkme-thought-message-footer]')).toBeNull()
  expect(host.querySelector('.arkme-timed-bubble > time')).not.toBeNull()
  expect(host.textContent).not.toContain('过期想法')
})

it('keeps generating thought state inside the bubble footer without presenting a completed entry', async () => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [{ id: 'pending', recordUid: 'note', content: '', biz: 2, status: 'generating' }] })
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" enabled>
    <div className="arkme-timed-bubble"><RecordThoughtMessageFooter item={item} onOpen={() => {}}><ArkmeMessageTimestamp at={item.sendAtMillis}/></RecordThoughtMessageFooter></div>
  </RecordThoughtsProvider>)); await load()
  expect(host.querySelector('[data-arkme-thought-message-footer] [role="status"]')?.textContent).toContain('Arko 正在思考')
  expect(host.querySelector('[data-arkme-thought-message-footer] button')).toBeNull()
})
