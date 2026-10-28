import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeReactionActorCard } from '../src/client/ArkmeReactionActorCard.js'
import { ArkmeMemberProfileCard } from '../src/client/ArkmeChatMemberActions.js'
import { callArkme } from '../src/client/api.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
vi.mock('../src/client/ArkmeChatMemberActions.js', () => ({ ArkmeMemberProfileCard: () => null }))

it('opens from resolved identity immediately, keeps nickname separate and never flashes a previous actor', async () => {
  let ui!: ReturnType<typeof create>
  const onClose = vi.fn()
  try {
    await act(async () => { ui = create(<ArkmeReactionActorCard scope="test:1" actor={{ userId: 2, displayName: '哇咔咔', groupNickname: '负责人', avatarRef: 'avatar-2' }} onClose={onClose} />) })
    expect(ui.root.findByType(ArkmeMemberProfileCard).props.member).toEqual({ displayName: '哇咔咔', memberName: '负责人', avatarRef: 'avatar-2' })
    expect(ui.root.findByType(ArkmeMemberProfileCard).props.showTopicNickname).toBe(true)
    expect(callArkme).not.toHaveBeenCalled()
    await act(async () => { ui.update(<ArkmeReactionActorCard scope="test:1" actor={{ userId: 3, displayName: '小李', avatarRef: 'avatar-3' }} onClose={onClose} />) })
    expect(ui.root.findByType(ArkmeMemberProfileCard).props.member).toEqual({ displayName: '小李', avatarRef: 'avatar-3' })
    expect(callArkme).not.toHaveBeenCalled()
  } finally { await act(async () => ui?.unmount()) }
})
