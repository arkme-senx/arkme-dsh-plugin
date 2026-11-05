// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))
import { RecordThoughtEntry, RecordThoughtContent, RecordThoughtMessageFooter, RecordThoughtsProvider, useRecordThoughtReplySummary } from '../src/client/RecordThoughts.js'
import { publishThoughtInvalidation } from '../src/client/thought-invalidations.js'
import { chatSuggestionQueue } from '../src/client/ArkoChatSuggestion.js'
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
  expect(host.textContent).toContain('Arko有想法')
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
  expect(host.textContent).toContain('Arko有想法')
  await act(async () => root.render(<App scope="production:7"/>))
  expect(host.textContent).not.toContain('Arko有想法')
  await load(); expect(host.textContent).not.toContain('Arko有想法')
})

it('keeps a continuation row and its status line stable through temporary read recovery', async () => {
  const refresh = vi.fn()
  const thought = { id: 'pending', recordUid: 'note', biz: 2 as const, status: 'generating' as const, content: '' }
  const render = (error?: string) => root.render(<RecordThoughtContent item={item} embedded items={[thought]}
    refreshError={error} onRefresh={refresh}/>)
  await act(async () => render())
  const section = host.querySelector('[data-arkme-record-thought-content]')
  const row = host.querySelector('[data-arkme-thought-reply]')
  expect(host.querySelector<HTMLElement>('[role="status"]')?.style.minHeight).toBe('20px')
  await act(async () => render('Failed to fetch'))
  expect(host.querySelector('[data-arkme-record-thought-content]')).toBe(section)
  expect(host.querySelector('[data-arkme-thought-reply]')).toBe(row)
  expect(host.textContent).toContain('连接暂时不畅')
  expect(host.querySelector<HTMLElement>('[role="status"]')?.style.minHeight).toBe('20px')
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(refresh).toHaveBeenCalledOnce()
  expect(mocks.callArkme).not.toHaveBeenCalled()
  await act(async () => render())
  expect(host.querySelector('[data-arkme-thought-reply]')).toBe(row)
  expect(host.textContent).toContain('Arko 正在回复')
})
it('allows a failed detail read to retry without changing the original message', async () => {
  mocks.callArkme.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" enabled>
    <p>原始消息正文</p><RecordThoughtContent item={item}/>
  </RecordThoughtsProvider>)); await load()
  expect(host.textContent).toContain('想法暂时无法读取')
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()); await load()
  expect(host.textContent).toContain('建议内容'); expect(host.textContent).toContain('原始消息正文')
  expect(host.textContent).not.toContain('暂时无法读取')
})

it('presents a thought as an Arko reply without a second heading or invented message time', async () => {
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" enabled>
    <RecordThoughtContent item={item}/>
  </RecordThoughtsProvider>)); await load()
  const reply = host.querySelector('[data-arkme-thought-reply="one"]')!
  expect(reply.querySelector('[data-arkme-avatar]')).not.toBeNull()
  expect(reply.querySelector('[data-arkme-thought-author]')?.textContent).toBe('Arko')
  expect(reply.querySelector('strong')?.textContent).toBe('建议内容')
  expect(reply.textContent).not.toContain('Arko有想法')
  expect(reply.querySelector('time')).toBeNull()
  expect(host.querySelector('[data-arkme-thought-reply-count]')?.textContent).toBe('共1条延展')
})

it('activates Arko replies by card click or keyboard without consuming links or selected text', async () => {
  const reply = vi.fn()
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [
    { id: 'one', recordUid: 'note', content: '建议 [链接](https://example.com)', biz: 1 },
  ] })
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" enabled>
    <RecordThoughtContent item={item} embedded onReply={reply} selectedThoughtId="one"/>
  </RecordThoughtsProvider>)); await load()
  const card = host.querySelector<HTMLElement>('[data-arkme-thought-reply]')!
  expect(card.getAttribute('role')).toBe('button')
  expect(card.getAttribute('aria-pressed')).toBe('true')
  const link = card.querySelector('a')!
  link.addEventListener('click', event => event.preventDefault())
  await act(async () => link.click())
  expect(reply).not.toHaveBeenCalled()
  const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '所选片段' } as Selection)
  await act(async () => card.click())
  expect(reply).not.toHaveBeenCalled()
  selection.mockRestore()
  await act(async () => card.click())
  await act(async () => card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await act(async () => link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(reply).toHaveBeenCalledTimes(2)
  expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'one', recordUid: 'note' }))
})

