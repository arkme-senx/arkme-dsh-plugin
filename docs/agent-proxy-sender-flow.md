# Agent Proxy Sender Display Flow

## UI 图

```mermaid
flowchart TD
  ChatSurface[Arkme 聊天界面] --> MessageList[消息列表]
  MessageList --> SelfBubble[本人消息<br/>浅绿色气泡靠右]
  MessageList --> AgentBubble[Agent 代发本人消息<br/>浅绿色气泡靠右<br/>底部: 助手图标 + 显示名代发]
  AgentBubble --> Detail[详情抽屉<br/>我 · 显示名代发 · 时间]
```

## 交互图

```mermaid
sequenceDiagram
  participant Tool as DSH Tool
  participant Service as ArkmeService
  participant Chat as Arkme Chat API
  participant UI as ArkmeSidebar

  Tool->>Service: arkme_text_send(agentAuthored=true)
  Service->>Chat: /chats/records/send creation_source=1
  Service-->>Service: 发送成功后异步预热 Agent profile 名称缓存
  UI->>Service: 读取 timeline
  Service->>Service: creation_source=1 -> agentSource
  alt timeline 已有 Agent 名
    Service->>UI: 显示 {displayName}代发
  else timeline 只有 Agent 泛名且本地有 profile 缓存
    Service->>UI: 用缓存名显示 {displayName}代发
  else 普通消息或无来源字段
    Service->>UI: 不显示代发标识
  end
```

## 边界

- 普通手动发送不携带 `agentAuthored`，不会写 `creation_source=1`。
- 工具发送不在发送前同步查询 profile / preset，避免代发标识引入发送延迟。
- DSH Web 只消费 timeline 的来源字段和已缓存的 Arkme Agent profile 名，不新增本地消息来源表。
- Flutter 客户端口径：`creation_source=1` 表示 Agent 代发，文案为 `{displayName}代发`。
