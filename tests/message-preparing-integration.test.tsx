import { readFileSync } from 'node:fs'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory, arkmeInterwovenInvalidation } from '../src/client/chat-directory-store.js'
import { arkmeMessagePreparing } from '../src/client/message-preparing-store.js'
import { useArkmeRealtimeClientEvents } from '../src/client/realtime-client-events.js'

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => { renderer?.unmount() }); renderer = undefined
  arkmeMessagePreparing.activateAccount(undefined)
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('preparing production wiring', () => {
  it.each(['open', 'error', 'reconcile', 'unmount'] as const)('preserves active preparing when the non-owner surface receives %s', async action => {
    const connections: FakeEventSource[] = []
    class FakeEventSource {
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor() { connections.push(this) }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    function Consumer({ owner = false }: { owner?: boolean }) {
      useArkmeRealtimeClientEvents({ status: 'authenticated', userId: 1, environment: 'prod' }, 1, false, { ownsMessagePreparing: owner })
      return null
    }
    function Harness({ extra = true }: { extra?: boolean }) {
      return <><Consumer key="persistent" owner />{extra && <Consumer key="footer" />}</>
    }
    await act(async () => { renderer = create(<Harness />) })
    act(() => { connections[0]!.onmessage?.({ data: JSON.stringify({
      type: 'message-preparing', revision: 1, sourceKey: 'chat', actorKey: 'actor',
      prepareAtMillis: Date.now(), expireAtMillis: Date.now() + 5000, preparingState: 1,
      stateVersion: Date.now(), eventAtMillis: Date.now(), chatConnectionGeneration: 1, chatRevision: 1,
    }) } as MessageEvent<string>) })
    expect(arkmeMessagePreparing.get('chat', 'prod:1')).toHaveLength(1)
    await act(async () => {
      if (action === 'open') connections[1]!.onopen?.()
      if (action === 'error') connections[1]!.onerror?.()
      if (action === 'reconcile') connections[1]!.onmessage?.({ data: JSON.stringify({
        type: 'reconcile', revision: 2, connected: true, connectionGeneration: 1, refresh: 'none',
      }) } as MessageEvent<string>)
      if (action === 'unmount') renderer!.update(<Harness extra={false} />)
    })
    expect(arkmeMessagePreparing.get('chat', 'prod:1')).toHaveLength(1)
  })
  it('does not let a lagging duplicate arrival from another consumer clear a newer Host projection', async () => {
    const connections: FakeEventSource[] = []
    class FakeEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor() { connections.push(this) }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    function Consumer() {
      useArkmeRealtimeClientEvents({ status: 'authenticated', userId: 1, environment: 'prod' }, 1, false, { ownsMessagePreparing: true })
      return null
    }
    await act(async () => { renderer = create(<><Consumer key="persistent" /><Consumer key="footer" /></>) })
    const now = Date.now()
    const emit = (index: number, frame: object) => act(() => {
      connections[index]!.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>)
    })
    const firstPreparing = {
      type: 'message-preparing', revision: 1, sourceKey: 'chat', actorKey: 'actor',
      prepareAtMillis: now, expireAtMillis: now + 5_000, preparingState: 1,
      stateVersion: now, eventAtMillis: now, chatConnectionGeneration: 1, chatRevision: 1,
    }
    const arrived = {
      type: 'message-arrived', revision: 2, sourceKey: 'chat', actorKey: 'actor', eventAtMillis: now,
      chatConnectionGeneration: 1, chatRevision: 2,
    }
    emit(0, firstPreparing); emit(1, firstPreparing); emit(0, arrived)
    emit(0, { ...firstPreparing, revision: 3, chatRevision: 3, stateVersion: now + 1,
      prepareAtMillis: now + 1, eventAtMillis: now + 1 })
    expect(arkmeMessagePreparing.get('chat', 'prod:1').map(item => item.stateVersion)).toEqual([now + 1])
    emit(1, arrived)
    expect(arkmeMessagePreparing.get('chat', 'prod:1').map(item => item.stateVersion)).toEqual([now + 1])
  })
  it('does not grant preparing ownership to a directory-refreshing consumer by default', async () => {
    const connections: FakeEventSource[] = []
    class FakeEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor() { connections.push(this) }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    vi.spyOn(arkmeChatDirectory, 'refreshRoot').mockResolvedValue([])
    function Consumer() {
      useArkmeRealtimeClientEvents({ status: 'authenticated', userId: 1, environment: 'prod' }, 1, true)
      return null
    }
    arkmeMessagePreparing.activateAccount('prod:1')
    await act(async () => { renderer = create(<Consumer />) })
    const hint = { type: 'message-preparing' as const, revision: 1, sourceKey: 'chat', actorKey: 'actor',
      prepareAtMillis: Date.now(), expireAtMillis: Date.now() + 5000, preparingState: 1 as const,
      stateVersion: Date.now(), eventAtMillis: Date.now(), chatConnectionGeneration: 1, chatRevision: 1 }
    act(() => { connections[0]!.onmessage?.({ data: JSON.stringify(hint) } as MessageEvent<string>) })
    expect(arkmeMessagePreparing.get('chat', 'prod:1')).toHaveLength(0)
    act(() => { arkmeMessagePreparing.apply(hint) })
    act(() => { connections[0]!.onmessage?.({ data: JSON.stringify({
      type: 'message-arrived', revision: 2, sourceKey: 'chat', actorKey: 'actor', eventAtMillis: Date.now(),
      chatConnectionGeneration: 1, chatRevision: 2,
    }) } as MessageEvent<string>) })
    expect(arkmeMessagePreparing.get('chat', 'prod:1')).toHaveLength(1)
  })
  it('routes transient events without refreshing chat facts and fences disconnected accounts', async () => {
    const connections: FakeEventSource[] = []
    class FakeEventSource {
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor() { connections.push(this) }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    const refresh = vi.spyOn(arkmeChatDirectory, 'refreshRoot').mockResolvedValue([])
    const invalidate = vi.spyOn(arkmeInterwovenInvalidation, 'invalidate')
    function Harness({ userId = 1 }: { userId?: number }) {
      useArkmeRealtimeClientEvents({ status: 'authenticated', revision: 1, userId, environment: 'prod' }, 1, false, { ownsMessagePreparing: true })
      return null
    }
    await act(async () => { renderer = create(<Harness />) })
    let revision = 0
    let chatConnectionGeneration = 1
    const hint = () => ({ type: 'message-preparing', revision: ++revision, sourceKey: 'chat', actorKey: 'actor',
      prepareAtMillis: Date.now(), expireAtMillis: Date.now() + 5000, preparingState: 1,
      stateVersion: Date.now(), eventAtMillis: Date.now(), chatConnectionGeneration, chatRevision: revision })
    const emit = (frame: object, connection = connections[0]!) => act(() => {
      connection.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>)
    })
    emit(hint())
    expect(arkmeMessagePreparing.get('chat', 'prod:1')).toHaveLength(1)
    expect(refresh).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled()
    emit({ type: 'message-arrived', revision: ++revision, sourceKey: 'chat', actorKey: 'actor', eventAtMillis: Date.now(),
      chatConnectionGeneration, chatRevision: revision })
    expect(arkmeMessagePreparing.get('chat')).toHaveLength(0)
    expect(refresh).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled()
    act(() => { connections[0]!.onerror?.() })
    emit(hint())
    expect(arkmeMessagePreparing.get('chat')).toHaveLength(1)
    emit({ type: 'reconcile', revision: ++revision, connected: true, connectionGeneration: 2, refresh: 'none' })
    chatConnectionGeneration = 2
    expect(arkmeMessagePreparing.get('chat')).toHaveLength(0)
    emit(hint())
    act(() => { connections[0]!.onerror?.() })
    expect(arkmeMessagePreparing.get('chat')).toHaveLength(0)
    emit(hint())
    await act(async () => { renderer!.update(<Harness userId={2} />) })
    expect(arkmeMessagePreparing.get('chat')).toHaveLength(0)
    emit(hint()) // The closed account's callback must not touch the new store.
    expect(arkmeMessagePreparing.get('chat')).toHaveLength(0)
    emit(hint(), connections[1]!)
    expect(arkmeMessagePreparing.get('chat', 'prod:2')).toHaveLength(1)
    await act(async () => { renderer!.unmount(); renderer = undefined })
    expect(arkmeMessagePreparing.get('chat')).toHaveLength(0)
  })

  it('wires only genuine composer edits and a scoped successful submit intent', () => {
    const sidebar = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
    expect(sidebar).toContain('const messagePreparing = useMessagePreparing({')
    expect(sidebar).toContain('enabled: activeConversation && activeRecordReeditComposer === undefined && !preparingFiles')
    expect(sidebar.includes('onInputActivity={messagePreparing.input}')).toBe(true)
    expect(sidebar).toContain('if (sameTargetComposer()) messagePreparing.stop()')
    const submit = sidebar.slice(sidebar.indexOf('const send = async'), sidebar.indexOf('const updateComposerText ='))
    expect(submit.indexOf('messagePreparing.stop()')).toBeGreaterThan(submit.indexOf("if (textContent === '' && readyDraft.attachments.length === 0) return"))
    expect(sidebar).toContain('<ArkmeMessagePreparingIndicator sourceKey={source.sourceKey} accountScope={authenticatedAccountKey} />')
    const atomicEdits = sidebar.slice(sidebar.indexOf('const insertMemberMentionAt'), sidebar.indexOf('const updateComposerRichTrigger'))
    expect(atomicEdits.match(/focusEditedComposer\((cursor|caretIndex)\)/g)).toHaveLength(5)
    const deletionStart = sidebar.indexOf('const caret = arkmeComposerDraftStore.deleteMentionAtSelection')
    const deletion = sidebar.slice(deletionStart, sidebar.indexOf('if (event.key === \'Enter\' && !event.shiftKey', deletionStart))
    expect(deletion.includes('focusEditedComposer(caret)')).toBe(true)
    const editCompletion = sidebar.slice(sidebar.indexOf('const focusEditedComposer'), sidebar.indexOf('const insertMemberMentionAt'))
    expect(editCompletion.includes('composerAsyncScopeRef.current !== scope')).toBe(true)
    expect(editCompletion.indexOf('messagePreparing.input(')).toBeGreaterThan(editCompletion.indexOf('editor.focus()'))
    expect(sidebar.includes('messagePreparing.focus(true); setComposerInputFocused(true)')).toBe(true)
  })
})
