import { expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'

function fixture() {
  let actor = 42
  const context = { teamRef: 'viewer-bound-team', jotmoId: 'arkme_cn', name: '即我', capabilities: { publish: true, manage: false, feedback: false, reply: true } }
  const feed = { items: [], hasMore: false }
  const teams = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => new Promise(() => {}))
  const view = {
    teamApp: { assertViewer: vi.fn(async scope => { if (scope !== `test:${actor}`) throw new Error('account-changed') }), worldTeamID: vi.fn(async () => '9223372036854775800'), execute: teams },
    teamWorld: vi.fn(async () => context), runtime: { requireSession: async () => ({ userId: actor }) },
    world: { listMixedFeed: vi.fn(async () => feed) },
  }
  const read = (includeMemberTeam?: unknown, signal?: AbortSignal) => ArkmeService.prototype.executeTeamApp.call(view as never, 'team.app.world.view', { expectedAccountKey: 'test:42', jotmoId: context.jotmoId, ...(includeMemberTeam === undefined ? {} : { includeMemberTeam }) }, signal)
  return { view, read, teams, context, feed, switchAccount: () => { actor = 99 } }
}

it('does not require a member-directory request for public team reading', async () => {
  const f = fixture()
  await expect(f.read(false)).resolves.toMatchObject({ state: 'ready', context: f.context, feed: f.feed })
  expect(f.teams).not.toHaveBeenCalled()
  expect(f.view.world.listMixedFeed).toHaveBeenCalledWith({ teamID: '9223372036854775800' })
})

it('preserves the member-team response for existing callers', async () => {
  const f = fixture(), member = { teamRef: 'member-ref', jotmoId: f.context.jotmoId, name: '即我' }
  f.teams.mockResolvedValue([member])
  await expect(f.read()).resolves.toMatchObject({ memberTeam: member, feed: f.feed })
  expect(f.teams).toHaveBeenCalledWith('team.app.teams', { expectedAccountKey: 'test:42' }, undefined)
})

it('fences an account switch before returning public content with member capabilities', async () => {
  const f = fixture()
  f.view.world.listMixedFeed.mockImplementation(async () => { f.switchAccount(); return f.feed })
  await expect(f.read(false)).rejects.toThrow('account-changed')
})

it('rejects invalid options and cancellation before starting upstream work', async () => {
  const f = fixture(), controller = new AbortController()
  await expect(f.read('false')).rejects.toMatchObject({ code: 'team-world-invalid' })
  controller.abort()
  await expect(f.read(false, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(f.view.teamWorld).not.toHaveBeenCalled()
  expect(f.view.world.listMixedFeed).not.toHaveBeenCalled()
})
