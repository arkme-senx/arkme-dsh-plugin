import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexDispatchComposer, codexDispatchStatus, type CodexDispatchComposerProps } from '../src/client/redesign/contacts/CodexDispatchComposer.js'
let renderer: ReactTestRenderer | undefined
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined })
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
const props = (): CodexDispatchComposerProps => ({ scopeKey: 'account:11/team/source/task', availability: 'ready',
  submit: vi.fn(async requestId => ({ requestId, state: 'pending', reason: '', createdAt: 100, updatedAt: 100 })) })
const mount = (value: CodexDispatchComposerProps) => act(() => { renderer = create(<CodexDispatchComposer {...value}/>) })
const type = (value: string) => act(() => renderer!.root.findByType('textarea').props.onChange({ target: { value } }))
const send = async () => { await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); await Promise.resolve() }) }

describe('compact local dispatch composer', () => {
  it('keeps the input compact and does not imply HTTP persistence equals Codex queuing', async () => {
    const p = props(); mount(p); type('先做这个'); await send()
    expect(p.submit).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9-]{36}$/), '先做这个')
    expect(renderer!.root.findByType('textarea').props.rows).toBe(2)
    expect(renderer!.root.findByType('textarea').props.value).toBe('')
    expect(text(renderer!.root)).toContain('已保存到本机，等待派发')
    expect(text(renderer!.root)).not.toContain('Codex 已加入队列')
  })
  it.each(['helper_unavailable', 'authorization_required', 'remote_readonly', 'blocked'] as const)('does not submit when %s', async availability => {
    const p = { ...props(), availability }; mount(p); type('should not submit'); await send()
    expect(renderer!.root.findByType('textarea').props.disabled).toBe(true)
    expect(p.submit).not.toHaveBeenCalled()
  })
  it('explicit retry keeps request identity and text after a lost persistence response', async () => {
    const p = props(), submit = vi.fn().mockRejectedValueOnce(new Error('network'))
      .mockImplementationOnce(async requestId => ({ requestId, state: 'pending', reason: '', createdAt: 100, updatedAt: 100 }))
    mount({ ...p, submit }); type('exact text'); await send()
    expect(renderer!.root.findByType('textarea').props.readOnly).toBe(true)
    expect(text(renderer!.root)).toContain('重试保存')
    await send()
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0])
  })
  it('drops previous-account draft and ignores its delayed completion on scope switch', async () => {
    let finish!: (value: Awaited<ReturnType<NonNullable<CodexDispatchComposerProps['submit']>>>) => void
    const p = { ...props(), submit: vi.fn(() => new Promise<Awaited<ReturnType<NonNullable<CodexDispatchComposerProps['submit']>>>>(done => { finish = done })) }
    mount(p); type('old account draft'); await send()
    act(() => renderer!.update(<CodexDispatchComposer {...p} scopeKey="account:22/team/source/task"/>))
    expect(renderer!.root.findByType('textarea').props.value).toBe('')
    await act(async () => { finish({ requestId: '', state: 'pending', reason: '', createdAt: 100, updatedAt: 100 }); await Promise.resolve() })
    expect(text(renderer!.root)).not.toContain('已保存到本机')
  })
  it('does not double-submit within a render and does not call submit on mount', async () => {
    const p = props(); mount(p); expect(p.submit).not.toHaveBeenCalled(); type('hello')
    await act(async () => {
      const onSubmit = renderer!.root.findByType('form').props.onSubmit
      onSubmit({ preventDefault() {} }); onSubmit({ preventDefault() {} }); await Promise.resolve()
    })
    expect(p.submit).toHaveBeenCalledTimes(1)
  })
  it('keeps ambiguous delivery separate from waiting, acceptance and completion', () => {
    expect(codexDispatchStatus({ state: 'unknown', reason: '' })).toContain('不会自动重发')
    expect(codexDispatchStatus({ state: 'waiting', reason: 'draft_present' })).toContain('不会覆盖原文')
    expect(codexDispatchStatus({ state: 'accepted_confirmed', reason: '' })).toBe('Codex 已接受')
  })
  it('does not show an earlier request success as confirmation of the new submission', async () => {
    const p: CodexDispatchComposerProps = { ...props(), latest: { requestId: 'earlier', state: 'queued_confirmed', reason: '', createdAt: 1, updatedAt: 1 } }
    mount(p); type('new'); await send()
    expect(text(renderer!.root)).toContain('已保存到本机，等待派发')
    expect(text(renderer!.root)).not.toContain('Codex 已加入队列')
    const id = vi.mocked(p.submit!).mock.calls[0]![0]
    act(() => renderer!.update(<CodexDispatchComposer {...p} latest={{ requestId: id, state: 'queued_confirmed', reason: '', createdAt: 100, updatedAt: 101 }}/>))
    expect(text(renderer!.root)).toContain('Codex 已加入队列')
  })
  it('treats a wrong-request response as unconfirmed, preserving the draft and ID', async () => {
    const p = { ...props(), submit: vi.fn(async () => ({ requestId: 'wrong', state: 'queued_confirmed' as const, reason: '', createdAt: 100, updatedAt: 100 })) }
    mount(p); type('do not lose'); await send()
    expect(renderer!.root.findByType('textarea').props.value).toBe('do not lose')
    expect(text(renderer!.root)).not.toContain('Codex 已加入队列')
  })
  it('opens setup from the pending input or submit button without dispatching', async () => {
    const onConnect = vi.fn(), p = { ...props(), availability: 'integration_pending' as const, onConnect }
    mount(p)
    const input = renderer!.root.findByType('textarea')
    expect(input.props.readOnly).toBe(true)
    expect(input.props.disabled).toBe(false)
    act(() => input.props.onClick())
    act(() => input.props.onKeyDown({ key: 'Enter', preventDefault() {} }))
    await send()
    expect(onConnect).toHaveBeenCalledTimes(3)
    expect(p.submit).not.toHaveBeenCalled()
    expect(text(renderer!.root)).toContain('助手派发功能接入中，暂不可发送')
    expect(text(renderer!.root)).not.toContain('仅本机验证')
  })
  it('fails closed if marked ready without a real submit adapter', async () => {
    mount({ scopeKey: 'account/task', availability: 'ready' }); await send()
    expect(renderer!.root.findByType('textarea').props.disabled).toBe(true)
    expect(text(renderer!.root)).toContain('当前账号、团队或任务暂不允许派发')
  })
})
