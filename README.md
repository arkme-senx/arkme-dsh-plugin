# DSH Arkme Plugin

Arkme 的 DeepSeek Harness 集成插件。

## npm 安装

插件已发布至 npm：[`@senguoyun/dsh-arkme`](https://www.npmjs.com/package/@senguoyun/dsh-arkme)。

```sh
npm install @senguoyun/dsh-arkme
```

安装到 DSH Web Profile 并启动：

```sh
DSH_HOME=<arkme-dsh-home> dsh plugin --profile web add @senguoyun/dsh-arkme
DSH_HOME=<arkme-dsh-home> dsh web --port 3081
```

安装本地构建：

```sh
pnpm pack --pack-destination <artifact-directory>
DSH_HOME=<arkme-dsh-home> dsh plugin --profile web add <artifact-directory>/senguoyun-dsh-arkme-<version>.tgz
DSH_HOME=<arkme-dsh-home> dsh web --port 3081
```

## 本地开发

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

## Webhook Bot 最小闭环

生产插件通过 DSH 会话中的统一 Bot 工具支持 Webhook Bot，不提供独立管理页面：

1. 用 `arkme_bots_list` 查看当前账号的 OpenClaw 与 Webhook Bot。
2. 在用户明确要求后，用 `arkme_bot_create` 并显式指定 `provider=webhook` 创建测试 Bot。
3. 用 `arkme_bot_chat_open` 打开该 Bot 私聊，保留返回的 `source_ref`。
4. 用 `arkme_source_read` 读取该私聊中的 Webhook 回写消息。

Bot token、原始 `bot_id` 和 Webhook URL 不会进入模型参数或工具输出。创建结果未知时不要自动重试，应重新查询 Bot 列表对账。Webhook Bot 不能传给 `arkme_bot_openclaw_connect`。

### 本地临时验收，不属于生产插件能力

`scripts/verify-webhook-bot-mvp.mjs` 只模拟外部系统调用 Webhook，用于开发阶段验证消息投影与 `external_message_id` 去重。它不是 DSH 工具、不进入系统提示，也不包含在 npm 发布文件中。

先在 DSH 会话中创建 Webhook Bot、打开其私聊，再从本地测试环境取得该 Bot 的临时 URL/token，并运行：

```sh
ARKME_WEBHOOK_TEST_URL='<test-webhook-url>' \
ARKME_WEBHOOK_TEST_TOKEN='<test-token>' \
ARKME_WEBHOOK_TEST_MESSAGE='DSH Webhook MVP verification' \
ARKME_WEBHOOK_TEST_EVENT_ID="dsh-webhook-mvp-$(date +%s)" \
node scripts/verify-webhook-bot-mvp.mjs
```

脚本会用相同事件 ID 发送两次，只输出安全的 `accepted`、`messageId` 和 `deduplicated` 状态。看到 `deduplicated=true` 后，回到 DSH 会话，对之前的 `source_ref` 调用 `arkme_source_read`，确认只出现一条测试消息。脚本不会创建、重建或删除 Bot，也不会打印 URL、token 或消息正文。
