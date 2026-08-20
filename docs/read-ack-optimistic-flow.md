# Arkme Read Ack Optimistic Flow

## UI 图

```mermaid
flowchart LR
  Footer[Sidebar footer Arkme badge] --> Directory[Arkme directory]
  Directory --> Row[Chat row unread badge]
  Directory --> Surface[Conversation surface]
  Surface --> Composer[Composer]

  Row -->|click unread chat| RowCleared[Row badge cleared immediately]
  Footer -->|same directory snapshot| FooterCleared[Footer badge total updates immediately]
  Surface -->|timeline loaded| Messages[Messages visible]
```

## 交互图

```mermaid
sequenceDiagram
  participant User
  participant Directory as ArkmeChatDirectoryStore
  participant Surface as ConversationSurface
  participant Host as Arkme host
  participant SSE as SSE events

  User->>Directory: Click unread private/group chat
  Directory->>Directory: record optimistic read intent by sourceKey + sequence
  Directory-->>User: Row and footer badges clear immediately
  Surface->>Host: source.timeline
  Host-->>Surface: latest visible items
  Surface->>Host: source.mark-read(readSequence)
  alt mark-read succeeds
    Host-->>Surface: effectiveReadSequence + unreadCount
    Surface->>Directory: confirm read ack
    SSE-->>Directory: read-ack, idempotent confirmation
  else timeline or mark-read fails
    Surface->>Directory: reject optimistic intent
    Directory->>Host: force refresh root directory
    Host-->>Directory: server unread truth
  end
```

## 关键规则

- 本地乐观清零只用于 private/group chat，且必须有有效 `latestSequence`。
- 旧投影的 `latestSequence <= readSequence` 时不能把红点顶回来。
- 新消息的 `latestSequence > readSequence` 时必须允许红点重新出现。
- 服务端确认会收敛本地 optimistic intent；失败会撤销并强制刷新目录。
