import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { callArkme } from '../src/client/api.js'
import { useTeamReactionActors } from '../src/client/use-team-reaction-actors.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn(async () => ({ profile: { userId: 7, displayName: '本人昵称', avatarRef: 'self-avatar' } })) }))
afterEach(() => vi.clearAllMocks())
it('uses current profile and Team remarks without waiting for each reaction row to hydrate', async () => {
  let actors!: ReturnType<typeof useTeamReactionActors>
  function Fixture() { actors = useTeamReactionActors('test:7', [{ personKey: 'peer', nickname: '私人备注' }]); return null }
  let ui!: ReturnType<typeof create>
  await act(async () => { ui = create(<Fixture />) })
  expect(actors.selfName).toBe('本人昵称')
  expect(actors.resolveActor({ userId: 7, displayName: '我', presentationPending: true })).toMatchObject({ displayName: '本人昵称', avatarRef: 'self-avatar', presentationPending: false })
  expect(actors.resolveActor({ userId: 8, displayName: '用户', teamPersonKey: 'peer', presentationPending: true })).toMatchObject({ displayName: '私人备注', presentationPending: false })
  expect(actors.resolveActor({ userId: 9, displayName: '用户' })).toBeUndefined()
  expect(callArkme).toHaveBeenCalledTimes(1)
  await act(async () => ui.unmount())
})
it('does not reuse a late self profile after switching accounts', async () => {
  const gates = new Map<string, (value: any) => void>()
  vi.mocked(callArkme).mockImplementationOnce(() => new Promise(resolve => gates.set('first', resolve)))
    .mockImplementationOnce(() => new Promise(resolve => gates.set('second', resolve)))
  let actors!: ReturnType<typeof useTeamReactionActors>
  function Fixture({ scope }: { scope: string }) { actors = useTeamReactionActors(scope, []); return null }
  let ui!: ReturnType<typeof create>
  await act(async () => { ui = create(<Fixture scope="test:7" />) })
  await act(async () => ui.update(<Fixture scope="test:8" />))
  await act(async () => gates.get('second')!({ profile: { userId: 8, displayName: '新账号' } }))
  await act(async () => gates.get('first')!({ profile: { userId: 7, displayName: '旧账号' } }))
  expect(actors.selfName).toBe('新账号')
  await act(async () => ui.unmount())
})
