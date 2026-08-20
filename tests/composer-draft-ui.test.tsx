import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import '../src/client/composer-draft-auth-binding.js'
import {
  arkmeArkoComposerDraftKey,
  arkmeComposerDraftStore,
  arkmeSourceComposerDraftKey,
} from '../src/client/composer-draft-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeAuthSnapshot, ArkmeSourceItem } from '../src/types.js'

const account: ArkmeAuthSnapshot = { status: 'authenticated', environment: 'test', userId: 10001 }
const sourceA: ArkmeSourceItem = {
  sourceRef: 'group-a', kind: 'group_chat', displayName: '会话 A', activeAtMillis: 1, unreadCount: 0,
}
const sourceB: ArkmeSourceItem = {
  sourceRef: 'group-b', kind: 'group_chat', displayName: '会话 B', activeAtMillis: 2, unreadCount: 0,
}

describe('composer draft UI projection', () => {
  afterEach(() => { arkmeComposerDraftStore.clearAccount(10001) })

  it('projects only the selected conversation draft and restores it after switching back', () => {
    const keyA = arkmeSourceComposerDraftKey(10001, sourceA)
    const keyB = arkmeSourceComposerDraftKey(10001, sourceB)
    arkmeComposerDraftStore.setText(keyA, '只属于会话 A 的草稿')
    arkmeComposerDraftStore.setText(keyB, '只属于会话 B 的草稿')

    arkmeUi.selectSource(sourceA)
    const markupA = renderToStaticMarkup(<ArkmeSurface initialAuth={account} />)
    arkmeUi.selectSource(sourceB)
    const markupB = renderToStaticMarkup(<ArkmeSurface initialAuth={account} />)
    arkmeUi.selectSource(sourceA)
    const restoredA = renderToStaticMarkup(<ArkmeSurface initialAuth={account} />)

    expect(markupA).toContain('只属于会话 A 的草稿')
    expect(markupA).not.toContain('只属于会话 B 的草稿')
    expect(markupB).toContain('只属于会话 B 的草稿')
    expect(markupB).not.toContain('只属于会话 A 的草稿')
    expect(restoredA).toContain('只属于会话 A 的草稿')
  })

  it('keeps Arko draft separate from ordinary conversations across remounts', () => {
    arkmeAuthStore.setAuth(account)
    const arkoKey = arkmeArkoComposerDraftKey(10001)
    const sourceKey = arkmeSourceComposerDraftKey(10001, sourceA)
    arkmeComposerDraftStore.setText(arkoKey, 'Arko 未发送问题')
    arkmeComposerDraftStore.setText(sourceKey, '普通会话草稿')

    const firstMount = renderToStaticMarkup(<ArkmeArkoSurface />)
    const secondMount = renderToStaticMarkup(<ArkmeArkoSurface />)

    expect(firstMount).toContain('Arko 未发送问题')
    expect(firstMount).not.toContain('普通会话草稿')
    expect(secondMount).toContain('Arko 未发送问题')
  })

  it('clears every draft owned by the account when authentication logs out', () => {
    arkmeAuthStore.setAuth(account)
    const sourceKey = arkmeSourceComposerDraftKey(10001, sourceA)
    const arkoKey = arkmeArkoComposerDraftKey(10001)
    arkmeComposerDraftStore.setText(sourceKey, '会话草稿')
    arkmeComposerDraftStore.setText(arkoKey, 'Arko 草稿')

    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })

    expect(arkmeComposerDraftStore.get(sourceKey).text).toBe('')
    expect(arkmeComposerDraftStore.get(arkoKey).text).toBe('')
  })
})
