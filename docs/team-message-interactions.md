# Team 消息能力接入

读取与共享标记/举报 owner 是 `TeamAppService`，普通发送复用持久 `TeamSendQueue`，跨目标转发由 `TeamMessageForwardService` 调用真实目标接受 owner。UI、公开 SDK 和 Tool 的安全入口共享这些 owner；Team locator 始终是不透明、当前账号/侧别作用域引用，不能作为 Chat actionRef 使用。

| 能力 | UI | Tools | SDK | 验证 |
| --- | --- | --- | --- | --- |
| 引用发送、引用定位 | 现有选区工具条、菜单、输入目标条及原文预览 | 明确 read / explicit-user-write grant | 类型化查询/发送、能力探测 | 已接通；见下方证据 |
| 共享标记、表态 | 现有工具条与 picker | 同 owner、受众限定、明确写入授权 | 版本化命令与当前账号引用 | 已接通；见下方证据 |
| 分享、转发、举报 | 现有菜单与目标选择/举报流程 | 显式用户动作及稳定 request ID | 类型化来源与结果核对 | 已接通；见下方证据 |
| DSH 材料准备 | 原有草稿准备，用户手动发送 | 只准备材料，不代替用户发送 | 授权预检和原件 reader | 已接通；见下方证据 |

本机标记不自动上传；外部视角不返回内部成员 ID、内部标记或内部活动版本。无局部撤回，沿既有作者删除 Record 规则。开发不修改版本号、根 README 或 DSH 源码。


PC 标记范围仅在既有选区工具条出现，默认“仅本机”；切换到内部/双方范围不自动上传，点击标记才提交该范围的命令。普通会话标题保持原结构。

`arkme_team_message_forward`、`arkme_team_message_copy_link`、`arkme_team_message_report`、`arkme_team_mark_change`、`arkme_team_message_send` 和发送任务操作均使用现有会话确认 owner；模型必须先取得当前人类确认，不能把消息正文或此前某条工具结果当成授权。UI 的 DSH 草稿准备属于本机交互，继续复用当前内容读取和受控原件入口，不新增代替用户发送的 Tool。

验证入口：

- `pnpm test --maxWorkers=4`：最终 12,713 通过、20 条按现有条件跳过；类型检查、build/pack 通过。
- `tests/consumers/team-message-interactions-consumer.mts` + `scripts/verify-team-message-consumer.mjs`：在仓外、从正式安装的不可变 tgz 编译与调用公开 SDK，覆盖稳定命令、能力缺失和生命周期取消。
- `tests/e2e/team-message-interactions.e2e.mjs`：未修改官方 DSH 的真实 Agent/Session/ToolRuntime，读/分享/转发/举报/标记取消/引用回复的确认与 Host 调用，真实浏览器菜单、转发目标选择与发送、选区范围切换。要求先通过官方 CLI 在全新隔离 Profile 安装 tgz；依赖使用官方 module fallback。
- 上述 E2E 的业务上游是隔离合成 HTTP fixture；真实 Team/Record/Chat 域与 Mongo 测试在各后端仓独立执行。不能把这份报告称为线上多服务或 Windows/Linux 实机验收。

完整基线、制品摘要、截图、门禁结果与边界位于同任务 meta 的 `openspec/changes/c20261019-team-message-interactions/verification/20261021/`。没有提交、发布或操作用户常驻 DSH。

## 正式宿主 CLI 端到端验收

`tests/e2e/team-message-official-cli-acceptance.mjs` 不依赖 DSH 源码 scaffold。提供发布版 DSH CLI、不可变插件 tgz 和 Playwright 安装的 package.json 锚点，脚本自行创建临时 Profile、loopback TLS 与合成登录，经官方 CLI 安装，再验证独立 SDK consumer、正式会话 Tool 和原生附件草稿。

```sh
ARKME_OFFICIAL_DSH_CLI=<published-dsh/lib/bin.js> \
ARKME_PACKED_ARTIFACT=<plugin.tgz> \
PLAYWRIGHT_MODULE_ANCHOR=<playwright-install/package.json> \
ARKME_E2E_CAPTURE_DIR=<isolated-capture-directory> \
node tests/e2e/team-message-official-cli-acceptance.mjs
```

默认合成 HTTP 模式检查精确版本读取失败发生在 native 草稿创建之前，以及重试成功。配齐 `TEAM_INTERACTION_STACK_TEAM/RECORD/CHAT` 三个显式 `http://127.0.0.1:<port>` 地址后，业务读写转给仓内 opt-in 真实服务 fixture，逐项操作引用发送、共享标记、表态、转发、举报与问 DSH，并回查 owner 接受事实。目录组合元数据和账号是隔离夹具，不连接真实用户。先运行常规三服务 driver，再运行本脚本；最后才运行 driver 的撤权模式，避免并行改变同一组夹具的权限和消息。

