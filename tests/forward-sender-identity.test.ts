import { expect, it } from 'vitest'
import { ChatService } from '../src/services/chat-service.js'

/** The Record owner's content_payload shape consumed by the forward projection. */
const payload = (ownerId: number) => ({
  render_kind: 'forward_records', title: 'Tison和花朝之间的快记', created_at: 1_788_490_000_000,
  summary_lines: [], items: [{ owner_id: ownerId, owner_name: '花朝', send_at: 1_788_490_000_000, text: '你好' }],
})

function chat() {
  const media = {
    recordContentPayload: (raw: unknown) => (raw as { content_payload: unknown }).content_payload,
    forwardContentBlocks: () => [],
  }
  const profile = { sealProfileImageRef: async (_viewer: number, owner: number) => `sealed:${String(owner)}` }
  return new ChatService({} as never, {} as never, profile as never, media as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
}

const project = async (ownerId: number, viewerUserId = 42) =>
  (await chat().chatForwardRecordsPreview({ content_payload: payload(ownerId) }, viewerUserId, 0))?.items[0]

it('exposes the snapshotted sender account for another account only', async () => {
  const other = await project(7)
  expect(other?.senderName).toBe('花朝')
  expect(other?.senderUserId).toBe(7)
  // The avatar seal stays independent of the actionable identity.
  expect(other?.avatarRef).toBe('sealed:7')
})

it('never puts the viewer own account id on a forwarded snapshot', async () => {
  const self = await project(42)
  expect(self?.senderUserId).toBeUndefined()
  expect(self?.avatarRef).toBe('sealed:42')
})

it('omits an unresolved sender instead of inventing an identity', async () => {
  const unresolved = await project(0)
  expect(unresolved?.senderUserId).toBeUndefined()
  expect(unresolved?.avatarRef).toBeUndefined()
})
