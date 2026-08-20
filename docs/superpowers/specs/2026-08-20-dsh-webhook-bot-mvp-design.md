# DSH Webhook Bot 最小闭环设计

日期：2026-08-20

## 背景

本设计基于分支 `codex/c20260819-dsh-openclaw-bot-mvp`。该分支已经提供 Arkme Bot 的所有者适配、opaque `bot_ref`、Bot 列表与创建工具、Bot 私聊打开工具、群安装工具，以及 OpenClaw 本地连接流程。不过当前 Bot 类型和工具描述仅支持 OpenClaw，尚不能在网页版 DSH 会话中管理 Webhook Bot。

本阶段的目标是验证 Bot 能力可以作为 Arkme 插件能力嵌入 DSH 会话，而不是建设独立 Bot 管理页面或完整自动化平台。用户仍然访问 `http://127.0.0.1:3081/` 的 Arkme 集成版 DSH，并在普通 DSH 会话中用自然语言查看、创建和打开 Webhook Bot 私聊。

## 目标

在 DSH 会话中支持以下生产能力：

1. 查看当前 Arkme 账号拥有的 OpenClaw 和 Webhook Bot。
2. 明确创建一个指定 provider 的 Bot，包含 Webhook Bot。
3. 打开所选 Webhook Bot 的私聊，并通过现有统一 source 读取链路查看 Webhook 回写消息。
4. 保持 token、Webhook URL、原始 `bot_id` 和本机配置不进入模型参数或工具输出。
5. 使用独立的临时验收夹具模拟外部 Webhook 请求，验证消息最终出现在 Bot 私聊并可由 DSH 读取。

## 非目标

- 不新增独立 Bot 管理页面或侧边栏管理中心。
- 不上线“模拟 Webhook 触发”工具，也不把该能力加入生产系统提示或正式工具目录。
- 不增加 Bot 删除、编辑、安全策略配置或群广播能力。
- 不扩展 OpenClaw Gateway、定时任务、在线编排或回调协议。
- 不把固定 Webhook URL/token 作为插件全局配置。
- 不自动删除验收创建的 Bot。

## 方案选择

采用扩展现有 Bot provider 模型的方案，而不新增一套平行的 Webhook 专用生产工具。

现有 `arkme_bots_list`、`arkme_bot_create` 和 `arkme_bot_chat_open` 已经形成统一 Bot 管理边界，并通过 opaque 引用隔离原始标识。让这些能力识别 `webhook` provider，可以最小化重复接口，同时真实验证 Bot 能力嵌入插件系统。OpenClaw 专属连接能力继续保持 provider 隔离。

固定 URL/token 的单向发送方案不满足“查看与创建 Bot”的目标，也会把某个 Bot 的凭据提升为插件全局配置，因此不采用。

## 架构与能力边界

### 生产链路

```text
DSH 会话
  ├─ arkme_bots_list
  │    └─ Arkme Bot API：返回当前账号的 OpenClaw/Webhook Bot
  ├─ arkme_bot_create(provider="webhook")
  │    └─ Arkme Bot API：创建 Webhook Bot
  └─ arkme_bot_chat_open(bot_ref)
       └─ 返回 source_ref
            └─ arkme_source_read(source_ref)：读取 Webhook 回写消息
```

`bot_ref` 继续由 Host 签名并绑定当前用户。生产工具不得输出原始 `bot_id`、token 或 Webhook URL。`arkme_bot_chat_open` 复用统一 source 读写链路，不为 Webhook Bot 引入另一套会话协议。

### 临时验收链路

```text
本地验收夹具
  ├─ 获取测试 Bot 的临时凭据
  ├─ POST /api/public/v1/bot/webhook/:bot_id
  │    body: token, message, external_message_id
  └─ 使用生产插件的 openBotChat/sourceRead 链路等待消息投影
```

该夹具只用于开发和验收。它不注册为 DSH 工具，不进入生产系统提示，不被正式包的 `files` 清单发布，也不作为运行时配置入口。夹具日志只记录 opaque 引用、`message_id` 和状态，不记录 token、完整 Webhook URL 或消息正文。

## 类型与接口

### Bot provider

`ArkmeBotProvider` 从仅支持 `openclaw` 扩展为：

```ts
type ArkmeBotProvider = 'openclaw' | 'webhook'
```

Webhook Bot 不依赖 Gateway 在线态。插件应接受服务端提供的 owner-facing 状态，但不得把 OpenClaw 在线判断套用于 Webhook Bot。

### 列表工具

`arkme_bots_list` 返回当前账号拥有的两类 Bot，并在每项中保留 `provider`。后续操作必须使用列表返回的未修改 `bot_ref`。

无效、未知或响应不完整的 provider 不能被猜测为某个已知类型。实现应拒绝不完整契约，或按服务端列表的既有容错边界安全跳过，且测试固定该行为。

### 创建工具

`arkme_bot_create` 增加必填 `provider: 'openclaw' | 'webhook'`。必填可以避免模型在创建这种外部写操作时隐式选择运行方式。

