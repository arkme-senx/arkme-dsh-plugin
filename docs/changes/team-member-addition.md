# 团队批量添加同事（T22）

管理员从现有联系人、最近私聊、展开的群真人中选择 1–50 人，直接加入为普通成员。Team 是成员事实 owner；开通收件箱的团队使用同一命令，原本人加入/申请仍保留原审批规则。界面明确提示新成员获得团队已有共享内容的访问权限。内部群同步属于另一条业务链。

## 能力矩阵

| 消费面 | 入口与统一语义 | 验证 |
| --- | --- | --- |
| UI | 团队详情 → 添加成员；真实逐人回执；成功移出选择，失败保留；未知批次锁定并恢复 | DOM 测试、安装 tgz 后真实页面 → Team HTTP → Mongo |
| SDK | `teamMemberManagementV1`；`teamMemberManagement(request)`；teamRef 使用 `getTeamProfile().profileRef` | 仓外 strict NodeNext Consumer，真实 Host HTTP，能力缺失及 AbortSignal |
| Tools | `arkme_team_member_candidates`；`arkme_team_members_add`（明确用户写授权） | 官方发布版 DSH 0.2.1-rc.2 的真实 Session、发现、拒绝未确认写入、实际调用 |
| Host owner | `TeamMemberAddition`；TeamAppService 只适配账号/引用/HTTP；三面不复制命令逻辑 | 幂等、未知结果、回执校验、持久恢复与账号隔离测试 |

公开结果只有 opaque key、展示名、逐人状态和批次总数/版本。原始身份 ID、登录凭据和服务间密钥不越过 Host。候选人的每页状态用 Team `members/query` 查询，不再全扫整队。

Host 在发请求前，用既有私有原子状态文件保存原 UID 和不可变目标；结果不明时不换 UID。只有完成结果已应用，调用者才执行 `ack`。Tools/SDK 的 `recover/retry` 不需要仍有效的候选引用；后端对首次写入重新检查当前管理权限。同 UID 不同目标会冲突。名单使用一致版本快照及服务端 cursor；过期页明确要求重读。

## 可复验安装链

1. 先构建并 `pnpm pack`；使用官方 CLI 在全新的 `DSH_HOME` 建立 web Profile，通过 `dsh plugin --profile <name> add -w <tgz>` 安装。不得复用真实 Profile。
2. Team 运行 `TestMemberAdditionClientFixture`，传入隔离副本集 `JOTMO_TEST_MONGO_URL` 和空目录 `JOTMO_T22_CLIENT_FIXTURE`；该夹具仅发布本地 `ready.json`，不使用真实账号。
3. 在该目录生成 localhost/127.0.0.1 测试 TLS 证书 `tls.key/tls.crt`。`upstream.mjs` 使用 `ARKME_T22_FIXTURE_DIR`，将 Team 路由转发给真实 Go fixture；仅账号/联系人源是测试 seam。`overlay.json` 将所有 Arkme 上游地址设为该测试 HTTPS origin，并关闭生产、自动更新和远程扩展发现。禁止用默认生产配置启动验收。
4. 将仓外 `tests/consumers/team-members/consumer.ts` 放进 Profile 的独立 `member-consumer` ESM 包，以 strict NodeNext 编译为 `out/consumer.js`。将 `session-consumer.mjs` 复制到 Profile 根，在测试 overlay 插入该模块；其注入官方 agents/tools/sessions 和 Arkme Host。
5. 以 `NODE_EXTRA_CA_CERTS` 指向测试证书，启动官方 DSH web，日志保存在 fixture 的 `dsh.log`。`browser-driver.mjs` 用 `ARKME_T22_PLAYWRIGHT_PACKAGE` 指向装有 Playwright 的独立包的 package.json；只操作该隔离实例，并输出 `acceptance.json` 和截图。该驱动只允许移除已知夹具团队中的测试人，以便重复验收。
6. Flutter 的 `test/integration/relation/team_member_addition_clients_test.dart` 使用同一个 `ready.json`（环境变量 `JOTMO_T22_FIXTURE_READY`），验证跨客户端人数、原回执不复活已移除成员、重新加入新代际。

这些环境变量只用于测试，不是产品配置。关闭 fixture 前写入目录下 `stop`；清理本次创建的临时 Profile、测试进程与数据库，不操作常驻实例。
