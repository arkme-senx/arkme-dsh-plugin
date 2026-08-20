import { describe, expect, it, vi } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'

class MemorySessionStore {
  session: ArkmeSessionCredentials | undefined
  async read() { return this.session }
  async write(session: ArkmeSessionCredentials) { this.session = session }
  async delete() { this.session = undefined }
}

const stateStore = {
  async uniqueCode() { return 'dsh-arrangement-device-1' },
  async revision() { return 0 },
}

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  imBaseUrl: 'https://im.test',
  webrtcBaseUrl: 'https://webrtc.test',
  worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test',
  audioBaseUrl: 'https://audio.test',
  routePath: '/arkme-self/api',
  requestTimeoutMs: 5000,
  maxTextLength: 20_000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Arrangement Provider projection', () => {
  it('advertises the additive arrangement capability', () => {
    const service = new ArkmeService(config, new MemorySessionStore(), stateStore as never)

    expect(service.providerCapabilities().features.arrangements).toBe(true)
  })

  it('rejects Arrangement reads and writes before owner IO when logged out', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new ArkmeService(config, new MemorySessionStore(), stateStore as never, fetchImpl)

    await expect(service.listArrangements()).rejects.toMatchObject({ code: 'login-required', httpStatus: 401 })
    await expect(service.mutateArrangement('arkme-arrangement-v1.ref', 'complete'))
      .rejects.toMatchObject({ code: 'login-required', httpStatus: 401 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('lists Browser-safe owner facts without leaking stable arrangement UIDs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://intelligent.test/api/v1/arrangements/list')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer access' })
      expect(JSON.parse(String(init?.body))).toEqual({ status: 2, limit: 20, offset: 0 })
      return json({ code: 200, data: {
        list: [{
          uid: 'arrangement-owner-uid-1', title: '完成方案评审', description: '确认边界',
          status: 2, state: 1, due_at: 1_777_000_000_000, remind_at: 1_776_999_000_000,
          reminder_enabled: true, reminder_state: 'scheduled', create_at: 10, update_at: 20,
        }],
        total: 1,
      } })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)

    const page = await service.listArrangements({ status: 'following', limit: 20 })

    expect(page).toMatchObject({
      total: 1,
      hasMore: false,
      items: [{
        arrangementRef: expect.stringMatching(/^arkme-arrangement-v1\./),
        title: '完成方案评审',
        description: '确认边界',
        status: 'following',
        dueAtMillis: 1_777_000_000_000,
        remindAtMillis: 1_776_999_000_000,
        reminderEnabled: true,
        reminderState: 'scheduled',
        updatedAtMillis: 20,
      }],
    })
    expect(JSON.stringify(page)).not.toContain('arrangement-owner-uid-1')
  })

  it('rejects an opaque detail ref after the account changes', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/arrangements/list')) {
        return json({ code: 200, data: {
          list: [{ uid: 'arrangement-owner-uid-1', title: '评审', status: 1, state: 1 }], total: 1,
        } })
      }
      throw new Error('detail must not reach owner for another account')
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const page = await service.listArrangements()
    const arrangementRef = page.items[0]!.arrangementRef

    sessions.session = { userId: 10002, accessToken: 'other', refreshToken: 'other-refresh' }

    await expect(service.arrangementDetail(arrangementRef)).rejects.toMatchObject({
      code: 'arrangement-ref-invalid',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('projects reminder events with reminder and arrangement refs kept distinct', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://intelligent.test/api/v1/arrangements/reminders/list')
      expect(JSON.parse(String(init?.body))).toEqual({ limit: 20, offset: 0, unread_only: true })
      return json({ code: 200, data: {
        list: [{
          uid: 'reminder-event-owner-uid-1', arrangement_uid: 'arrangement-owner-uid-1',
          title: '评审提醒', description: '今天完成', event_kind: 'due', event_at: 100,
          due_at: 200, remind_at: 150, read_at: 0, reminder_state: 'delivered',
          create_at: 90, update_at: 110,
        }],
        total: 1,
      } })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)

    const page = await service.listArrangementReminders({ unreadOnly: true })

    expect(page).toMatchObject({
      total: 1,
      items: [{
        eventRef: expect.stringMatching(/^arkme-arrangement-reminder-v1\./),
        arrangementRef: expect.stringMatching(/^arkme-arrangement-v1\./),
        title: '评审提醒', eventKind: 'due', eventAtMillis: 100, read: false,
      }],
    })
    expect(page.items[0]!.eventRef).not.toBe(page.items[0]!.arrangementRef)
    expect(JSON.stringify(page)).not.toContain('reminder-event-owner-uid-1')
    expect(JSON.stringify(page)).not.toContain('arrangement-owner-uid-1')
  })

  it('projects reminder summary without mixing lifecycle status into reminder facts', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://intelligent.test/api/v1/arrangements/reminders/summary')
      expect(JSON.parse(String(init?.body))).toEqual({})
      return json({ code: 200, data: {
        unread_count: 1,
        latest_unread: {
          uid: 'event-1', arrangement_uid: 'arrangement-1', title: '提醒',
          event_kind: 'due', event_at: 100, read_at: 0,
        },
      } })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)

    await expect(service.arrangementReminderSummary()).resolves.toMatchObject({
      unreadCount: 1,
      latestUnread: { title: '提醒', eventKind: 'due', read: false },
    })
  })

  it('returns the owner final fact after an explicitly confirmed lifecycle mutation', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const paths: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      if (path.endsWith('/list')) {
        return json({ code: 200, data: { list: [{ uid: 'arrangement-1', title: '评审', status: 1 }], total: 1 } })
      }
      if (path.endsWith('/start-follow')) {
        expect(JSON.parse(String(init?.body))).toEqual({ uid: 'arrangement-1' })
        return json({ code: 200, data: null })
      }
      if (path.endsWith('/detail')) {
        return json({ code: 200, data: { uid: 'arrangement-1', title: '评审', status: 2 } })
      }
      throw new Error(`unexpected ${path}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const arrangementRef = (await service.listArrangements()).items[0]!.arrangementRef

    await expect(service.mutateArrangement(arrangementRef, 'start-follow')).resolves.toMatchObject({
      arrangementRef,
      intent: 'start-follow',
      outcome: 'confirmed',
      item: { status: 'following' },
    })
    expect(paths).toEqual([
      '/api/v1/arrangements/list',
      '/api/v1/arrangements/start-follow',
      '/api/v1/arrangements/detail',
    ])
  })

  it('reconciles an ambiguous lifecycle write without retrying the mutation', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let mutationCalls = 0
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/list')) {
        return json({ code: 200, data: { list: [{ uid: 'arrangement-1', title: '评审', status: 1 }], total: 1 } })
      }
      if (path.endsWith('/start-follow')) {
        mutationCalls += 1
        throw new TypeError('socket closed after write')
      }
      if (path.endsWith('/detail')) {
        return json({ code: 200, data: { uid: 'arrangement-1', title: '评审', status: 2 } })
      }
      throw new Error(`unexpected ${path}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const arrangementRef = (await service.listArrangements()).items[0]!.arrangementRef

    await expect(service.mutateArrangement(arrangementRef, 'start-follow')).resolves.toMatchObject({
      outcome: 'reconciled', item: { status: 'following' },
    })
    expect(mutationCalls).toBe(1)
  })

  it('reports an unknown lifecycle outcome when read-after-write does not match', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/list')) {
        return json({ code: 200, data: { list: [{ uid: 'arrangement-1', title: '评审', status: 2 }], total: 1 } })
      }
      if (path.endsWith('/complete')) throw new TypeError('socket closed after write')
      if (path.endsWith('/detail')) {
        return json({ code: 200, data: { uid: 'arrangement-1', title: '评审', status: 2 } })
      }
      throw new Error(`unexpected ${path}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const arrangementRef = (await service.listArrangements()).items[0]!.arrangementRef

    await expect(service.mutateArrangement(arrangementRef, 'complete')).resolves.toMatchObject({
      outcome: 'unknown', item: { status: 'following' },
    })
  })

  it('propagates an owner-rejected lifecycle transition without reconciliation', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const paths: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      if (path.endsWith('/list')) {
        return json({ code: 200, data: { list: [{ uid: 'arrangement-1', title: '评审', status: 1 }], total: 1 } })
      }
      if (path.endsWith('/complete')) return json({ code: 400, message: '当前状态不允许完成' })
      throw new Error(`unexpected ${path}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const arrangementRef = (await service.listArrangements()).items[0]!.arrangementRef

    await expect(service.mutateArrangement(arrangementRef, 'complete')).rejects.toMatchObject({
      code: 'arkme-code-400', retryable: false,
    })
    expect(paths).toEqual(['/api/v1/arrangements/list', '/api/v1/arrangements/complete'])
  })

  it('reconciles ambiguous deletion through owner visibility instead of repeating delete', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let listCalls = 0
    let deleteCalls = 0
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/list')) {
        listCalls += 1
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (listCalls === 1) {
          return json({ code: 200, data: { list: [{ uid: 'arrangement-1', title: '评审', status: 1 }], total: 1 } })
        }
        expect(body).toEqual({ status: -1, uids: ['arrangement-1'], limit: 1, offset: 0 })
        return json({ code: 200, data: { list: [], total: 0 } })
      }
      if (path.endsWith('/delete')) {
        deleteCalls += 1
        throw new TypeError('socket closed after write')
      }
      throw new Error(`unexpected ${path}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const arrangementRef = (await service.listArrangements()).items[0]!.arrangementRef

    await expect(service.mutateArrangement(arrangementRef, 'delete')).resolves.toMatchObject({
      outcome: 'reconciled', deleted: true,
    })
    await expect(service.mutateArrangement(arrangementRef, 'delete')).rejects.toMatchObject({
      code: 'arrangement-ref-invalid',
    })
    expect(deleteCalls).toBe(1)
  })

  it('rejects a second concurrent write for the same arrangement reference', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let releaseMutation: ((response: Response) => void) | undefined
    const pendingMutation = new Promise<Response>(resolve => { releaseMutation = resolve })
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/list')) {
        return json({ code: 200, data: { list: [{ uid: 'arrangement-1', title: '评审', status: 1 }], total: 1 } })
      }
      if (path.endsWith('/start-follow')) return await pendingMutation
      if (path.endsWith('/detail')) {
        return json({ code: 200, data: { uid: 'arrangement-1', title: '评审', status: 2 } })
      }
      throw new Error(`unexpected ${path}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const arrangementRef = (await service.listArrangements()).items[0]!.arrangementRef
    const first = service.mutateArrangement(arrangementRef, 'start-follow')

    await expect(service.mutateArrangement(arrangementRef, 'start-follow')).rejects.toMatchObject({
      code: 'arrangement-write-pending', retryable: false, httpStatus: 409,
    })
    releaseMutation?.(json({ code: 200, data: null }))
    await expect(first).resolves.toMatchObject({ outcome: 'confirmed' })
  })

  it('keeps reminder toggle separate and returns its owner-read fact', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/list')) {
        return json({ code: 200, data: { list: [{ uid: 'arrangement-1', title: '评审', status: 2 }], total: 1 } })
      }
      if (path.endsWith('/reminder-enabled')) {
        expect(JSON.parse(String(init?.body))).toEqual({ uid: 'arrangement-1', reminder_enabled: true })
        return json({ code: 200, data: null })
      }
      if (path.endsWith('/detail')) {
        return json({ code: 200, data: {
          uid: 'arrangement-1', title: '评审', status: 2, reminder_enabled: true,
        } })
      }
      throw new Error(`unexpected ${path}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const arrangementRef = (await service.listArrangements()).items[0]!.arrangementRef

    await expect(service.setArrangementReminderEnabled(arrangementRef, true)).resolves.toMatchObject({
      arrangementRef, enabled: true, outcome: 'confirmed', item: { reminderEnabled: true },
    })
  })

  it('marks reminder events read through reminder refs instead of arrangement refs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/reminders/list')) {
        return json({ code: 200, data: {
          list: [{ uid: 'event-1', arrangement_uid: 'arrangement-1', title: '提醒', event_kind: 'due' }],
          total: 1,
        } })
      }
      if (path.endsWith('/reminders/mark-read')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (body.mark_all === true) {
          expect(body).toEqual({ event_uids: [], mark_all: true })
          return json({ code: 200, data: { updated_count: 2 } })
        }
        expect(body).toEqual({ event_uids: ['event-1'], mark_all: false })
        return json({ code: 200, data: { updated_count: 1 } })
      }
      throw new Error(`unexpected ${path}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const eventRef = (await service.listArrangementReminders()).items[0]!.eventRef

    await expect(service.markArrangementRemindersRead([eventRef])).resolves.toEqual({
      outcome: 'confirmed', updatedCount: 1,
    })
    await expect(service.markAllArrangementRemindersRead()).resolves.toEqual({
      outcome: 'confirmed', updatedCount: 2,
    })
    await expect(service.markArrangementRemindersRead(['arkme-arrangement-v1.not-an-event']))
      .rejects.toMatchObject({ code: 'arrangement-reminder-ref-invalid' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('does not treat zero unread reminders as proof that an ambiguous clear succeeded', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let clearCalls = 0
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/reminders/clear')) {
        clearCalls += 1
        throw new TypeError('socket closed after write')
      }
      if (path.endsWith('/reminders/summary')) {
        return json({ code: 200, data: { unread_count: 0 } })
      }
      if (path.endsWith('/reminders/list')) {
        return json({ code: 200, data: {
          list: [{
            uid: 'event-1', arrangement_uid: 'arrangement-1', title: '已读提醒',
            event_kind: 'due', read_at: 100,
          }],
          total: 1,
        } })
      }
      throw new Error(`unexpected ${path}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)

    await expect(service.clearArrangementReminders()).resolves.toEqual({ outcome: 'unknown' })
    expect(clearCalls).toBe(1)
  })

  it('reconciles an ambiguous clear only after the reminder list is empty', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/reminders/clear')) throw new TypeError('socket closed after write')
      if (path.endsWith('/reminders/list')) {
        return json({ code: 200, data: { list: [], total: 0 } })
      }
      throw new Error(`unexpected ${path}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)

    await expect(service.clearArrangementReminders()).resolves.toEqual({ outcome: 'reconciled' })
  })

  it('invalidates arrangement and reminder refs on logout even for the same account', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/arrangements/list')) {
        return json({ code: 200, data: { list: [{ uid: 'arrangement-1', title: '评审', status: 1 }], total: 1 } })
      }
      if (path.endsWith('/reminders/list')) {
        return json({ code: 200, data: {
          list: [{ uid: 'event-1', arrangement_uid: 'arrangement-1', title: '提醒', event_kind: 'due' }],
          total: 1,
        } })
      }
      throw new Error('stale refs must not reach owner')
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const arrangementRef = (await service.listArrangements()).items[0]!.arrangementRef
    const eventRef = (await service.listArrangementReminders()).items[0]!.eventRef

    await service.logout()
    sessions.session = { userId: 10001, accessToken: 'new-access', refreshToken: 'new-refresh' }

    await expect(service.arrangementDetail(arrangementRef)).rejects.toMatchObject({ code: 'arrangement-ref-invalid' })
    await expect(service.markArrangementRemindersRead([eventRef]))
      .rejects.toMatchObject({ code: 'arrangement-reminder-ref-invalid' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