it.each(['generating', 'failed'] as const)('retains the Arko author and %s state in embedded replies', async status => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [
    { id: 'state', recordUid: 'note', content: '', biz: 2, status, visibility: 'user' },
    { id: 'old', recordUid: 'note', content: '旧回复', biz: 1, status: 'invalidated' },
  ] })
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" enabled>
    <RecordThoughtContent item={item} embedded onReply={() => { throw new Error('unfinished replies are not selectable') }}/>
  </RecordThoughtsProvider>)); await load()
  expect(host.querySelectorAll('[data-arkme-thought-reply]')).toHaveLength(1)
  expect(host.querySelector('[data-arkme-thought-author]')?.textContent).toBe('Arko')
  expect(host.textContent).toContain(status === 'generating' ? 'Arko 正在思考' : 'Arko 暂时没能完成回应')
  expect(host.textContent).toContain('仅你可见')
  expect(host.textContent).not.toContain('旧回复')
  expect(host.querySelector('[data-arkme-thought-reply-count]')).toBeNull()
  expect(host.querySelector('[data-arkme-thought-reply]')?.getAttribute('role')).toBeNull()
})

it('opens private chat advice in a dedicated dialog with one locally switchable candidate', async () => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [{ id: 'suggestion', recordUid: 'note', content: '建议一', biz: 1, scene: 5, visibility: 'user', status: 'ready', generation: 1,
    display: { headline: '确认时间', context: '正在约定见面', warnings: [], suggestions: [{ style: '自然', items: ['建议一', '建议二'] }] } }] })
  const fill = vi.fn(), normalDetail = vi.fn(), reply = vi.fn(), record = { ...item, isMe: false, messageActionRef: 'signed' }
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" sourceRef="chat-source" chat enabled onFill={fill}>
    <RecordThoughtEntry item={record} onOpen={normalDetail}/><RecordThoughtContent item={record} onReply={reply}/>
  </RecordThoughtsProvider>)); await load()
  expect(mocks.callArkme.mock.calls[0]!.slice(0, 2)).toEqual(['chat.thoughts.query', { expectedAccountScope: 'production:42', sourceRef: 'chat-source', messageActionRefs: ['signed'] }])
  expect(host.textContent).toContain('Arko有想法')
  expect(host.textContent).not.toContain('填入输入框')
  expect(host.textContent).not.toContain('换一句')
  expect(host.querySelector('[data-arkme-thought-reply="suggestion"]')).toBeNull()
  expect(host.querySelector('[data-arkme-thought-reply-count]')).toBeNull()
  const entry=host.querySelector<HTMLButtonElement>('[data-arkme-chat-suggestion-entry]')!
  await act(async()=>entry.click())
  const dialog=document.querySelector<HTMLElement>('[data-arkme-chat-suggestion-dialog]')!
  expect(dialog).not.toBeNull();expect(normalDetail).not.toHaveBeenCalled();expect(reply).not.toHaveBeenCalled()
  expect(dialog.textContent).toContain('建议一');expect(dialog.textContent).not.toContain('建议二')
  expect(dialog.querySelector('details')?.open).toBe(false)
  const action=(text:string)=>[...dialog.querySelectorAll('button')].find(button=>button.textContent===text)!
  await act(async()=>action('换一句').click())
  expect(dialog.textContent).toContain('建议二');expect(dialog.textContent).not.toContain('建议一')
  expect(mocks.callArkme).toHaveBeenCalledOnce()
  await act(async()=>action('填入输入框').click())
  expect(fill).toHaveBeenCalledExactlyOnceWith('建议二')
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
})

