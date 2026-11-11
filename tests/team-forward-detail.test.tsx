// @vitest-environment jsdom
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeDetailShell } from '../src/client/ArkmeDetailShell.js'
import { TeamForwardDetail } from '../src/client/TeamForwardDetail.js'
import type { TeamMessage } from '../src/team-app-contract.js'

const preflight = vi.hoisted(() => vi.fn())
vi.mock('../src/sdk/index.js', async original => ({
  ...await original<typeof import('../src/sdk/index.js')>(),
  createArkmeSdk: () => ({ preflightTeamMessages: preflight }),
}))

it('retains the forward drawer across authorization and rotating references, and removes invalidated content', async () => {
  const preview: TeamMessage = {
    key: 'msg', ref: 'signed-1', seq: 1, revision: 1, version: 3, side: 'team',
    own: true, state: 'published', contentStatus: 'available', createdAt: 1,
    sender: { nickname: 'Team' }, media: [], canEdit: false, canDelete: false,
    forwardRecords: { title: '转发卡片', createdAtMillis: 1, summaryLines: ['已授权摘要'], items: [] },
  }
  let finish!: (rows: TeamMessage[]) => void
  preflight.mockImplementationOnce(() => new Promise<TeamMessage[]>(resolve => { finish = resolve }))
  const view = (message: TeamMessage) => <TeamForwardDetail message={message} conversationRef="signed-conversation"
    conversationKey="conversation" onClose={() => {}} />
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(view(preview)) })
  try {
    const drawer = renderer.root.findByType(ArkmeDetailShell)
    expect(JSON.stringify(renderer.toJSON())).toContain('已授权摘要')
    await act(async () => finish([{ ...preview, forwardRecords: { ...preview.forwardRecords!, items: [
      { senderName: '原作者', sendAtMillis: 1, title: '', textContent: '完整消息正文' },
    ] } }]))
    expect(renderer.root.findByType(ArkmeDetailShell)).toBe(drawer)
    expect(JSON.stringify(renderer.toJSON())).toContain('完整消息正文')
    await act(async () => renderer.update(view({ ...preview, ref: 'signed-2' })))
    expect(preflight).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(renderer.toJSON())).toContain('完整消息正文')
    const { forwardRecords: _removed, ...identity } = preview
    await act(async () => renderer.update(view({ ...identity, contentStatus: 'revalidating' })))
    expect(renderer.root.findByType(ArkmeDetailShell)).toBe(drawer)
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/完整消息正文|已授权摘要/u)
  } finally { await act(async () => renderer.unmount()) }
})
