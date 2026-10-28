# 群内代表团队与公开名片

目标基线 dev；T23 为本人已经加入普通群后的代表表达，T24 为纯读名片与既有唯一团队会话导航。不实现团队入群、代理读群或群归集。

| 消费面 | 入口与共同 owner | 验证状态 |
| --- | --- | --- |
| UI | 身份选择器、按团队隔离草稿、消息徽标、公开名片 | 已验证 |
| Tools | 身份候选查询、名片查询、显式授权的代表发送 | 已验证 |
| SDK | 有类型的候选、名片及发送选择；现有账号/Provider生命周期 | 已验证 |
| Host | TeamAppService 负责资料投影；ChatService 负责消息命令；共用身份引用 codec | 已验证 |

teamRef 是当前账号绑定的不透明引用，不是授权；每次新表达仍由 Chat 与 Team 检查资格及代次。公开卡读取不调用 channel/open；点击联系才导航。已接受消息的外层身份只读 relation，Record 来源不会自动为个人挂载加团队徽标。


验收（macOS / Node 24 / 官方 DSH 0.2.1-rc.2）：完整 Vitest 14,477 通过、24 个原有条件跳过；typecheck/build/不可变 tgz 安装通过。`tests/e2e/team-group-identity-installed.mjs` 在独立 Profile 验证真实会话 Tool 发现/调用/伪造引用拒绝、仓外 Consumer 编译与实际 SDK 代表发送、浏览器团队身份选择；上游为独立 HTTPS fixture，未使用真实账号。源代码没有 DSH 改动或插件版本变更。

序列化特别约束：发言 `representation.team_id` 是十进制字符串，不能被现有 numeric owner/Team wire 编码改写。超大 ID 已在安装后的实际 HTTP 请求验收。既有 Team/owner 接口继续使用其原有数字 int64 合同。

SDK 的草稿 get/delete 可选 `draftScope` 绑定与 UI 相同的团队草稿；发送必须同时提供被冻结的 `representation` 和 `sendAtMillis`。Tools 代表发送沿用显式用户写授权。失权错误停止自动重发并保留原内容。未来正式入群相关预览继续为 pending，属于本范围之外；个人代表路径已经 ready。
