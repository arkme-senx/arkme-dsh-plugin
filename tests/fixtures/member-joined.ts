export const joinedBundle = (source = 'direct_add', actor = 1, member = 2) => ({
  session: { chat_session_uid: 'group', session_kind: 2, title: '讨论群', last_seq: 7 },
  sort_active_at: 200, unread_snapshot: { unread_count: 0, session_last_seq: 7 },
  latest_preview: { record: { payload: { text_content: '上一条消息' } } },
  latest_activity: { kind: 1, activity_uid: 'join-event', activity_at: 200, member_joined: {
    actor_user_id: actor, member_user_id: member, actor_display_name_snapshot: '张三',
    member_display_name_snapshot: '李四', join_source: source,
  } },
})

