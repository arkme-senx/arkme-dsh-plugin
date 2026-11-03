# Arko 想法回复：实现与验证

本文记录 2026-11-03 最终实现。此前的前端等待后端交接方案已由用户授权的直接开发、测试服验收与生产发布取代；不再发送群内交接消息。

## 最终行为

- Arko 想法在消息详情的相关快记下方，复用普通延展的头像、昵称与正文布局。
- 点击普通延展或 Arko 内容选中回复目标，底部显示引用预览并立即聚焦输入框；取消或切换目标保留正在输入的草稿。
- 发送立即展示本地回复与状态，后台确认接受；未知结果使用原幂等键核对，失败可重试。原消息在详情中的重复评论角标已去除。
- 用户回复保存真实 Record 及后端验证的冻结想法快照。私密聊天想法的回复、续帖及其所有本地发送状态均不进入共享时间线。
- 本次保存用户回复，不新增模型自动续答触发。没有有效 owner 引用或正式服务能力时拒绝写入并保留内容。

## 数据与权限合同

| Owner | 路径或字段 | 约束 |
| --- | --- | --- |
| Intelligent | `POST /api/internal/v1/thought/reply-target/resolve` | internal secret；签名绑定 viewer、来源、版本、代际及摘要，解析时复核当前结果 |
| Intelligent | `reply_target_ref`、`generation` | 可选字段；引用不含正文，不把 thought ID 当作可写 Record UID |
| Record | `POST /api/v1/records/extensions/thought-replies/create` | 真实来源归属、当前状态及隐私锁；要求有效 `thought_reply_ref` |
| Record | `POST /api/v1/topics/records/extensions/thought-replies/create` | 追加当前主题与源归属检查 |
| Record | `creation_intent_digest` | 可信 Chat 创建输入；64 位十六进制，创建锚点为 **7** |
| Chat | `POST /api/v1/chats/extensions/children/create` | 互斥的 `thought_reply_ref` / `private_thought_reply_ref`；公开回复正常审核 |
| Chat | `POST /api/v1/chats/extensions/private-thought-replies/page` | 仅当前 viewer，单页最多 50；快照分页，回源后再次核验权限 |
| Readers | `thought_reply` / `private_reply_ref` | 冻结的正式关联、可验证续帖引用；旧客户端可忽略可选字段 |

个人与主题回复使用独立权限判定，适用于长文与媒体；普通局部文字引用规则保留。Record 回执同时识别文字引用和 Arko 回复。Chat 的 @Arko 触发读取消息证据，Record 仅在该投影补读现有 mention metadata，历史默认过滤保持。

两端 resolve 完整 HTTP 响应上限为 1 MiB，正文和结构化 display 各自最多 128 KiB，覆盖 JSON 转义后的合法上限内容。

## 后端发布状态

| 服务 | 生产业务提交 | MR | 生产构建 |
| --- | --- | --- | --- |
| Record | `e5654e201415dcff28678675109c68f2773f4f86` | [481](https://codeup.aliyun.com/senguo/jotmo/jotmo-record/change/481) | [211](https://jenkins.senguo.me/job/PROD_jotmo-record-backend/211/) |
| Intelligent | `5fa75a1c4d890686144b85d0e2bcc4a783850e01` | [365](https://codeup.aliyun.com/senguo/jotmo/jotmo-intelligent/change/365) | [267](https://jenkins.senguo.me/job/PROD_jotmo-intelligent-backend/267/) |
| Chat | `c2606c715d8a4af4b004278f113f25bf6f2a87b3` | [497](https://codeup.aliyun.com/senguo/jotmo/jotmo-chat/change/497) | [241](https://jenkins.senguo.me/job/PROD_jotmo-chat-backend/241/) |

三服务均已合入 master 并完成上述生产构建，业务 SCM、SDK、旧 Pod 退出与新实例 Ready 已核对。前端代码合并、制品发布和已安装客户端更新是分别验收的状态，不由后端发布结果推断。

## 验证范围与边界

- macOS arm64、Go 1.26.0、MongoDB 7.0.45 原生单节点副本集，合成配置与隔离数据库；没有 Docker，未将 Docker 包装器或生产分片规模写为通过。
- 真实 HTTP owner/consumer 与数据库回归覆盖账号隔离、篡改、过期引用、并发幂等、编辑/删除/隐私锁、私密续帖、分页、容量及取消；相关 race、架构检查、backend guard 和 Linux 构建通过。
- 测试服 Record #672、Intelligent #1174、Chat #853 成功。测试账号仅写自建消息、主题及仅本人群，公开 @Arko 与私密回复链均走通。
- 前端业务提交 `9c5d21ee` 的相关测试为 8 个文件 / 252 项通过，typecheck 与构建通过。最新基线集成的全量测试结果另在本次 PR 中记录。
- 生产账号真实点击验证了同一消息的详情、Arko 和普通延展回复选中与聚焦；线上验收只读，未发测试消息。当前 3102 页面已复查，取消后输入框为空。
- 宽后端回归中仍有 9 项可在 master 基线复现的历史失败及历史 vet 阻断，详见 [最终审核记录](arko-thought-replies-review-20261103.md)。不声称全仓后端测试全绿。
- 未验证生产故障注入、分片规模、移动端展示及模型自动续答；限定日志抽查不等于全量审计。

## 回退边界

新锚点 7、私密引用和冻结命令出现后，旧 reader/worker 不具备完整兼容性。优先前向修复；需要停新写时保留新 reader/worker、加密密钥，结清并核对新类型命令后再走团队 MR 与 Jenkins 回退。禁止直接 reset master 或用 rollout undo 回退 rsync 的可变二进制。

## 合并前补齐：Tools 与 SDK

用户确认将同一能力补齐到 Tools 和仓外 SDK，保持现有页面交互。

| 能力面 | 入口 | 共同 owner 与约束 |
| --- | --- | --- |
| UI | 详情内点击 Arko 或普通延展，引用后发送 | 原 `source.message-extension.extend`；正式能力与签名引用校验 |
| SDK | `sourceMessageThoughts`、`sourceMessageExtensionPage`、`extendSourceMessage` | 类型化想法、快照与不透明引用；`arkoThoughtRepliesV1` 探测；取消传播；旧 Provider 明确不支持 |
| Tools | `arkme_message_thoughts`，`action=thoughts/replies` | 只读已有结果，不触发模型；回复分页；正文预览最多 8000 字，明确标识截断 |
| Tools | `arkme_thought_reply` | 必须经过真实后续人类确认；两种引用互斥；稳定操作 UID 重试，不知结果时保留原身份 |
| Host | `source.message-thoughts.query` 与既有写入 owner | 目标取自账号/来源绑定的 actionRef；个人来源读取前后复查现有删除及隐私权限；账号或登录会话变化拒绝结果 |
| Client/Harness | 沿用现有插件装配及工具注册 | 本轮不修改桌面宿主或 DSH 源码；官方 DSH 制品安装和工具调用另存验收记录 |

SDK 消费者只从 `@senguoyun/dsh-arkme/sdk` 导入，不依赖插件私有路径。测试入口为 `tests/consumers/arko-thought-consumer.mts`。真实 DSH 验收驱动为 `scripts/arko-thought-dsh-acceptance.mjs`，只允许用于隔离 Profile 和合成 owner，不向生产写入。
