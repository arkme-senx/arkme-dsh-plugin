# 团队表单修复合并前审查（2026-10-14）

本次目标：删除“查询申请状态”按钮，申请后准确说明已加入或等待审批；把无效链接、失败与恢复提示改成用户能理解的文案；复用联系人既有表单样式与交互。审查对象是任务分支相对最新 `origin/dev` 的全部修改，不是此前团队消息功能的全部历史提交。

基线为 `56c3caaf148c355f0438fca84e28db9af0b01a5f`，首轮提交为 `d556fd49b821a2aa951f8fc42b64056515a2ba9b`。业务代码只在任务 worktree 修改；旧主 checkout 的既有删除改动没有参与提交。根 README、版本、锁文件、DSH 源码和其他业务仓库没有修改。

## 确认问题、根因与修复

| 问题 | 实际根因 | 最终处理 |
| --- | --- | --- |
| 已加入仍能申请，另有查询按钮 | 原表单仅存展示文案，未按当前申请结果限制写入口 | 严格识别 `joined/pending/rejected/not_member/none`；前两种显示“完成”，其他情况按结果允许用户申请；同时保护 submit handler |
| 随意输入链接后出现浏览器内部诊断 | `new URL()` 的原生异常被直接显示 | `teamMessageLinkRef` 吞掉解析诊断，统一提示完整团队链接；保留输入并标记字段错误 |
| 小表单占用 620×620 固定弹窗 | 沿用了添加联系人目录的容器 | 在既有 `DirectoryActionDialog` 增加 form 外观，复用联系人备注的全部表单 classes、tokens 和按钮 recipe；删除团队表单专用 CSS |
| 请求期间的审批事件可能丢失，读失败后缺少恢复 | 原状态读取没有保留写入/读取期间的刷新意图 | 合并刷新事件、操作结束补读；复用 `retryArkmeRead`、`withArkmeReadDeadline`；焦点、网络恢复和可见页 60 秒兜底只执行读 |
| 手机号前置拒绝被改成普通失败 | 安全文案没有保留已有 guard 的业务错误码 | 映射回“绑定手机号后继续”，保留既有绑定弹窗；拒绝后不后台读取覆盖提示 |
| 状态从 pending 自动变为 joined，目录仍可能缺失团队 | 状态读只更新弹窗，没有调用目录 owner 的刷新回调 | 成员资格发生加入/移除变化时调用已有 `onChanged`；重复相同结果不重复触发 |
| 响应丢失后，经查询确认申请再被拒绝，重新申请会重放旧拒绝 | 请求编号只在写回应成功时轮换；状态读确认后仍持有旧 UID | 状态读确认实际申请/成员结果后轮换 UID；未确认的网络失败仍保留原 UID，后台恢复绝不自动发第二次申请 |
| 不存在的团队号可能被状态读取覆盖成“尚未申请” | 明确的参数/目标拒绝仍被当作未知写入结果恢复 | 已确认的 `arkme-code-1001`、`team-invalid_request` 与手机号拒绝停止本次后台恢复，保留可操作提示 |

本轮后三项均先以新增或加强的回归测试复现失败，再修复、复验。真实服务复验确认申请被拒绝后新 UID 会生成更高 revision 的 pending 申请，已有成员的成员信息不会因再次加入而改写。

## 场景与完整代码链路

路径以下均以当前仓库根为起点；服务端路径分别属于 Team、Record 的已验证开发基线。