创建仍要求当前对话中的明确用户请求。请求结果未知时不得自动重试；工具应提示重新调用 `arkme_bots_list` 对账。响应只返回安全的 Bot summary，不序列化创建响应中的 token、Webhook URL 或原始 ID。

### 私聊工具

`arkme_bot_chat_open` 同时接受两类 Bot 的 `bot_ref`。它继续返回可复用的 `source_ref`，随后由 `arkme_source_read` 读取 Bot 私聊。

### OpenClaw 专属能力

`arkme_bot_openclaw_connect` 只允许 `provider=openclaw`。传入 Webhook Bot 时返回明确、不可重试的 provider mismatch 错误；不得尝试读取 OpenClaw profile、Gateway 元数据或 Bot secret。

## 数据流与安全

1. 所有 Bot 管理 API 使用当前 Arkme 登录会话鉴权。
2. 原始 Bot ID 只存在于 Host 内部，并封装进绑定当前用户的 opaque `bot_ref`。
3. 创建响应中可能出现的 token 只能保留在 Host 的 secret 类型中，不得被工具输出、日志或错误消息序列化。
4. Webhook URL 和 token 仅允许临时验收夹具在进程内使用。
5. 模拟请求使用唯一 `external_message_id`，以验证服务端幂等，而不是依赖正文匹配判断重复。
6. 创建、打开私聊等写操作继续使用 `explicit-user-write` grant；列表保持只读并允许并发。

## 错误处理

- `bot-create-outcome-unknown`：网络或响应异常导致创建结果未知。不得自动重试，要求刷新列表对账。
- `bot-provider-unsupported`：服务端返回未知 provider 或请求 provider 不在允许集合中。
- `bot-provider-mismatch`：Webhook Bot 被传给 OpenClaw 专属能力。
- `bot-ref-not-owned`：opaque 引用不属于当前登录账号。
- `bot-chat-source-unavailable`：服务端尚未提供可复用的统一私聊 source。
- 验收夹具的 `webhook-accepted-chat-pending`：Webhook 已接受，但消息尚未投影到会话；在有界期限内轮询。
- 验收夹具的 `webhook-callback-timeout`：超过期限仍未读到目标 `message_id`；保留测试 Bot 和诊断标识供人工检查，不自动重建或重发。

## 测试策略

### 单元与契约测试

1. Bot 列表同时投影 `openclaw` 和 `webhook`，并只暴露 opaque `bot_ref`。
2. Webhook Bot 创建请求携带 `provider=webhook`。
3. 工具输出不包含 token、Webhook URL 或原始 `bot_id`。
4. 创建结果未知时不自动重试，并要求列表对账。
5. Webhook Bot 可以通过 `arkme_bot_chat_open` 得到 `source_ref`。
6. Webhook Bot 调用 OpenClaw connect 时在访问 OpenClaw 配置前失败。
7. OpenClaw 现有列表、创建、连接和会话行为不回归。
8. 工具元数据保持正确：列表为 read；创建和打开私聊为 explicit-user-write。
9. 正式 tool catalog 与系统提示中不存在模拟 Webhook 触发工具。

### 临时闭环验收

1. 在 DSH 会话中查看 Bot 列表。
2. 在明确用户请求下创建一个名称带唯一后缀的 Webhook Bot。
3. 打开该 Bot 私聊并保存返回的 `source_ref`。
4. 验收夹具使用唯一 `external_message_id` 向真实 Webhook endpoint 发送测试文本。
5. 确认响应包含 `accepted=true` 和 `message_id`。
6. 通过生产插件的 source 读取链路，在有界期限内确认消息进入该 Bot 私聊。
7. 再发送相同 `external_message_id`，确认 `deduplicated=true` 且私聊中没有第二条重复消息。
8. 检查日志和工具输出不包含 secret。

验收失败时不得自动创建替代 Bot、重复发送新事件或删除 Bot。保留 Bot 名称、opaque 引用、外部事件 ID 和服务端消息 ID 供诊断。

## 预计修改范围

生产实现主要涉及：

- `src/types.ts`
- `src/tools/ports/bots.ts`
- `src/arkme-service.ts`
- `src/tools/business/bots/list.ts`
- `src/tools/business/bots/create.ts`
- `src/tools/business/bots/connect-openclaw.ts`
- `src/tools/prompts/business.ts`

测试主要涉及：

- `tests/arkme-bot-service.test.ts`
- `tests/arkme-bot-tools.test.ts`
- 一个不进入发布包和生产工具目录的本地 Webhook 闭环验收夹具

实现中如发现无需修改某个文件，应保持范围更小；若必须新增生产能力或改变服务端协议，应停止并重新评审设计，而不是扩大本 MVP。

## 验收标准

在 Arkme 集成版 DSH 会话中，用户可以自然语言完成：

1. “查看我的 Bot”。
2. “创建一个 Webhook Bot，名字叫回调测试”。
3. “打开回调测试 Bot 的私聊”。

随后临时验收夹具模拟一次外部 Webhook。DSH 使用正式插件的会话读取能力看到唯一测试消息；重复事件被服务端去重。正式构建和发布包中不存在模拟触发工具、固定 Webhook 配置或测试凭据。
