// Synthetic upstream for isolated DSH acceptance. Never forwards fixture credentials to a real server.
const originalFetch = globalThis.fetch
const stamp = new Date(2026, 7, 21, 10, 28).getTime()
const audioUrl = 'https://jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com/forward-ui-fixture.wav'
const imageUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/forward-ui-fixture.png'
const note = (i, name, text) => ({ owner_name: name, send_at: stamp - (4 - i) * 180000, title: '', text })
const forwarded = {
  render_kind: 'forward_records', title: '发布会讨论的快记', created_at: stamp,
  items: [note(0, 'Tison', '主画面已经确认，演示重点放在信息如何连接，再直接创建后续任务。'),
    note(1, '颜格蕾', '我会补齐金融和制造业的案例，让大家能直观看到实际效果。'),
    note(2, '你', '好，周三一起过一遍演示，把需要补充的内容提前整理好。'),
    note(3, 'Tison', '第四条只在详情中显示，卡片不要超过三条。')],
}
const recording = { render_kind: 'forward_records', title: '产品发布会录音转写.m4a', created_at: stamp + 60000,
  items: [{ owner_name: 'Tison', source_type: 'long_recording_segments', send_at: stamp, title: '', text: '',
    files: [{ type: 2, name: '产品发布会.wav', mime_type: 'audio/wav', download_url: audioUrl }],
    long_recording_segments: ['今天先把发布会的信息结构定下来。', '演示内容会围绕三个真实案例展开。', '最后留出时间确认负责人和下一步。', '完整第四段转写内容。'].map((text, i) => ({
      speaker_label: i % 2 ? '颜格蕾' : 'Tison', text, start_millis: i * 1500, end_millis: (i + 1) * 1500,
    })) }],
}
function row(index, text, forward, own = false, media = []) {
  return { relation: { rel_uid: `relation-${index}`, record_uid: `record-${index}`, sender_user_id: own ? 424242 : 424243,
    display_name_snapshot: own ? '你' : 'Tison', attach_at: stamp + index * 60000, seq: index + 1 },
    record: { status: 1, payload: { text_content: text, content_payload: forward ?? {}, media_display_items: media } } }
}
const rows = [row(0, '发布会定位的最终版本已经发给自己，大家有空可以看一下。'), row(1, '', forwarded), row(2, '', recording, true),
  row(3, '发布会演示文稿（含 3.0 关键能力与案例）\n\n本次发布会围绕安全、效率与可扩展性展开，结合典型客户案例展示落地成效。\n• 插件 3.0：更安全、可插拔、易扩展\n• 客户案例：金融与制造业的实际收益\n• 下一步：生态伙伴与开发者计划'),
  row(4, '图片快记', undefined, false, [{ file_kind: 1, file_name: '示意图.png', mime_type: 'image/png', preview_url: imageUrl }]),
  row(5, '完整长文。'.repeat(120)), row(6, '短', undefined, true),
]
const json = data => new Response(JSON.stringify({ code: 200, data }), { headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.href === audioUrl) {
    const samples = 8000 * 8; const wav = Buffer.alloc(44 + samples * 2)
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28)
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
    return new Response(wav, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(wav.length) } })
  }
  if (url.href === imageUrl) return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), { headers: { 'Content-Type': 'image/png' } })
  if (url.hostname !== 'arkme.fixture.invalid') {
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return originalFetch(input, init)
    throw new Error('Isolated acceptance blocks non-fixture upstream traffic')
  }
  const path = url.pathname
  if (path.endsWith('the-best-api-for-testing')) return json({ access_token: 'synthetic-acceptance-only', refresh_token: 'synthetic-acceptance-only' })
  if (path.endsWith('get-user-info')) return json({ user_id: 424242, nick_name: '你', phone: '13800000000', jotmo_id: 'fixture-user' })
  if (path.endsWith('get-public-users-by-ids')) return json({ items: [{ user_id: 424242, nick_name: '你' }, { user_id: 424243, nick_name: 'Tison' }] })
  if (path.endsWith('/chats/list')) return json({ items: [{ session: { chat_session_uid: 'fixture-group', session_kind: 2, title: '产品协作群（验收数据）', last_seq: rows.length, last_active_at: stamp },
    current_policy: { mute_state: 1, notify_state: 1 }, sort_active_at: stamp, unread_snapshot: { unread_count: 0 }, latest_preview: { record: { payload: { text_content: '转发与录音转写 UI 验收' } } } }], has_more: false })
  if (path.endsWith('/chat/timeline/page')) return json({ items: rows, has_more: false })
  if (path.endsWith('/chats/members/list')) return json({ items: [{ user_id: 424242, display_name_snapshot: '你', role: 1, status: 1 }, { user_id: 424243, display_name_snapshot: 'Tison', role: 3, status: 1 }] })
  if (path.endsWith('/chats/group-avatar-snapshots')) return json({ items: [{ chat_session_uid: 'fixture-group', members: [{ user_id: 424242 }, { user_id: 424243 }] }] })
  if (path.endsWith('/ack/read')) return json({})
  return json({ items: [], records: [], has_more: false, total: 0 })
}
