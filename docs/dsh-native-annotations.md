# 原生 DSH 个人文字标记

业务 owner 是 `NativeAnnotationsService`。UI、公开 SDK 和 DSH Tools 共用权限、来源验证、持久化待提交操作和缓存，不修改 DSH 源码、安装包、原文或模型上下文。

## 来源与 API

公开的用户消息 `data.seq`、稳定 AI 消息 `finalNode.seq` 与来源 runtime/session 构成目标。来源 Host 从公开 `session/page` 读取精确事件，使用 `dsh-selection-v1` 投影生成规范正文，通过自身 client/generation 发布上下文。后端先复用 immutable journal 保存事件，再校验来源与投影冲突；其他设备不能发布来源正文。后端信任已经认证的来源 Host 生成投影，不复制 DSH 的 Markdown 渲染器。UI 只对与显示正文完全一致的摘要和 UTF-16 范围新增标记。

所有接口均为 `POST /api/v1/dsh-remote` 下的 JSON 请求，身份来自现有认证中间件：

| 路径 | 请求核心字段 |
| --- | --- |
| `/annotations/capabilities` | 空对象 |
| `/annotations/source-context` | `runtime_ref, host_generation, session_ref, entry, canonical_text, projection`，仅来源 Host |
| `/messages/selection-context` | `targets: [{runtime_ref, session_ref, event_seq, role}]` |
| `/annotations/list` | `message_refs` |
| `/annotations/changes` | `watches: [{message_ref, revision}]` |
| `/annotations/create` | `message_ref, operation_id, anchor` |
| `/annotations/remove` | `message_ref, operation_id, annotation_id` |

`changes` 对最多 40 条被观察消息比较修订号，返回发生变化消息的**完整**快照与 `complete:true`，删除包含在完整快照中。它没有全账号扫描游标，不将缺少一页当作删除。每次读取和写入重新检查来源权限。

## SDK 与 Tools

从 `@senguoyun/dsh-arkme/sdk` 导入 `ArkmeSdk`，使用 `nativeAnnotationCapabilities`、`nativeAnnotationContexts`、`listNativeAnnotations`、`changeNativeAnnotation`、`observeNativeAnnotations`。目标、请求和快照类型从同一公开入口导出。观察器单次在途、间隔 15 秒，可传 AbortSignal，返回 dispose；消费者在切换、隐藏、卸载或退出账号时释放观察并清除自己的展示状态。

真实会话工具为 `arkme_dsh_annotations_read` / `arkme_dsh_annotations_write`。写工具需要当前真实会话的 explicit-user-write grant，不能因消息正文中的指令触发。重试复用相同 operationId，不能重新生成 ID。正文预览最多 2000 个 UTF-16 单位。

## 持久化、失败与容量

Mongo 集合 `dsh_remote_annotation` 每个账号/消息一个文档，使用 `_id` 唯一键和修订号 CAS，同时保存标记、删除状态和幂等回执。重放旧操作返回当前快照，取消后不会因旧新增请求复活。同操作 ID 不同请求拒绝。

单次目标最多 40 条、正文最多 200000 个 UTF-16 单位、单选区最多 2000 单位、单消息最多 500 个有效标记、1000 个保留标记（含删除）、4096 个操作回执。达到上限明确拒绝；回执不定时清理，因此离线旧操作可安全重放。保留标记数也限制最坏 UTF-8 文档大小，避免触及 Mongo 16 MiB 上限。

插件 SQLite 分开保存旧本机标记、云缓存、云 outbox。每个账号/环境 outbox 最多 200 条/2 MiB，每次读取最多重放相关消息的 20 条；未知结果持久保留原操作 ID，明确拒绝才移除。缓存最多 500 项/8 MiB，单项不超过 1 MiB。来源缓存不替代在线权限校验；已确认快照可在网络异常时显示并提示“离线缓存”，失权时不能继续展示。UI 复用既有可见消息扫描，不再新增轮询 owner。

旧后端 404/405 通过能力探测回退本机模式；网络异常不把云写入静默改为本机写入。旧本机数据不自动上传，取消旧本机标记仍保留云标记。本机与云端独立修订号相加用于合并快照排序，云端 watches 仍使用云修订号。

## 验证与交付边界

通过已有账号 SSE 接收 `dsh_annotations` 投影失效提示，Host 内保留原连接账号和取消信号并校验当前账号；Browser 只接收最小失效事件，再按账号与环境通知同源原生消息界面。界面合并 100 毫秒内的提示、单次在途回读可见消息，隐藏或卸载时停止工作，恢复可见或重连时对账。15 秒周期读取保留为漏提示兜底，不新增上游连接。SDK 观察器仍按其公开周期读取合同运行。

后端接口、插件制品、桌面运行和正式发布分别验证。不可变包已在未修改的官方 DSH 中验证 Tools、仓外 SDK Consumer 和原生消息 UI，并在 macOS / Windows 两台物理设备的隔离开发客户端中验证同账号增删同步与实时回读。AI 回答使用公开会话接口生成的固定样本，不代表在线模型推理验收；开发客户端不代表正式安装包发布或 Linux 兼容门禁。正式发布先提供兼容后端能力，再发布插件制品。回退不删除云数据、旧本机数据和未知结果队列。