| 用户场景/边界 | 实际实现链路 | 验证证据 |
| --- | --- | --- |
| 创建团队，输入格式/名称长度/占用检查 | `TeamDirectoryActions` → `callArkme(team.app.create.check/create)` → `host-api` → `TeamAppService` → Auth 命名目录 / Team `create` → `teamCompound.Create` 的创建、claim 和激活 | 全仓既有创建/占用竞争测试；真实浏览器创建并从 Team `list-mine` 核验名称、即我号和 owner 角色 |
| 普通公开加入 | 表单 → phone guard → Host `TeamAppService` → `join-by-jotmo-id` → `JoinByJotmoIDWithState` → `ActivateMember` 的事务资格检查 | 真实浏览器显示已加入；Team 状态确认 joined |
| 普通审批团队、官方团队已有成员再次加入 | 相同 App 加入入口；Team 先读取 owner/active member，再判断审批条件 | 两类团队均真实浏览器验证“已加入”和无申请按钮；前后成员列表数据一致 |
| 首次审批申请和审批拒绝 | App 适配器仅在 `approval_required` 后调用 `join-requests/create`；Team `Admissions.Apply/Decide` 维护申请 revision，与成员事实分开 | 真实 Team pending/rejected；服务响应丢失注入发生在真实事务提交之后 |
| 拒绝后重新申请 | 状态确认 → 新请求 UID → `Admissions.Apply` 比较旧 UID/state 并递增 revision | 单测先失败后通过；真实申请 revision 增长、两次显式申请的 UID 不同 |
| 等待审批后获批，无 IM 进程时返回页面 | scoped 状态读 → `join-requests/status` → `TeamJoinStatus` 读取当前成员资格 → `onChanged` → `ContactDirectorySurface.load('teams')` | 真实浏览器显示 joined，关闭后团队目录立即出现目标团队；没有第三次申请写入 |
| 已批准后离队/被移除，批准历史重放 | Host 对 approved 申请回读当前资格；Team 状态将历史 approved 映射为 not_member；表单按资格变化刷新目录 | 既有 Host approved replay 测试；新增移除刷新回归；真实成员撤权和 not_member 状态 |
| 写回应未知、连续点击、刷新事件风暴 | `submitting` 防重入；保留 requestUid；状态读串行并合并后续刷新 | 单测覆盖未决请求与事件合并；真实提交后丢 ACK 再读取，不自动重复写 |
| 读期间切换团队号、关闭、切换账号 | input 取消状态 reader；lifetime/controller/sequence 过滤旧读；child 以 accountKey remount；`callArkme` 和 Host `assertViewer/assertAccount` 在请求前后校验账号 | 单测覆盖 backoff 取消、旧读覆盖、关闭后的回调、账号隔离；真实链路多角色 logout/login 和权限验证 |
| 持续/瞬时网络失败 | 单轮最多 3 次只读尝试，30 秒总读取期限；保留已确认状态；焦点/online/可见页兜底恢复 | 单测重试次数与取消；真实浏览器隔离 HTTP 失败恢复；未知错误诊断不会进入表单 |
| 不存在团队/手机号未绑定/登录失效 | 已知错误码映射固定产品文案；明确前置拒绝停止状态恢复；手机号沿用既有社会行为 guard | 不存在团队真实服务场景；guard 测试断言只有 profile refresh、没有 provider 写；浏览器“暂不绑定”后保留表单提示；安全错误映射测试 |
| 随意文本、相对链接、HTTP、错误 path/ref、重复 channel、凭据、hash | `teamMessageLinkRef` 只提取合法 HTTPS 链接的 32 位 publicRef；无效输入停留表单，不打开对话 | 参数化回归；真实服务浏览器 `dawd` 文案和无 open 请求断言 |
| 正确链接、两个访客、后来加入团队 | 表单 → `openTeamMessages` → 既有页面 intent → `team.app.open` → Team `conversations/open` 的成员/访客资格；访客与团队 side 独立 | 真实链接打开、访客隔离；同一用户成为成员后两侧草稿仍独立 |
| 消息发送、响应丢失、阅读、并发编辑、撤权 | Host 持久发送任务 → Team 接受事务与消息关系 → Record 唯一正文；阅读游标归 Team；编辑经 Record CAS；当前资格再次鉴权 | 真实 Team + Record + Mongo 事务 + RabbitMQ；相同发送命令重放只有一条正文、阅读状态、并发编辑冲突、撤权、删除和申请管理均跑通 |
| 官方常开与普通通道暂停/恢复 | Team `RequiresApproval/ConfigureChannel` 与 `ChannelView.can_pause`；UI 消费能力元数据，不按名称猜权限 | 修正旧 E2E 将官方通道用于暂停断言的场景错误；分别验证官方 enabled=true/can_pause=false 与普通通道暂停拒绝发送、序号不增长 |
| 窄窗、键盘与提交期间关闭 | 现有联系人 form CSS → 共享 dialog 初始聚焦、Tab trap、关闭恢复焦点；busy 阻止关闭、输入 readOnly；IME Enter 不提交 | 官方安装包 Chrome 表单场景：420×480 边界、Esc、Tab、取消/关闭禁用、可理解反馈；全仓既有联系人和弹窗回归 |

## 最终验收与范围

- Node 24.19.0；`pnpm test`：955 个文件通过、15 个文件跳过；11,261 项通过、20 项跳过。跳过项没有算作通过。
- `pnpm typecheck`、`pnpm pack` 的 prepare/build/types/bundle、`git diff --check` 通过。最终不可变包版本保持 3.0.7，SHA-256 为 `491f8de8c0374d18b79b2b0cf6ecf701ef358948fbc1b51f08971095b2cfd2bc`。包内无测试目录、node_modules、密钥/日志和本机任务绝对路径。
- 官方 DSH 0.1.5-rc.2，源码 HEAD `fb2c4b9e698e30edb738bca4cf0618587db7d203`，通过官方 CLI 将最终 tgz 安装到全新 Profile。没有手工 symlink 或源码替代包。
- Team 开发基线 `8c7e438dfd77e7837c47513845f647b155f0382d`；Record 开发基线 `732a36bf7dc61fefd509671a5e1407da0c2068fd`。从远端基线快照构建未修改服务代码，使用任务自有 loopback 进程、Mongo replica set、RabbitMQ、Redis、OpenSearch。账号登录/公开身份/命名目录及不相关旧页面为合成 fixture，Team/Record 请求和业务响应没有被替换。MQ 通知绑定到隔离 observer queue；没有运行完整 IM 服务或验证生产系统推送。
- 浏览器真实链路执行 `vitest.team-channel-e2e.config.mts`；表单布局/键盘/断网/手机号场景执行 `vitest.team-layout-e2e.config.mts` 并设置 `ARKME_TEAM_DIALOG_ONLY=1`。后者是模拟 Team DTO 的 UI 验证，与前者的真实服务证据分别记录，不互相冒充。
- 最终包复验：真实服务浏览器测试通过（65.55 秒），表单浏览器测试通过（8.53 秒），均无未处理页面异常或清理失败。
- 原完整 layout 测试在此次未改基线 `56c3caaf` 上同样在图片加载断言失败，已做基线对照。该既有媒体夹具问题不归因于本次表单修复，也没有删掉默认媒体断言；表单专用入口只收敛表单验收范围。
- UI 为本次能力面；Host、Tools、SDK 没有增加业务入口，继续使用原 App owner。没有数据迁移、生产配置或服务端发布要求；本次未合入共享 dev、未创建 PR、未生产发布。
- 已实测 macOS Chrome 与官方 DSH 安装路径含空格的场景；Windows/Linux 没有做运行态验收。没有修改或重启用户常驻 DSH/Profile。

最终两项浏览器验收和上述门禁全部通过。本次范围内未发现剩余合并阻断项；业务写入、当前资格、申请历史和用户反馈仍分别由原 owner 负责。原始运行日志与截图保留在任务 evidence 目录及隔离验收目录，生产凭据未写入仓库。
