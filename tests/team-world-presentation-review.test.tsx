// @vitest-environment jsdom
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: mock.call }))
import { TeamWorldSurface } from '../src/client/TeamWorldSurface.js'
import { ArkmeTeamAvatar } from '../src/client/ArkmeTeamAvatar.js'

it('retains the known team avatar while optional member presentation is pending', async () => {
  const avatar = { mode: 'custom', key: 'public-avatar-key', imageRef: 'public-avatar-ref' } as const
  const target = { jotmoId: 'arkme_cn', name: '即我', avatar }
  mock.call.mockImplementation(async op => op === 'team.app.world.view' ? {
    state: 'ready', team: { jotmoId: target.jotmoId, name: target.name },
    context: { teamRef: 'team-ref', jotmoId: target.jotmoId, name: target.name, capabilities: { publish: true, manage: false, feedback: false, reply: false } },
    feed: { items: [], hasMore: false },
  } : new Promise(() => {}))
  let view: ReturnType<typeof create> | undefined
  try {
    await act(async () => { view = create(<TeamWorldSurface accountKey="test:42" target={target} onBack={() => {}} />) })
    expect(view!.root.findByType(ArkmeTeamAvatar).props.avatar).toEqual(avatar)
  } finally { await act(async () => view?.unmount()); vi.clearAllMocks() }
})
