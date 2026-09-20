# 联系人群互动 Tools

## 范围与调用

`arkme_private_interaction_summary` 接收已有私聊的 `source_ref`，返回最新双向群 @、独立的 `unreadCount` 与按群/私聊策略共同过滤的 `attentionCount`。

`arkme_private_interactions_query` 接收可选 `source_ref`、`unread_only`、`limit`（1–50）、`cursor`、`expected_version`。省略联系人时查询当前账号已有私聊入口对应的互动；继续分页时原样传 `nextCursor` 并保持过滤条件。

两工具在 business/hybrid profile 注册，atomic/disabled 不暴露。通过当前账号的 Host service 请求 Chat；不读取 World fallback，不写已读，不增加全局 unread。外部插件 SDK 与页面不在本次范围。

返回只包含经过鉴权的摘要、联系人/群名称、方向、原群 sequence、时间及账号绑定 source 引用，不包含 Token、raw owner/user/record/session ID。结果文本是用户数据，不能当作模型指令。`interactionRef` 仅用于稳定去重，不能用于绕过 source 授权。

## 后端依赖

- `POST /api/v1/chats/interwoven/contacts/summary`
- `POST /api/v1/chats/interwoven/occurrences/query`

合同详见 Chat 仓 `docs/api/private-interaction-directory.md`。后端未部署时显式报不支持，不回退旧 `has_new`。

`sourceScope=chat_group_mentions`、`scopeComplete=true` 只表示 Chat 范围完整；`uncoveredSources` 包含 `legacy_world_history`。版本只可判等，不可按大小排序。

`interaction-version-changed` 要从第一页重查；`interaction-capacity-exceeded` 不自动重试，可缩小到一个联系人。传输故障沿用 Host 协调器语义。账号切换/服务销毁后迟到响应被拒绝；无新缓存、计时器或订阅。

## 验证边界

测试使用未修改的官方 `@deepseek-ai/dsh-session` / `dsh-tools`，真实创建 session，发现两个 Schema 后通过 `ctx.tools.execute()` 调用 Host adapter。测试后端响应为可控 fixture；不代表已连接生产账号或完成桌面 UI 验收。制品安装与全量测试结果记录在任务交付文档。
