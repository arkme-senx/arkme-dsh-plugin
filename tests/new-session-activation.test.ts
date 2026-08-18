import { describe, expect, it, vi } from 'vitest'
import {
  isOfficialConversationTarget, isOfficialNewSessionTarget,
  watchOfficialConversationSelection, watchOfficialNewSession,
} from '../src/client/new-session-activation.js'

function targetWithLabel(label: string) {
  return {
    closest: (selector: string) => selector === 'button'
      ? { getAttribute: (name: string) => name === 'aria-label' ? label : null }
      : null,
  } as never
}

function conversationTarget(treeLabel: string, expanded: string | null = null) {
  const tree = {
    getAttribute: (name: string) => name === 'aria-label' ? treeLabel : null,
  }
  const item = {
    getAttribute: (name: string) => name === 'aria-expanded' ? expanded : null,
    closest: (selector: string) => selector === '[role="tree"]' ? tree : null,
  }
  return {
    closest: (selector: string) => selector === '[role="treeitem"]' ? item : null,
  } as never
}

describe('official New Session compatibility listener', () => {
  it('recognizes the official Chinese and English accessible labels only', () => {
    expect(isOfficialNewSessionTarget(targetWithLabel('新建会话'))).toBe(true)
    expect(isOfficialNewSessionTarget(targetWithLabel('New session'))).toBe(true)
    expect(isOfficialNewSessionTarget(targetWithLabel('Arkme'))).toBe(false)
  })

  it('recognizes only rows in the official Chinese and English session trees', () => {
    expect(isOfficialConversationTarget(conversationTarget('会话'))).toBe(true)
    expect(isOfficialConversationTarget(conversationTarget('Sessions'))).toBe(true)
    expect(isOfficialConversationTarget(conversationTarget('会话', 'true'))).toBe(false)
    expect(isOfficialConversationTarget(conversationTarget('发给自己分类'))).toBe(false)
    expect(isOfficialConversationTarget(conversationTarget('Arkme conversations'))).toBe(false)
  })

  it('captures activation while installed and removes the listener on dispose', () => {
    let listener: ((event: MouseEvent) => void) | undefined
    const ownerDocument = {
      addEventListener: vi.fn((_type, next) => { listener = next as (event: MouseEvent) => void }),
      removeEventListener: vi.fn(),
    } as unknown as Document
    const onActivate = vi.fn()

    const stop = watchOfficialNewSession(onActivate, ownerDocument)
    listener?.({ target: targetWithLabel('新建会话') } as never)
    listener?.({ target: targetWithLabel('设置') } as never)

    expect(onActivate).toHaveBeenCalledOnce()
    stop()
    expect(ownerDocument.removeEventListener).toHaveBeenCalledWith('click', listener, true)
  })

  it('captures official conversation selection and ignores Arkme source rows', () => {
    let listener: ((event: MouseEvent) => void) | undefined
    const ownerDocument = {
      addEventListener: vi.fn((_type, next) => { listener = next as (event: MouseEvent) => void }),
      removeEventListener: vi.fn(),
    } as unknown as Document
    const onActivate = vi.fn()

    const stop = watchOfficialConversationSelection(onActivate, ownerDocument)
    listener?.({ target: conversationTarget('发给自己分类') } as never)
    listener?.({ target: conversationTarget('会话') } as never)

    expect(onActivate).toHaveBeenCalledOnce()
    stop()
    expect(ownerDocument.removeEventListener).toHaveBeenCalledWith('click', listener, true)
  })
})
