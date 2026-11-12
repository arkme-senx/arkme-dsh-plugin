// @vitest-environment jsdom
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeDetailShell } from '../src/client/ArkmeDetailShell.js'
import { ArkmeUserAvatar } from '../src/client/ArkmeAvatar.js'
import { TeamForwardDetail } from '../src/client/TeamForwardDetail.js'
import { teamAvatarImages } from '../src/client/team-avatar-image-runtime.js'
import type { TeamMessage } from '../src/team-app-contract.js'

const preflight = vi.hoisted(() => vi.fn())
vi.mock('../src/sdk/index.js', async original => ({
  ...await original<typeof import('../src/sdk/index.js')>(),
  createArkmeSdk: () => ({ preflightTeamMessages: preflight }),
}))

const forwardMessage: TeamMessage = {
  key: 'msg', ref: 'signed-1', seq: 1, revision: 1, version: 3, side: 'team',
  own: true, state: 'published', contentStatus: 'available', createdAt: 1,
  sender: { nickname: 'Team' }, media: [], canEdit: false, canDelete: false,
  forwardRecords: { title: '转发卡片', createdAtMillis: 1, summaryLines: ['已授权摘要'],
    items: [{ senderName: '原作者', sendAtMillis: 1, title: '', textContent: '已有转发正文' }] },
}

const view = (message: TeamMessage) => <TeamForwardDetail message={message} conversationRef="signed-conversation"
  conversationKey="conversation" onClose={() => {}} />

it('retains the forward drawer across authorization and rotating references, and removes invalidated content', async () => {
  preflight.mockReset()
  const preview = forwardMessage
  let finish!: (rows: TeamMessage[]) => void
  preflight.mockImplementationOnce(() => new Promise<TeamMessage[]>(resolve => { finish = resolve }))
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(view(preview)) })
  try {
    const drawer = renderer.root.findByType(ArkmeDetailShell)
    expect(JSON.stringify(renderer.toJSON())).toContain('已有转发正文')
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/正在加载|原快记暂不可查看/u)
    await act(async () => finish([{ ...preview, forwardRecords: { ...preview.forwardRecords!, items: [
      { senderName: '原作者', sendAtMillis: 1, title: '', textContent: '完整消息正文',
        avatarRef: 'team-app-image.author', avatarKey: 'author-image' },
    ] } }]))
    expect(renderer.root.findByType(ArkmeDetailShell)).toBe(drawer)
    expect(JSON.stringify(renderer.toJSON())).toContain('完整消息正文')
    expect(renderer.root.findByType(ArkmeUserAvatar).props).toMatchObject({
      avatarRef: 'team-app-image.author', imageKey: 'author-image', imagePort: teamAvatarImages,
    })
    await act(async () => renderer.update(view({ ...preview, ref: 'signed-2' })))
    expect(preflight).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(renderer.toJSON())).toContain('完整消息正文')
    const { forwardRecords: _removed, ...identity } = preview
    await act(async () => renderer.update(view({ ...identity, contentStatus: 'revalidating' })))
    expect(renderer.root.findByType(ArkmeDetailShell)).toBe(drawer)
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/完整消息正文|已有转发正文|已授权摘要/u)
  } finally { await act(async () => renderer.unmount()) }
})

it('keeps a denied forward hidden while retrying', async () => {
  preflight.mockReset()
  preflight.mockRejectedValueOnce(new Error('无权访问'))
  let finish!: (rows: TeamMessage[]) => void
  preflight.mockImplementationOnce(() => new Promise<TeamMessage[]>(resolve => { finish = resolve }))
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(view(forwardMessage)) })
  try {
    const visible = () => JSON.stringify(renderer.toJSON())
    expect(visible()).toContain('无权访问')
    expect(visible()).not.toContain('已有转发正文')
    const retry = renderer.root.findAllByType('button').find(button => button.props.children === '重试')!
    await act(async () => retry.props.onClick())
    expect(visible()).not.toMatch(/已有转发正文|正在加载/u)
    await act(async () => finish([forwardMessage]))
    expect(visible()).toContain('已有转发正文')
  } finally { await act(async () => renderer.unmount()) }
})

it('opens a summary-only card directly into the complete detail', async () => {
  preflight.mockReset()
  let finish!: (rows: TeamMessage[]) => void
  preflight.mockImplementationOnce(() => new Promise<TeamMessage[]>(resolve => { finish = resolve }))
  const summary = { ...forwardMessage, forwardRecords: { ...forwardMessage.forwardRecords!, items: [] } }
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(view(summary)) })
  try {
    expect(renderer.toJSON()).toBeNull()
    await act(async () => finish([forwardMessage]))
    expect(renderer.root.findByType(ArkmeDetailShell)).toBeDefined()
    expect(JSON.stringify(renderer.toJSON())).toContain('已有转发正文')
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/已授权摘要|正在加载/u)
  } finally { await act(async () => renderer.unmount()) }
})

it('opens a nested card in the same drawer and returns to its parent without another read', async () => {
  const nested = { title: '内层转发', createdAtMillis: 1, summaryLines: [], items: [
    { senderName: '内层作者', sendAtMillis: 1, title: '内层标题', textContent: '仅内层详情可见的正文' },
  ] }
  const message = { ...forwardMessage, forwardRecords: { ...forwardMessage.forwardRecords!, items: [
    { senderName: '转发者', sendAtMillis: 1, title: '', textContent: '', forwardRecords: nested },
    { senderName: '同级作者', sendAtMillis: 1, title: '', textContent: '外层正文' },
  ] } }
  preflight.mockReset().mockResolvedValue([message])
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(view(message)) })
  try {
    const visible = () => JSON.stringify(renderer.toJSON())
    const drawer = renderer.root.findByType(ArkmeDetailShell)
    expect(visible()).toContain('外层正文')
    expect(visible()).not.toContain('仅内层详情可见的正文')
    await act(async () => renderer.root.findByProps({ 'aria-label': '内层转发' }).props.onClick())
    expect(renderer.root.findByType(ArkmeDetailShell)).toBe(drawer)
    expect(visible()).toContain('仅内层详情可见的正文')
    expect(visible()).not.toContain('外层正文')
    await act(async () => drawer.props.onBack())
    expect(visible()).toContain('外层正文')
    expect(visible()).not.toContain('仅内层详情可见的正文')
    expect(preflight).toHaveBeenCalledTimes(1)
  } finally { await act(async () => renderer.unmount()) }
})
