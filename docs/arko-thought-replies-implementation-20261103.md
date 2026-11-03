# Arko 想法回复：本地实现与验证

用户最新要求：直接开发后端并测试，暂不再向群内交接。本轮未新增对外消息、生产数据写入、部署或分支合并。

## 已实现

- Intelligent 在旧个人想法及新聊天想法查询中附带可选的用户绑定回复引用。internal resolve 复核当前 ready 结果、来源版本、代际及正文/结构化 display 摘要。
- Record 个人及主题延展保存真实回复 Record 与加密 Arko 快照，复用现有原子接受与 Completion。专用 `thought-replies/create` 路由要求有效引用，不回退到普通 create。
- Chat 公开回复复用延展、审核和公共投影；私密回复由 `chat_private_thought_reply` 按 viewer/source 保存关联，正文仍在 Record。私密回复不产生公共 relation、seq、member、cursor、unread 或公共分发。
- 私密用户回复也可继续回复。Chat 签发的父回复引用绑定用户、会话、真实源及私密父 Record，续帖复核当前成员、源与父正文权限。
- 新增 Chat 正文创建摘要，对稳定 child UID 改参或占用编号返回冲突；幂等重试保留用户后续编辑。旧普通回复的摘要序列化保持逐字兼容。
- 桌面复用已确认的点击回复交互，点击发送立即展示本地回复、引用和状态，后台接受后更新回执；失败或未知结果保留日志。私密线程在所有发送状态下都不进入共享时间线。

没有新增自动调用模型继续答复的触发。既有普通 Record/Chat 自动分析仍按原服务合同执行。

## 接口

| Owner | 路径或字段 | 约束 |
|---|---|---|
| Intelligent | `POST /api/internal/v1/thought/reply-target/resolve` | internal secret；返回当前授权目标快照，调用 owner 仍须复核来源读写权限 |
| Intelligent | `reply_target_ref`、旧想法 `generation` | 可选字段；引用不含正文，绑定 viewer、真实来源、scene、版本、代际和摘要 |
| Record | `POST /api/v1/records/extensions/thought-replies/create` | 必须提供 `thought_reply_ref`，拒绝缺失/空值和 Chat 私密引用 |
| Record | `POST /api/v1/topics/records/extensions/thought-replies/create` | 追加当前主题与源归属检查，其余与个人回复相同 |
| Record | `creation_intent_digest` | 可信 create-for-chat 输入；64 位十六进制，创建锚点 6，不冒充 OpenAPI 来源 |
| Chat | `POST /api/v1/chats/extensions/children/create` | 新增互斥的 `thought_reply_ref` / `private_thought_reply_ref`；公开回复继续审核 |
| Chat | `POST /api/v1/chats/extensions/private-thought-replies/page` | 当前成员和源 Record 可读；仅当前用户，单页最多 50；事务外回源后再次核验 |
| Readers | `thought_reply` / `private_reply_ref` | 冻结的正式关联和引用，不把 thought ID 冒充 Record UID |

## 验证环境与证据

本地 macOS arm64、Go 1.26.0、MongoDB 7.0.45 单节点副本集，绑定 `127.0.0.1:37861`。数据库和配置均在 `/Users/tison/arkme/.codex-artifacts/arko-replies-db` 下使用合成账号与独立库；未连接生产数据库。Mongo 发行包 SHA-256 为 `23fa267630e47fb8b95935a4bbb6fed5f43f313735b6e17fe55cacce98403deb`。

本轮相关测试均通过：

- Intelligent：签名、跨账号/容器重放、当前代际与版本、真实 Mongo、实际 internal HTTP middleware 和 handler。
- Record：真实 Mongo 并发原子接受、占用 UID、加密快照、后续编辑保留、旧摘要兼容、创建参数与权限展示，`-race` 与根架构检查。
- Chat：真实 Mongo 公开审核、私密隔离、并发幂等、稳定分页、取消、续帖引用、成员/源权限，`-race` 与根架构检查。
- 恢复序列化时从可信会话与受众恢复群审核策略，避免公开回复恢复后跳过审核；私密回复仍不走公共审核与投递。
- 三仓 `backend_guard` 均通过，无 warning。模型字段重新生成；`git diff --check` 通过。
- 前端 8 个文件 252 项测试通过；TypeScript、客户端/Host 构建、local-session profile 与执行入口验证通过。