it('closes an open advice dialog on account/source replacement', async () => {
  const advice={id:'advice',recordUid:'note',content:'只属于原账号的建议',biz:1,scene:5,status:'ready'}
  mocks.callArkme.mockResolvedValue({accountScope:'production:42',items:[advice]})
  const render=(scope='production:42',source='first')=><RecordThoughtsProvider accountScope={scope} sourceRef={source} chat enabled><RecordThoughtEntry item={{...item,messageActionRef:'signed'}} onOpen={()=>{}}/></RecordThoughtsProvider>
  await act(async()=>root.render(render()));await load()
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-arkme-chat-suggestion-entry]')!.click())
  expect(document.body.textContent).toContain('只属于原账号的建议')
  await act(async()=>root.render(render('production:99','second')))
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
  expect(document.body.textContent).not.toContain('只属于原账号的建议')
})

const advice = { id: 'advice', recordUid: 'note', content: '建议一', biz: 1 as const, scene: 5 as const, status: 'ready' as const, generation: 1,
  display: { headline: '确认时间', context: '对话背景', warnings: [], suggestions: [{ style: '自然', items: ['建议一', '建议二'] }] } }
function AdviceApp({ enabled = true, onFill }: { enabled?: boolean; onFill?: (text: string) => void }) {
  return <RecordThoughtsProvider accountScope="production:42" sourceRef="chat" sourceKey="chat" chat enabled={enabled} onFill={onFill}>
    <RecordThoughtContent item={{ ...item, messageActionRef: 'signed', timelineItemKey: 'chat-note' }}/>
  </RecordThoughtsProvider>
}
const openAdvice = () => act(async () => host.querySelector<HTMLButtonElement>('[data-arkme-chat-suggestion-entry]')!.click())
const adviceAction = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[data-arkme-chat-suggestion-dialog] button')].find(button => button.textContent === text)!
it('uses the same dialog from details and preserves its selected candidate, analysis and focus across background recovery', async () => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [advice] })
  await act(async () => root.render(<AdviceApp onFill={vi.fn()}/>)); await load(); await openAdvice()
  const dialog = document.querySelector<HTMLElement>('[data-arkme-chat-suggestion-dialog]')!
  const analysis = dialog.querySelector('details')!
  const fill = adviceAction('填入输入框'); fill.focus()
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  await act(async () => fill.dispatchEvent(tab))
  expect(tab.defaultPrevented).toBe(false) // The following analysis summary is keyboard reachable.
  analysis.open = true
  const change = adviceAction('换一句'); change.focus()
  await act(async () => change.click())
  mocks.callArkme.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await act(async () => publishThoughtInvalidation({ accountScope: 'production:42', sourceKey: 'chat' })); await load()
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBe(dialog)
  expect(dialog.textContent).toContain('建议二'); expect(analysis.open).toBe(true)
  expect(document.activeElement).toBe(change)
  expect(dialog.textContent).toContain('建议暂时无法更新')
  await act(async () => adviceAction('重试').click()); await load()
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBe(dialog)
  expect(dialog.textContent).toContain('建议二'); expect(analysis.open).toBe(true)
  expect(dialog.textContent).not.toContain('建议暂时无法更新')
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [{ ...advice, generation: 2 }] })
  await act(async () => publishThoughtInvalidation({ accountScope: 'production:42', sourceKey: 'chat' })); await load()
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBe(dialog)
  expect(dialog.textContent).toContain('建议一'); expect(dialog.textContent).not.toContain('建议二')
})
it.each(['ready', 'denied'] as const)('retains advice across signed-reference updates and drops a late %s old read', async outcome => {
  const fills = vi.fn(), signed = { ...item, messageActionRef: 'signed', timelineItemKey: 'chat-note' }
  let finishOld!: (value: unknown) => void
  let rejectOld!: (error: unknown) => void
  const render = (sourceRef: string, sourceKey = 'stable-chat') => root.render(<RecordThoughtsProvider accountScope="production:42" sourceKey={sourceKey} sourceRef={sourceRef} chat enabled onFill={fills}>
    <RecordThoughtEntry item={signed} onOpen={() => {}}/>
  </RecordThoughtsProvider>)
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [advice] })
  await act(async () => render('before-rename')); await load(); await openAdvice()
  const dialog = document.querySelector('[data-arkme-chat-suggestion-dialog]')!
  const analysis = dialog.querySelector('details')!; analysis.open = true
  const change = adviceAction('换一句'); change.focus()
  await act(async () => change.click())
  mocks.callArkme.mockImplementationOnce(() => new Promise((resolve, reject) => { finishOld = resolve; rejectOld = reject }))
  await act(async () => publishThoughtInvalidation({ accountScope: 'production:42', sourceKey: 'stable-chat' })); await load()
  const oldSignal = mocks.callArkme.mock.calls.at(-1)![2] as AbortSignal
  await act(async () => render('after-rename'))
  expect(oldSignal.aborted).toBe(true)
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBe(dialog)
  await load()
  expect(mocks.callArkme.mock.calls.at(-1)![1].sourceRef).toBe('after-rename')
  await act(async () => {
    if (outcome === 'ready') finishOld({ accountScope: 'production:42', items: [{ ...advice, content: '旧请求晚到', generation: 99 }] })
    else rejectOld(Object.assign(new Error('旧引用已失效'), { body: { retryable: false } }))
  })
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBe(dialog)
  expect(dialog.textContent).toContain('建议二'); expect(dialog.textContent).not.toContain('旧请求晚到')
  expect(analysis.open).toBe(true); expect(document.activeElement).toBe(change)
  await act(async () => render('after-rename', 'another-chat'))
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
})
it.each(['account', 'missing-reference', 'unidentified-source'] as const)('does not inherit an open dialog across %s changes', async change => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [advice] })
  const render = (next = false) => root.render(<RecordThoughtsProvider accountScope={next && change === 'account' ? 'production:99' : 'production:42'}
    sourceKey={change === 'unidentified-source' ? undefined : 'stable-chat'}
    sourceRef={next && change === 'missing-reference' ? undefined : next && change === 'unidentified-source' ? 'other-ref' : 'original-ref'} chat enabled>
    <RecordThoughtEntry item={{ ...item, messageActionRef: 'signed' }} onOpen={() => {}}/>
  </RecordThoughtsProvider>)
  await act(async () => render()); await load(); await openAdvice()
  await act(async () => render(true))
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
  expect(host.textContent).not.toContain('建议一')
  if (change === 'missing-reference') {
    const reads = mocks.callArkme.mock.calls.length
    await load(); expect(mocks.callArkme).toHaveBeenCalledTimes(reads)
    await act(async () => render()); await load()
    expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
    expect(mocks.callArkme.mock.calls.every(([operation]) => operation === 'chat.thoughts.query')).toBe(true)
  }
})
it('closes advice on definitive owner rejection and does not reopen it after recovery', async () => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [advice] })
  await act(async () => root.render(<AdviceApp onFill={vi.fn()}/>)); await load(); await openAdvice()
  mocks.callArkme.mockRejectedValueOnce(Object.assign(new Error('消息范围无效'), { body: { code: 'chat-thought-query-invalid', retryable: false } }))
  await act(async () => publishThoughtInvalidation({ accountScope: 'production:42', sourceKey: 'chat' })); await load()
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
  expect(host.textContent).not.toContain('建议一')
  await act(async () => publishThoughtInvalidation({ accountScope: 'production:42', sourceKey: 'chat' })); await load()
  expect(host.querySelector('[data-arkme-chat-suggestion-entry]')).not.toBeNull()
  expect(host.textContent).not.toContain('建议一')
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
})
it('removes invalidated advice immediately and does not reopen it when a workspace is re-enabled', async () => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [advice] })
  await act(async () => root.render(<AdviceApp/>)); await load(); await openAdvice()
  expect(adviceAction('填入输入框').disabled).toBe(true)
  await act(async () => adviceAction('填入输入框').click())
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).not.toBeNull()
  await act(async () => publishThoughtInvalidation({ accountScope: 'production:42', sourceKey: 'chat', timelineItemKey: 'chat-note', clear: true }))
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
  await load(); expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
  await openAdvice()
  await act(async () => root.render(<AdviceApp enabled={false}/>))
  await act(async () => root.render(<AdviceApp/>)); await load()
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
})
it('counts actual Arko replies independently of private draft suggestions', async () => {
  function Summary() { const summary = useRecordThoughtReplySummary({ ...item, messageActionRef: 'signed' }); return <output>{JSON.stringify(summary)}</output> }
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [advice, { ...advice, id: 'reply', scene: 2, biz: 2 }] })
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" sourceRef="chat" chat enabled><Summary/></RecordThoughtsProvider>)); await load()
  expect(host.textContent).toBe('{"count":1,"hasContent":true}')
})
it('restores the entry on dismissal but respects focus transferred to the composer when filling', async () => {
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [advice] })
  const editor = document.createElement('textarea'); document.body.append(editor)
  try {
    await act(async () => root.render(<AdviceApp onFill={() => editor.focus()}/>)); await load()
    const entry = host.querySelector<HTMLButtonElement>('[data-arkme-chat-suggestion-entry]')!
    entry.focus(); await openAdvice()
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
    expect(document.activeElement).toBe(entry)
    await openAdvice()
    await act(async () => adviceAction('填入输入框').click())
    expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')).toBeNull()
    expect(document.activeElement).toBe(editor)
  } finally { editor.remove() }
})
it('normalizes duplicate candidates and falls back to legacy content when structured advice is empty', () => {
  expect(chatSuggestionQueue({ ...advice, display: { ...advice.display, suggestions: [{ style: '', items: ['  建议 一 ', '建议\n一', '', '建议二'] }] } })).toEqual(['建议 一', '建议二'])
  expect(chatSuggestionQueue({ ...advice, content: '  旧版建议  ', display: { ...advice.display, suggestions: [{ style: '', items: ['  ', '\n'] }] } })).toEqual(['旧版建议'])
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
  expect(host.querySelectorAll('[data-arkme-thought-entry-button]')).toHaveLength(2)
  expect([...host.querySelectorAll('[data-arkme-thought-entry-button]')].every(entry => entry.textContent?.startsWith('Arko有想法'))).toBe(true)
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

it.each([
  { source: 'self', chat: false, scene: 1, biz: 1, visibility: 'user', isMe: true },
  { source: 'private', chat: true, scene: 4, biz: 2, visibility: 'user', isMe: false },
  { source: 'group', chat: true, scene: 2, biz: 2, visibility: 'members', isMe: true },
])('shares the in-bubble footer and activation for $source thoughts', async ({ source, chat, scene, biz, visibility, isMe }) => {
  const open = vi.fn(), bubbleClick = vi.fn(), record = { ...item, isMe, messageActionRef: 'signed' }
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [{ id: 'one', recordUid: 'note', content: '私有正文不在入口展开', scene, biz, visibility, status: 'ready' }] })
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" enabled chat={chat} sourceRef={source}>
    <div className="arkme-timed-bubble" onClick={bubbleClick}><p>消息正文</p>
      <RecordThoughtMessageFooter item={record} onOpen={open}><ArkmeMessageTimestamp at={item.sendAtMillis}/></RecordThoughtMessageFooter>
    </div>
  </RecordThoughtsProvider>)); await load()
  const footer = host.querySelector('[data-arkme-thought-message-footer]')!
  const entry = footer.querySelector<HTMLButtonElement>('[data-arkme-thought-entry-button]')!
  expect(entry.textContent).toContain('Arko有想法')
  expect(entry.closest('.arkme-timed-bubble')).not.toBeNull()
  expect(footer.querySelectorAll('time')).toHaveLength(1)
  expect(host.textContent).not.toContain('私有正文不在入口展开')
  if (chat) expect(entry.textContent?.includes('仅你可见')).toBe(visibility === 'user')
  await act(async () => entry.click())
  expect(open).toHaveBeenCalledOnce(); expect(bubbleClick).not.toHaveBeenCalled()
  await load(); expect(mocks.callArkme).toHaveBeenCalledOnce()
})

