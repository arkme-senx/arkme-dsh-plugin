import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { RecordingDeletionConfirmations } from '../src/recording-deletion-confirmation.js'
import type { RecordingDeletionPermission, RecordingDeletionSelection } from '../src/recording-deletion-contract.js'

const date = '2026-11-16'
const request = { dates: [date], aboveBytes: 400 * 1024 * 1024 }
const range = {
  timeZone: 'Asia/Shanghai',
  days: [{ date, bytes: 500_000_000, selected: true }],
  files: [
    { sessionId: 'first', fileName: '<demo>.wav', ownerVersion: 1, startAt: Date.parse('2026-11-16T15:59:00Z'), endAt: Date.parse('2026-11-16T16:01:00Z'), bytes: 300_000_000 },
    { sessionId: 'second', fileName: 'second.wav', ownerVersion: 2, startAt: Date.parse('2026-11-16T12:00:00Z'), endAt: Date.parse('2026-11-16T12:01:00Z'), bytes: 200_000_000 },
  ],
} satisfies RecordingDeletionSelection

function fixture() {
  let permission: RecordingDeletionPermission | undefined = { generation: 'on-1', timeZone: 'Asia/Shanghai' }
  const recording = {
    recordingDeletionPermission: vi.fn(async () => ({ scope: 'test:42', permission })),
    recordingDeletionSelection: vi.fn(async () => structuredClone(range)),
    deleteRecordingFromConfirmedSelection: vi.fn(async (_id: string, _scope: string, authorize: () => Promise<void>) => { await authorize() }),
  }
  const confirmation = new RecordingDeletionConfirmations(recording, '/arkme-self/api')
  async function navigate(id: string, method: 'GET' | 'POST', input?: { nonce: string; decision: string }, navigation = true) {
    const body = input ? new URLSearchParams({ ...input }).toString() : ''
    const req = Object.assign(Readable.from([body]), { method, headers: {
      'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-user': navigation ? '?1' : undefined,
      origin: 'null', 'content-type': 'application/x-www-form-urlencoded',
    } }) as unknown as IncomingMessage
    const res = { writeHead: vi.fn(), end: vi.fn() }
    await confirmation.handle(req, res as unknown as ServerResponse, id, new AbortController().signal)
    const html = String(res.end.mock.calls[0]?.[0] ?? '')
    const nonce = html.match(/name="nonce" value="([a-f0-9]{64})"/)?.[1] ?? ''
    return { html, nonce }
  }
  async function prepare() {
    const plan = await confirmation.prepare(request)
    if (plan.status !== 'confirmation_required') throw new Error('No test plan prepared')
    return plan
  }
  return { confirmation, recording, navigate, prepare, setPermission: (value: RecordingDeletionPermission | undefined) => { permission = value } }
}

describe('DSH recording deletion confirmation', () => {
  it('defaults to disabled and never reads the deletion candidates', async () => {
    const f = fixture()
    f.setPermission(undefined)
    expect(await f.confirmation.prepare(request)).toEqual({ status: 'disabled' })
    expect(f.recording.recordingDeletionSelection).not.toHaveBeenCalled()
    expect(f.recording.deleteRecordingFromConfirmedSelection).not.toHaveBeenCalled()
  })

  it('shows the exact escaped file list and requires a single-use user form', async () => {
    const f = fixture()
    const plan = await f.prepare()
    expect(plan).toMatchObject({ estimatedBytes: 500_000_000, fileCount: 2 })
    expect(f.recording.deleteRecordingFromConfirmedSelection).not.toHaveBeenCalled()
    await expect(f.navigate(plan.planRef, 'GET', undefined, false)).rejects.toMatchObject({ code: 'recording-delete-confirmation-invalid' })
    const { html, nonce } = await f.navigate(plan.planRef, 'GET')
    expect(html).toContain('&lt;demo&gt;.wav')
    expect(html).toContain('跨日')
    await expect(f.navigate(plan.planRef, 'POST', { nonce, decision: 'delete' }, false)).rejects.toMatchObject({ code: 'recording-delete-confirmation-invalid' })
    const posted = await f.navigate(plan.planRef, 'POST', { nonce, decision: 'delete' })
    expect(posted.html).toContain('已删除 2 份')
    expect(f.recording.deleteRecordingFromConfirmedSelection.mock.calls.map(call => call[0])).toEqual(['first', 'second'])
    await expect(f.navigate(plan.planRef, 'POST', { nonce, decision: 'delete' })).rejects.toMatchObject({ code: 'recording-delete-confirmation-invalid' })
    expect(await f.confirmation.status(plan.planRef)).toMatchObject({ status: 'finished', deleted: 2, unconfirmed: 0 })
  })

  it('rejects a stale selection and revokes plans on settings or account changes', async () => {
    const f = fixture()
    const plan = await f.prepare()
    const { nonce } = await f.navigate(plan.planRef, 'GET')
    f.recording.recordingDeletionSelection.mockResolvedValueOnce({
      ...range, files: [{ ...range.files[0]!, ownerVersion: 2 }, range.files[1]!],
    })
    expect((await f.navigate(plan.planRef, 'POST', { nonce, decision: 'delete' })).html).toContain('清单或权限已变化')
    const newPlan = await f.prepare()
    const shown = await f.navigate(newPlan.planRef, 'GET')
    f.setPermission({ generation: 'on-2', timeZone: range.timeZone })
    await expect(f.navigate(newPlan.planRef, 'POST', { nonce: shown.nonce, decision: 'delete' })).rejects.toMatchObject({ code: 'recording-delete-confirmation-invalid' })
    const current = await f.prepare()
    f.confirmation.invalidate()
    await expect(f.confirmation.status(current.planRef)).rejects.toMatchObject({ code: 'recording-delete-confirmation-invalid' })
    expect(f.recording.deleteRecordingFromConfirmedSelection).not.toHaveBeenCalled()
  })

  it('reports uncertain results and does not submit again automatically', async () => {
    const f = fixture()
    const plan = await f.prepare()
    const { nonce } = await f.navigate(plan.planRef, 'GET')
    f.recording.deleteRecordingFromConfirmedSelection.mockRejectedValueOnce(new Error('upstream response lost'))
    const output = await f.navigate(plan.planRef, 'POST', { nonce, decision: 'delete' })
    expect(output.html).toContain('已删除 1 份，1 份结果待核对')
    expect(f.recording.deleteRecordingFromConfirmedSelection).toHaveBeenCalledTimes(2)
    expect(await f.confirmation.status(plan.planRef)).toMatchObject({ deleted: 1, unconfirmed: 1 })
  })
})