日志留在插件 `.codex-artifacts/arko-replies-20261103/`。最终代码提交、构建 hash 与真实账号点击结果在本文件末尾记录。

### 扩大回归的既有失败

不能把本轮相关测试通过写成全仓测试全绿。相同隔离配置下用 `go test -overlay` 的 master 代码对照，下面 8 项失败均可复现：

- Chat：`TestAuditPassReconcilesReportRestrictionThatArrivesDuringProjectionInMongo`、`TestAuditPassReconcilesWithdrawalThatArrivesDuringProjectionInMongo`、`TestDeferredSenderHomeRecoversFromPendingOwner`、`TestAddChatMemberAllowsActiveMembersToDirectlyAddToWelcomeGroup`。
- Record：`TestGeneratedImageReplayRecoversPendingMongo`、`TestProcessDueTasksCompletesRecordOnlySendFromAcceptedAnchorSnapshot`、`TestProcessDueTasksCompletesRecordOnlySendFromCurrentOwnerFactAfterPayloadDrift`、`TestProcessDueTasksCompletesRecordOnlySendWithContentPayloadFileBinding`。

本轮没有修改这些业务路径。Chat 原先还漏登记一条现有的只读 timeline snapshot 边界，已按此前获准的测试清单补齐范围，与本次私密分页边界一起登记；当前根架构检查通过。overlay 只能替换 Go 编译输入，架构扫描直接读取工作区文件，因此不以 overlay 的根扫描输出归因生产代码。

## 发布、回滚与未验证范围

本地新代码不等于已安装客户端或线上版本。当前 `3102` 真实账号预览的业务服务为 `prod`；本轮只读点击，不向生产发送测试回复。新后端未部署前，未取得有效 target/capability 的 Arko 回复继续安全保留草稿，不假装发送成功。

发布须先更新所有 Record reader/writer/worker（摘要和锚点 6），再更新 Intelligent、Chat，最后开放前端。不要在新数据出现后回退为不识别锚点 6 的旧 Record 写入器。回滚先关闭新写入口，保留新 reader/worker 和加密密钥直至已接受命令结清。新增 Chat 集合的生产分片路由、跨设备/移动端展示、真实模型续答、部署及生产性能尚未验收。

环境没有 Docker，因此使用同版本的原生 Mongo 副本集执行相关数据库用例；未把 Docker 脚本或生产分片检查写为通过。OpenSpec CLI 未安装，合同 artifacts 做了人工结构审查，未声称 CLI 校验通过。

## 最终固定版本与页面验收

- `jotmo-intelligent`：`5b223b9812deb605af0a447b1ea6bf54c5263727`
- `jotmo-record`：`8175dd3158029089840cb10bfada2d6a2b12af48`
- `jotmo-chat`：`aac889692947d98f5767735090abc8d6e4cc5b4d`
- `arkme-dsh-plugin-dev-1031`：`9c5d21ee3758ceae059852303e9f690e412869c3`
- `jotmo-meta-arko-replies-1103`：`f690a144d0dc678480e2d310f80e7f90037671e6`

本地预览 `client.js` SHA-256：`c9b4ba3aaaa97b4b8c3eaa61e3daf68b1abe01f88d563aade40b2dc72a9a6842`，与 disposable preview profile 中的实际加载文件一致。真实账号 `prod:11` 已点击 2026-11-02 17:38 的“录音板块细节”详情，确认 Arko 位于相关快记之后；点击 Arko 卡片选中正确目标且输入立即聚焦，取消后点普通延展同样聚焦。原消息重复评论角标不存在。验收结束时输入框为空，未发送生产测试消息。

截图：`.codex-artifacts/arko-replies-20261103/real-account-detail-9c5d21ee.png`。当前线上后端尚无新 target/capability，截图中的 Arko 发送继续安全禁用；这不是新后端已经部署的证明。本轮前端提交后的报告更新仅改文档，业务代码版本仍为 `9c5d21ee`。

私密 Arko 的 Record 创建不再调用真人对端的发送准入；来源当前访问和账号门禁仍检查。普通真人私聊仍要求原发送准入，已有对应回归。
