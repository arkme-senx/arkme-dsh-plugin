import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { ArkmeRichComposerInput } from '../src/client/ArkmeRichComposerInput.js'
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import '../src/client/composer-draft-auth-binding.js'
import {
  arkmeArkoComposerDraftKey,
  ARKME_COMPOSER_EMOJI_PLACEHOLDER,
  arkmeComposerDraftStore,
  arkmeSourceComposerDraftKey,
} from '../src/client/composer-draft-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeAuthSnapshot, ArkmeSourceItem } from '../src/types.js'

const richComposerSource = readFileSync(new URL('../src/client/ArkmeRichComposerInput.tsx', import.meta.url), 'utf8')

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

    expect(markupA).toContain('aria-label="会话 A"')
    expect(markupB).toContain('aria-label="会话 B"')
    expect(restoredA).toContain('aria-label="会话 A"')
    expect(arkmeComposerDraftStore.get(keyA).text).toBe('只属于会话 A 的草稿')
    expect(arkmeComposerDraftStore.get(keyB).text).toBe('只属于会话 B 的草稿')
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

  it('renders selected rich emoji as an atomic editable object inside the real input surface', () => {
    const markup = renderToStaticMarkup(<ArkmeRichComposerInput
      value={`前${ARKME_COMPOSER_EMOJI_PLACEHOLDER}后`}
      mentions={[]}
      emojis={[{ emojiId: 'angry_face', startIndex: 1 }]}
      maxLength={20_000}
      placeholder="发送消息"
      ariaLabel="发送消息"
      disabled={false}
      style={{ minHeight: 38, fontSize: 13, lineHeight: '21px' }}
      onTextChange={() => {}}
    />)

    expect(markup).toContain('contenteditable="true"')
    expect(markup).toContain('data-arkme-rich-composer="true"')
    expect(markup).not.toContain('<textarea')
    expect(richComposerSource).toContain("atom.contentEditable = 'false'")
    expect(richComposerSource).toContain('atom.dataset.arkmeEditableEmoji = run.emoji.id')
    expect(richComposerSource).toContain('root.replaceChildren(fragment)')
    expect(richComposerSource).toContain("height: '1.45em', margin: 0")
    expect(richComposerSource).not.toContain("margin: '0 0.12em'")
    expect(richComposerSource).not.toContain("padding: '0 0.12em'")
    expect(richComposerSource).not.toContain("userSelect: 'all'")
    expect(richComposerSource).toContain('emojiAtomSemanticOffset(event.currentTarget, event.target)')
    expect(richComposerSource).toContain('applySelection(atomOffset, atomOffset + 1)')
  })
})
