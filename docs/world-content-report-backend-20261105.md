# 公开稿举报接入合同

现有列表/详情的更多菜单、六类原因与必填 500 Unicode 字说明保持原交互。账号来自认证；调用方不提供个人 owner、团队 owner、证据正文或媒体资产。

`world.report` 的 UI、SDK、Tool 统一由 `WorldService.worldReport` 承接。提交前核对当前公开稿并把原请求原子保存在本 Profile/account 的既有 StateStore。Host 收到服务端成功后保存原请求旁的收据；调用方真正观察成功后用 `acknowledge` 清理。UI 关闭或丢响应后使用 `pending` 恢复。未知结果不能 acknowledge，不创建新请求 ID 重试。

正式 Host 通过既有 LocalDatabase 包装层转发到同一个 StateStore，不另建 SQLite 表。慢存储读取后重新核验账号。SDK 使用既有请求生命周期，销毁后拒绝新调用并取消进行中请求；取消传输不证明服务器未受理，仍按原请求恢复。模型工具的 `confirmed:true` 不构成用户授权，提交还须经过现有真实用户对话确认门禁，展示举报类型和完整说明。

上游只有 `POST /api/v1/world/reports/create`。请求：`record_uid`、`content_revision`（语义32hex）、`request_uid`、`report_type`（1～6）、`reason`（trim后1～500 Unicode code points）。World仅转发认证账号到 Record 原生举报 owner，不回退旧的非幂等提交口。

受理响应包含 `submitted:true` 和安全整数 `report_id`。明确没有受理时返回 `submitted:false` 与 `rejected`（`target_changed`、`request_conflict`、`invalid_request`）。其他错误是未确认结果，保留原请求；基础设施核验失败不能伪装目标已消失。既有客户端继续使用原举报 API。

Record 在原 `content_report` 保存可选 Submission：原请求指纹、明确 person/team principal、语义 revision、64hex媒体 version、公开原文与所选声音证据。团队稿不写成个人 OwnerID。部分唯一索引 `(reporter_id, submission.request_uid)` 只覆盖新原生公开稿请求，旧文档无请求字段时不受影响。Source 仍只表达原有 chat/team 适配；无新队列或新 Source 枚举。

同账号同请求、同载荷返回原已受理报告，即使公开稿已撤回。相同请求不同载荷拒绝。裁决仍使用原 Claim/Complete/Release 与通知链路；Release 不删除 Submission。处理只限制被冻结的公开版本，不改私人原稿、不处罚团队发布人的个人账号。

员工声音证据由 Record 按持久 Report 提取所选片段，固定代理到 World 与原媒体 resolver；慢 IO 前后校验实时员工资格。私密原音、源定位和资产 key 不进入浏览器、SDK、Tool。普通公开 URL 仍在撤回后失效，员工证据属于另一授权对象。后台复用同一个选段播放器，不重复渲染普通公开音频播放器。

验证分开记录：领域/Mongo、原后台/UI、正式 DSH 真实 Tool grant/call、不可变 tgz 仓外 SDK 与真实服务端到端。单测或构建通过不能代替这些验收；具体构建、包摘要与各项结果由任务实施记录追踪。