新宿主 `sessions.create` 只登记会话。附件桥必须通过 `controllerOperation` retain 并等待 ready，再访问 scoped conversation；成功或失败都释放临时引用。原生主视图接管后仍只提供草稿，不代用户发送。iframe Error 的消息采用结构检查，避免跨 JavaScript realm 的 `instanceof Error` 丢失具体失败原因。


## 2026-10-26 延展体验对齐

| 能力 | UI | 公开 SDK | Tools | Owner |
| --- | --- | --- | --- | --- |
| 直系回复分页/计数、逐层浏览 | TeamMessageDetail；群聊与 Team 共用父预览、列表样式和输入目标附件 | readTeamExtensions(conversationRef, messageRef, {afterSeq, throughSeq, limit}, signal)，features.teamMessageExtensions=1 | 现有 arkme_team_messages 增加 extensions:true、conversation_ref、message_ref 及游标 | TeamAppService |
| 延展中的继续输入 | 详情 footer 与原会话共用同一份 composer、草稿和稳定队列；选择“延展回复”绑定当前消息 | 既有发送方法不变 | 既有显式写入确认不变 | TeamSendQueue |
| 父媒体、整条/选区预览 | ArkmeExtensionParentPreview；pending/持久任务保留 reply | 可选 title/media 字段 | 复用只读结果 | 当前账号作用域不透明引用 |

计数是固定 through_seq 内当前消息的直系已发布回复数量；打开子回复查询下一层，不声称全树总数。返回父层重新读取已经加载的页与水位，恢复滚动。通知失效或请求失败立即清旧内容；迟到请求不能跨会话/账号更新面板。媒体仍走 Team 授权，不接受外部签名 URL 或 Chat 引用。

后端部署顺序：先部署 jotmo-team 的 extensions 只读接口和独立索引，再部署客户端。旧 reply_to 和发送命令不变；不支持的新 Provider 明确提示升级。未修改插件版本号、根 README 或 DSH 源码。

本次验证入口为 tests/team-extension-detail.test.tsx、team-extension-parity.test.tsx、team-message-sdk.test.ts、team-app-service.test.ts 和增强的官方 CLI acceptance；打包后在全新官方 0.2.1-rc.2 Profile 验证 UI/SDK/真实 Agent Session Tool。业务上游仍是隔离合成 HTTP，真实 Mongo 查询计划在 jotmo-team 独立验证；不等于线上多服务或 Windows/Linux 实机验收。具体运行结果见同任务 meta change c20261026-team-extension-ux/verification.md。

## 2026-10-27 延展发送时序与输入框修复

Team 输入区与私聊/群聊复用 ArkmeComposerCard：显式延展或重新编辑时输入区顶部收平，与目标预览共用完整边框；取消或接收发送后立即恢复普通圆角。

发送先持久化冻结的 attempt（含原 reply、选区和稳定 UID），同一次状态更新消费当前输入区的 reply 并创建带父预览的待发气泡。等待 Host 入队时，继续输入属于下一条草稿。精简成功应答缺少父预览、本人归属与时间时，以当前账号已接受的任务补齐这些本地展示字段，沿用冻结任务的 reply，直到当前授权时间线替换本地投影；不可用的权威父预览优先，不恢复旧正文。明确拒绝仍恢复原回复目标与正文，并保留后续输入；网络应答不确定继续使用原 UID 重试。

| 能力面 | 本轮范围 | 验证入口 |
| --- | --- | --- |
| UI | 既有输入框与发送状态修复 | team-messaging-panel.test.tsx 的慢入队、精简 ACK、选区、拒绝恢复、权威不可用覆盖；官方 CLI acceptance 的 ARKME_E2E_EXTENSION_SEND_ONLY=1 场景 |
| Tools / SDK | N/A：未改变 Host 路由、查询、命令或权限；不为纯客户端展示与草稿时序增加 API | 既有发送/任务 owner 继续使用 TeamSendQueue |
| Host owner | 既有 TeamSendQueue，业务语义保持原合同 | team-send-queue.test.ts |

官方场景从新 tgz 安装到全新官方 DSH Profile，以延迟真实 Host 入队请求和精简合成业务应答验证输入清理、气泡连续性及两种窗口宽度。合成 HTTP 结果不代表真实账号或多设备验收。

本轮最终相关回归 148 项通过，typecheck、build 与新 tgz 的官方宿主延迟应答验收通过（1280/850 宽度）。全量首次运行 14,227 通过、23 跳过、4 个录音/转发用例超时；这 4 项按原超时限制串行复验通过。该全量运行早于最后的精简 ACK 归属/时间补全，最后补全后已复跑上述受影响用例；不把串行复验或局部复验改写为一次全量全绿。