it('keeps chat reply suggestions in the shared footer without leaking a preview or opening message details', async () => {
  const open = vi.fn(), fill = vi.fn(), record = { ...item, isMe: false, messageActionRef: 'signed' }
  mocks.callArkme.mockResolvedValue({ accountScope: 'production:42', items: [advice] })
  await act(async () => root.render(<RecordThoughtsProvider accountScope="production:42" sourceRef="private" chat enabled onFill={fill}>
    <div className="arkme-timed-bubble" onClick={open}><p>对方消息</p>
      <RecordThoughtMessageFooter item={record} onOpen={open}><ArkmeMessageTimestamp at={item.sendAtMillis}/></RecordThoughtMessageFooter>
    </div>
  </RecordThoughtsProvider>)); await load()
  const entry = host.querySelector<HTMLButtonElement>('[data-arkme-chat-suggestion-entry]')!
  expect(entry.closest('[data-arkme-thought-message-footer]')?.parentElement?.className).toBe('arkme-timed-bubble')
  expect(entry.hasAttribute('data-arkme-thought-entry-button')).toBe(true)
  expect(host.textContent).not.toContain('建议一'); expect(host.textContent).not.toContain('确认时间')
  await act(async () => entry.click())
  expect(document.querySelector('[data-arkme-chat-suggestion-dialog]')?.textContent).toContain('建议一')
  expect(open).not.toHaveBeenCalled()
  await act(async () => adviceAction('填入输入框').click())
  expect(fill).toHaveBeenCalledExactlyOnceWith('建议一')
  expect(mocks.callArkme).toHaveBeenCalledOnce()
})

