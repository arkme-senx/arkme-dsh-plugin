# 目录读取恢复与兼容验收

内部跨仓实施记录，不属于随插件发布的产品文档。

本文件保留实施阶段历史；后续提交、最新基线、review/fix loop 与验收结论以 [合并前审核记录](read-recovery-premerge-review.md) 为准。

本次从 dev 952d83e 开始，收口时在同一任务工作区快进到 dev 3acb791（新增背景音修复，与任务文件不重叠）。不修改插件版本、根 README 或 DSH 源码；不增加部署开关。Chat 与插件为一次完整交付，服务端先上线，插件后发布。Chat 基线 master 193f8dd，Flutter 基线 pre-release 1de25ef0c。

## 栏目 owner

| 栏目 | 数据 owner | 故障与现有机制 | 本次处理 |
| --- | --- | --- | --- |
| 群聊 | Chat list | 同用户/路由锁与限频；现有分页、主会话完整 baseline | 共享原始读取；真实分页计数，不再假定 limit=0 返回总数 |
| 联系人 | Chat contacts + direct list；Backend 资料 | 每 UI 页重扫两源；资料回源可能独立失败 | 有界账号快照、绑定快照的分页、名称降级与完整性标识 |
| Bot | Bot list | 不经过 Chat list guard；本地 offset 前重复全量读取 | Bot owner 独立投影，共享请求恢复与目录快照 |
| 未标记说话人 | Audio candidates | 已有 building/stale/failed 与 cursorStale | 保留其投影状态，不解释为联系人空列表；列表接入共享恢复 |
| 团队 | Backend OpenAPI capability gateway | 受凭据 owner、权限、分页和独立失败语义约束 | 经 ReadPort 复用 Host 调度，仍由 TeamService/网关执行；创建和加入不重放 |

## 能力覆盖矩阵

| 消费面 | 接入 | 验收 |
| --- | --- | --- |
| Host owner | RequestCoordinator 管准入/恢复；各目录服务管事实投影；Team 通过接口注入 | 单测、真实 fetch 次数、账号取消、写不重放 |
| UI | 五栏目现有入口；错误保留已有行；Host 已耗尽预算不再套 UI 重试 | 五栏状态/交互测试通过；官方 DSH 包加载、未登录保护通过，登录后真实五栏尚未验收 |
| SDK | 新增 listDirectory；原有调用保持；安全 error 增加 failureKind/retryAfterMillis/retryScope/recovery | 安装 tgz 的包外 consumer 通过类型检查和五栏合成传输调用 |
| Tools | 新增 arkme_directory_list，共用目录 reader；不暴露原始 token/ID | 官方 Cordis SessionStore/SystemPrompt/ToolRuntime 实际发现及执行五栏，业务 port 使用 fixture |

## 不变量

- 同账号同参数共享原始读；参数包含真实 cursor，不以 pageIndex 代替。不同业务投影不混用。
- 服务端仍保持 HTTP 200/code 1002/原文案/data。未知可选字段不影响旧 Flutter pre-release。
- Host 同一逻辑读至多三次技术故障尝试，尊重等待提示，释放执行许可后退避；认证恢复保留既有 owner。
- 仅登记的只读操作可重放，create/send/join/pay 不因本次机制自动重试。
- 部分联系人可展示，不作为通知完整 baseline 或录音候选完整全集。
- 测试、包安装和平台实测分别记录；未执行的验收不得宣称通过。

## 验证记录（2026-09-09，本地）

- 最终 dev 3acb791 基线：插件 typecheck、build、pack 通过；全量 Vitest 458 文件通过/4 文件跳过，5105 测试通过/6 跳过。另有 Host 真实 HTTP 边界断言确保只输出安全恢复字段、不会泄漏上游数据/cause。
- Chat `go test ./gin/... ./internal/... ./pkg/...` 通过（未提供 Mongo 的原生测试会跳过依赖 Mongo 的用例，不能替代下项）。
- Chat `go test -race ./gin/response ./pkg/datastore -count=1`，显式 loopback Redis 环境下通过；真实 Redis 覆盖旧锁互斥、token 清理、续租、原限频预算、依赖异常、IO deadline 和 32 请求/16 用户/两实例竞争。该小规模实验不等价生产容量评估。
- Chat Mongo 原生集成在任务树及同 commit 干净对照树各运行一次，十一项失败完全一致；本次新增 unread 页面装饰测试没有失败。保留日志，不修改无关历史行为来制造绿灯。
- 后端 `backend_guard.sh --base-ref origin/master` 通过：failures=0/warnings=0；API 只组合 datastore 准入 wrapper，不承接业务缓存 CRUD。
- Flutter 使用真实 pre-release 解析器：phased_request_client、network_contracts、unread_snapshot_sync 三文件共 181 项通过；landing_controller 中 server-busy 后台恢复定向用例通过。只新增测试，没有改 Flutter 运行代码。
- Flutter 离线 pub get 受 GitHub git dependency/网络影响未成功；使用本机匹配依赖缓存、仅回填任务树 ignored package_config，`--no-pub` 运行。扩大到完整 landing_controller 文件另有四项尾部消费/读焦点/发送状态断言失败；本次未修改这些路径，也未做该四项的干净基线复跑，不宣称已确认无关。
- Chat `go test ./...` 的 test/e2e 启动失败：jotmo-record 挂载目录缺 go.mod，健康检查 connection refused，未进入业务断言。其他 Go 包通过。未为此创建额外工作区或修改其他仓。
- 未修改官方 npm DSH 0.1.1-rc.2，通过其 plugin add 安装本地 tgz（不是 link:），在已有验收 profile 运行；Browser 确认插件 0.1.49 加载与联系人登录保护。全部业务 URL 限定 loopback、独立测试凭据命名空间，远端同步/MCP/更新/发现关闭，未读取或替换用户常驻账号。
- 生产 user 4 的具体 trace 未在本轮确证；不能仅凭截图判定是限频、竞争还是服务依赖故障。

本地日志使用 `/tmp/dsh-read-recovery-*` 前缀；核心记录为 plugin-latest-final.log、build-latest.log、pack-latest.log、redis-final.log、chat-current.log、chat-baseline.log、chat-sweep.log、flutter-contract.log、flutter-busy.log、flutter-tests.log、backend-guard.log、web-final.log。临时日志非长期 CI 归档；发布验收应保存对应证据。

最终产物为任务工作区根目录 `dsh-arkme-read-recovery-3acb791.tgz`，版本保留 0.1.49，仅用于本地验收，不可当作已发布升级包。本次测试 Web 与 loopback Redis 在验收后停止，不改用户常驻实例。

## 实施阶段交付边界（历史）

本次为未提交的实现与测试改动，不包含 commit/push/MR 或生产发布。没有全量门禁“绝对无回归”的结论：登录后五栏真实运行态、上述跨服务环境及存量失败仍需完成/接受对应验收。发布顺序与无迁移回滚合同见 meta change `c20260909-dsh-read-recovery`。
