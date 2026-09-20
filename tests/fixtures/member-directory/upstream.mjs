// Explicitly opt-in, isolated acceptance upstream. All non-loopback real network is blocked.
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const directory = process.env.ARKME_MEMBER_FIXTURE_DIR
if (!directory) throw new Error('ARKME_MEMBER_FIXTURE_DIR is required for the synthetic upstream')
const originalFetch = globalThis.fetch
const viewer = 424242
const group = 'member-directory-fixture'
const json = data => new Response(JSON.stringify({ code: 200, data }), { headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) return originalFetch(input, init)
  if (url.hostname !== 'arkme.fixture.invalid') throw new Error('Synthetic upstream blocks real external traffic')
  const state = JSON.parse(readFileSync(join(directory, 'control.json'), 'utf8'))
  const body = init?.body ? JSON.parse(String(init.body)) : {}
  const path = url.pathname
  appendFileSync(join(directory, 'requests.jsonl'), JSON.stringify({ path, at: Date.now(), body }) + '\n')
  if (path === '/api/v1/sse/chat/noty') {
    let timer
    const stop = () => { clearInterval(timer) }
    return new Response(new ReadableStream({
      start(controller) {
        let lastEvent
        timer = setInterval(() => {
          const current = JSON.parse(readFileSync(join(directory, 'control.json'), 'utf8'))
          const frame = current.memberJoined
          if (frame && frame.event_uid !== lastEvent) {
            lastEvent = frame.event_uid
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
          } else controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'))
        }, 200)
        init?.signal?.addEventListener('abort', () => { stop(); controller.error(new DOMException('aborted', 'AbortError')) }, { once: true })
      }, cancel: stop,
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  }
  if (path.endsWith('/members/page')) {
    if (state.delayMs) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, state.delayMs)
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    })
    if (state.offline) return new Response('', { status: 503 })
  }
  const members = Array.from({ length: state.count ?? 500 }, (_, i) => ({
    user_id: viewer + i, role: i === 0 ? 1 : 3, status: state.removed?.includes(i) ? 3 : 1,
    display_name_snapshot: `群内成员 ${i}`, display_name: `成员 ${i}`,
    remark: state.changed && i === 7 ? '成员七的新备注' : '', join_at: 1_700_000_000_000 + i,
    extra: path.endsWith('/members/list') || (path.endsWith('/members/by-user-ids') && body.include_stats)
      ? { record_count: i, mention_count: 0 } : {},
  }))
  if (path.endsWith('the-best-api-for-testing')) return json({ access_token: 'synthetic-member-test', refresh_token: 'synthetic-member-test' })
  if (path.endsWith('get-user-info')) return json({ user_id: viewer, nick_name: '缓存验收账号', phone: '13800000000', jotmo_id: 'member-fixture' })
  if (path.endsWith('get-public-users-by-ids')) return json({ items: members.filter(item => body.user_ids.includes(item.user_id)).map(item => ({ user_id: item.user_id, nick_name: item.display_name })) })
  if (path.endsWith('/members/page')) {
    const rows = members.filter(item => item.user_id > (body.after_user_id ?? 0)).slice(0, body.limit ?? 50)
    const last = rows.at(-1)?.user_id ?? 0
    const more = last > 0 && last < members.at(-1).user_id
    return json({ chat_session_uid: group, items: rows, self_role: 1, has_more: more, ...(more ? { next_user_id: last } : {}) })
  }
  if (path.endsWith('/members/by-user-ids')) return json({ chat_session_uid: group, items: members.filter(item => body.user_ids.includes(item.user_id) && (!body.active_only || item.status === 1)) })
  if (path.endsWith('/members/list')) return json({ chat_session_uid: group, items: members.filter(item => !body.active_only || item.status === 1) })
  if (path.endsWith('/chats/list')) return json({ items: [{ session: { chat_session_uid: group, session_kind: 2, title: '群成员缓存与分页验收', last_seq: 8, last_active_at: 1_790_000_000_000 },
    current_policy: { mute_state: 1, notify_state: 1 }, unread_snapshot: { unread_count: 0 }, sort_active_at: 1_790_000_000_000 }], has_more: false })
  if (path.endsWith('/chats/group-avatar-snapshots')) return json({ items: [{ chat_session_uid: group, members: members.slice(0, 4) }] })
  if (path.endsWith('/chat/timeline/page')) return json({ items: [{ relation: { rel_uid: 'relation-8', record_uid: 'message-8', sender_user_id: viewer, display_name_snapshot: '缓存验收账号', attach_at: 1_790_000_000_000, seq: 8 },
    record: { status: 1, payload: { text_content: '成员与已读加载验收' } } }], has_more: false })
  if (path.endsWith('/read-receipts/summary-list')) return json({ chat_session_uid: group, items: body.items.map(item => ({ ...item, chat_session_uid: group,
    read_count: state.read ? 1 : 0, unread_count: state.read ? 0 : 1, total_member_count: 1 })) })
  if (path.endsWith('/read-receipts/detail')) return json({ chat_session_uid: group, record_uid: body.record_uid, seq: body.seq,
    items: [{ user_id: viewer + 7, read_status: state.read ? 'read' : 'unread', read_at: state.read ? 1_790_000_000_000 : 0 }] })
  if (path.includes('/unread-snapshot')) return json({ summary: { badge_count: 0, muted_unread_count: 0, session_count_with_unread: 0, has_attention: false, summary_version: 1, updated_at: 1 } })
  return json({ items: [], records: [], has_more: false, total: 0 })
}