it('drops a chat footer immediately when its source is no longer readable', async () => {
  const render = (enabled: boolean) => root.render(<RecordThoughtsProvider accountScope="production:42" sourceRef="group" chat enabled={enabled}>
    <div className="arkme-timed-bubble"><RecordThoughtMessageFooter item={{ ...item, messageActionRef: 'signed' }} onOpen={() => {}}>
      <ArkmeMessageTimestamp at={item.sendAtMillis}/>
    </RecordThoughtMessageFooter></div>
  </RecordThoughtsProvider>)
  await act(async () => render(true)); await load()
  expect(host.querySelector('[data-arkme-thought-message-footer]')).not.toBeNull()
  await act(async () => render(false))
  expect(host.querySelector('[data-arkme-thought-message-footer]')).toBeNull()
  expect(host.querySelector('.arkme-timed-bubble > time')).not.toBeNull()
})
it('handles focus for standalone result content without a navigation request or provider', async () => {
  const errors: unknown[] = []
  const onError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault() }
  window.addEventListener('error', onError)
  try {
    await act(async () => root.render(<RecordThoughtContent item={item} items={[{ id: 'standalone', recordUid: 'note', biz: 2, status: 'ready', content: '只读结果' }]}/>))
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(errors).toEqual([])
    expect(host.textContent).toContain('只读结果')
  } finally { window.removeEventListener('error', onError) }
})

it('keeps an explicitly selected result bound to its source owner when roots share a UID',async()=>{
 const {arkoInteractionJump:jump}=await import('../src/client/arko-interaction-jump.js')
 const {arkmeSourceIdentityKey}=await import('../src/client/source-identity.js')
 const source={kind:'group_chat',sourceRef:'signed-group',sourceKey:'group',displayName:'群聊'} as const
 try{
  await act(async()=>{
   jump.request({scope:'production:42',sourceKey:arkmeSourceIdentityKey(source),rootUid:item.itemUid,recordOwnerUserId:42,thought:{id:'exact-owner-result',recordUid:item.itemUid,biz:2,status:'ready',content:'本次精确结果'}})
   root.render(<RecordThoughtsProvider accountScope="production:42" sourceRef="signed-group" source={source} chat enabled>
    <div data-owner="42"><RecordThoughtContent item={{...item,recordOwnerUserId:42}}/></div>
    <div data-owner="99"><RecordThoughtContent item={{...item,recordOwnerUserId:99}}/></div>
   </RecordThoughtsProvider>)
  })
  expect(host.querySelector('[data-owner="42"]')?.textContent).toContain('本次精确结果')
  expect(host.querySelector('[data-owner="99"]')?.textContent).not.toContain('本次精确结果')
 }finally{const value=jump.snapshot();if(value)await act(async()=>jump.consume(value.revision))}
})
