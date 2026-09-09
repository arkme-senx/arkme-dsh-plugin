# 目录读取恢复：合并前审查与修复记录

2026-09-09。本轮结论覆盖任务开发分支 `codex/c20260909-dsh-read-recovery`，不代表已合并或已发布。

后续用户体验复审发现跨页选择、资料降级状态及分页有效期衔接缺口，已按用户补充继续修复；当前体验合同以 [用户体验收口记录](directory-user-experience.md) 为准，下文保留此前一轮的验收事实与限制。

## 基线、范围与结论

- 插件已合入最新核对的 `origin/dev`：`92605ab`；Chat 已合入 `origin/master`：`d5786e6`，无文本冲突。Flutter 基线为 `pre-release 1de25ef0c`，meta 为 `master f28fa725`。
- 继续原任务工作区，没有新建独立 worktree，没有移动用户改动。原业务 checkout、常驻 DSH、版本号、根 README、生产配置与生产数据均未修改。
- 本次代码范围内已确认的问题已修复并复验；不能给出整个项目无条件上线绿灯：宽范围历史失败和部分服务真实环境验收仍未关闭，详见下文。
- 先部署 Chat，再发布插件。无开关、灰度、数据库迁移或双态兼容分支。旧 Flutter 的运行代码完全不改；服务端保留旧响应外壳，仅增加可选结构化错误。

## Review / fix loop

| 已确认的问题 | 修复位置与语义 | 复验 |
| --- | --- | --- |
| direct 源响应形状错误被当空数组，误形成完整联系人集合 | `contact-directory-service.ts` 严格校验两源 items；结构错误不转成技术降级 | 畸形响应不能被展示/录音消费为完整集合 |
| countOnly 丢失 refresh；资料失败后展示仍被当新鲜 | count 传递刷新选项；身份 coverage 与展示 projectionState 分开 | 显式刷新回源；资料失败可保留完整身份但标记 stale |
| partial 刷新替换旧联系人，可能丢行/选择 | `contact-directory-state.ts` 仅联系人缺源 refresh 合并旧行；完整刷新才替换 | 红灯→绿灯；群聊普通分页仍替换，未混用两种 partial |
| 独立凭据 owner 在读取期间切号可返回跨身份结果 | `ServiceRuntime.runOwnerRead` 准入前/返回前核对原账号与登录凭据 | 切号拒绝；正常短 token 刷新不误伤 |
| 团队写后读取可能加入写前 flight | ReadPort 提供 `withOwnerReadInvalidation`，绑定原 scope、finally 精确失效 Team list | 创建/加入及未知写结果均失效；原读可结束，新读独立回源；写仅一次 |
| 租约响应晚于准入期限仍能执行 handler；已过期预算误标依赖失败 | `read_request_lease.go` 准入前及成功取得租约后核对期限，晚到 token 安全清理 | 两个确定性失败用例修复后通过，race 与真实 Redis 通过 |
| 极长重试提示使 Node timer 溢出为 1ms，造成忙循环 | Coordinator 对物理 timer 做 int32 安全边界，逻辑 route cooldown 保留原时间，总 deadline 先结束请求 | 60秒、int32 上界及30亿毫秒；超界 timer 红灯→绿灯，尝试不增加 |
| 三处相关旧测试夹具不满足当前业务合同 | Chat list E2E 使用入群游标基线；等审核通过后断言未读；场景账号隔离限频预算；隐私查询夹具补真实 direct pair key | 不改入群、审核、限频、隐私业务语义；相关 E2E 与 Mongo 30 项通过 |

## 场景到代码的闭环映射

| 用户场景 / 边界 | 前端→Host→事实 owner | 证据与不变量 |
| --- | --- | --- |
| 首次进入五栏目、展开、折叠后返回 | `ContactDirectorySurface` → `directory.list` → `readDirectoryPage` | 实际安装包页面五栏均展开；不是以 HTTP 200 代替页面验收 |
| 群聊计数、第一页和后页、隐藏首页/冻结/退出 | `SourceService.countGroupSources/listSources` → Chat list → conversation projection/member/policy | 真实分页计数，30项 Mongo 与 list E2E；隐私和首页隐藏不混同 |
| 联系人双源去重、资料降级、部分失败 | `ContactDirectoryService` → Chat contacts + direct list；Profile 只装饰当前页 | live test 与 Browser 实测缺源“2+”保留两行；恢复后点击重试回到“2”并消除提示 |
| 联系人计数后翻页 | `DirectorySnapshotStore` → 账号/版本快照 → 有签名 cursor | live test 计数后翻页仅请求当前页资料，不重新扫描两源；cursorStale 重新开始 |
| 旧游标、刷新后游标、切号复用游标 | snapshot ID + section + user ID 签名；UI generation/accountKey | 过期重启；跨账号403；不跨快照继续 offset |
| Bot 完整列表与本地分页 | Bot owner → Bot list → 独立 Bot snapshot | 不经过 Chat guard；Host 技术恢复；count/page 共享 Bot snapshot |
| 未标记说话人统计与分页 | UnmarkedSpeaker owner → Audio unmarked-speakers/list | 保留 Audio 的 fresh/stale/building/failed 和原 cursor；不借联系人身份合同解释音频候选 |
| 团队目录/成员/创建/加入 | TeamService → OpenAPI gateway → managed credential owner | 只 list 接读恢复；成员展示降级不改变成员事实；创建/加入不重放 |
| 同账号同参数并发；不同 cursor/参数 | `ServiceRuntime` → `ArkmeRequestCoordinator` | 同完整参数单飞，不同参数独立；数组顺序保留；账号/route 调度与既有 lane/service 配合 |
| 一个观察者取消、最后观察者取消、退出账号 | Coordinator / snapshot observers / scope invalidation | 一个消费者取消不杀其他消费者；无人观察才取消；账号清理阻断旧结果落缓存 |
| 竞争/限频/依赖不可用 | Chat route → bounded lease → original rate → handler → response enum | 真实公开路由验证 contention 与 rate；Redis race 覆盖依赖失败和旧 token 协议 |
| deadline、长 Retry-After、恢复耗尽 | Host recovery → safe metadata → UI `retryArkmeRead` / root directory | 最多三次技术尝试；等待释放执行许可；Host 已持有恢复预算时 UI 不再嵌套重试 |
| 业务拒绝、认证异常、发送/加入/创建等写入 | 原业务与认证 owner；只登记的纯读可重放 | 1001/1004/1100/2001 不被猜成繁忙；写不自动重放；不新增幂等 owner |
| 未读列表小页、全量 badge、全已读/静音/通知关闭 | Chat repository 轻量扫描 → `includeUnreadItem` → 返回页 decoration | 全量汇总但只装饰返回页；同一统计口径；不更改 read cursor、审核公开性和记录 owner |
| 通知 baseline、录音候选全集 | 主会话目录保留既有完整 baseline；录音读取要求 contact coverage complete | partial 仅供目录展示，不当作完整全集覆盖下游 |
| UI / SDK / Tool | 同一个 `ArkmeDirectoryReader` | SDK feature 检测；真实 Cordis Session/ToolRuntime 五栏发现/执行；Tool 无假附件依赖 |
| 旧 Flutter、未知新增错误字段 | 旧 HTTP/code/message/data → pre-release 原解析器 | 181 项测试通过；五种 metadata × 四条读路径，不修改 Flutter runtime |

## 本轮验证结果

- 插件全量：473 文件通过、5 文件跳过，5460 测试通过、7 跳过。含新增 opt-in live test，默认跳过该测试是因为没有指定本地 Chat 服务，不是成功冒充真实联调。
- 插件 typecheck/build/tgz 打包通过；最终验收产物保持 0.1.49。官方 npm DSH `0.1.1-rc.2` 未修改，继续使用原验收 profile，通过官方 plugin add 安装 tgz；非 link/source overlay。
- `read-recovery-live.test.ts` 显式指定本地 Chat 时通过。UI/SDK→真实 Host→真实 Chat/Mongo/Redis 已贯通；Bot/Audio/Auth 资料与 OpenAPI 上游是显式 fixture，Team 仍执行真实 gateway、凭据接口和业务投影。不能把 fixture 称为远端成功。
- Browser 手动操作：进入联系人，展开五栏；离开后返回触发过期刷新；注入 direct 源故障后原两行保留、出现补全告警；恢复后点击重试，完整计数恢复。HTTP 控制夹具阻断非目录业务写，不触碰真实用户登录。
- Chat `go test ./gin/... ./internal/... ./pkg/...` 通过；其中无配置的 Mongo 用例按原约定跳过，另有下一项真实 Mongo 证据。
- Chat Mongo 定向：30 项通过、无跳过，包含 unread 全量摘要/分页/页装饰、list/filter/cursor、display-snapshots 一致性。
- Chat Redis + `-race ./pkg/datastore ./gin/response -count=1` 通过；`TestReadRecoveryPublicRouteClassifiesContentionAndRate` 在真实 Gin 路由通过。
- Chat list/unread E2E：常规5项通过；另显式启用 slow 单独执行 `TestChatListDoesNotDependOnRecordService` 通过，真实停止 Record 后 list/detail 仍可读、正文装饰降级为 unavailable，再恢复 Record。Record 依赖为现有仓库 `95712aa`，不是本次改动仓库。
- 后端分支 guard：failures=0、warnings=0。Flutter 三个合同/未读文件181项通过。

## 尚未关闭的全项目门禁

1. Chat 完整 Mongo sweep 本轮11项失败。相同配置的既有干净 `193f8dd` 对照树15项失败，本轮11项均在该基线失败集合中；不能把这一较旧对照说成最新 master 的全绿证明。另有3项举报测试在最新上游已变化，1项隐私夹具由本轮修正。失败保留涉及 extension hydration、private supplement 夹具、read receipt 前置条件、member/mirror 测试与 publicity fixtures；不修改这些无关业务来制造绿灯。
2. Flutter 全量 `chat_session_landing_controller_test.dart`：113通过、4失败（尾部消费/读焦点/发送状态）。`git diff --exit-code origin/pre-release -- lib test/features/chat/chat_session_landing_controller_test.dart` 通过：运行代码与该测试文件均完全相同，本次仅另一个测试文件新增兼容断言。
3. Auth/Bot/Audio/OpenAPI 真正远端环境、生产 user 4 的 trace、Windows/Linux 实机并未在本轮验证。不等同于代码失败，也不构成完整发布验收已完成的证据。

这些限制没有被灰度或兼容代码掩盖。当前可交付为“本次范围已修复、定向门禁通过、全部改动已进入任务开发分支”，不能替代未完成的全项目发布验收。

## 复跑入口与证据

- 插件：`pnpm test`、`pnpm typecheck`、`pnpm build`；真实链路：`ARKME_DIRECTORY_E2E_CHAT_ORIGIN=<isolated-loopback-chat-origin> pnpm test tests/read-recovery-live.test.ts`。
- Browser 模式再提供 `ARKME_DIRECTORY_E2E_DSH_ORIGIN=<isolated-loopback-dsh-origin>`；测试仅代理官方 DSH 页面，目录走真实 Host，其他 API 不允许透传写入。完成后关闭页面并调用该夹具 `/__fixture?finish=1`。
- Chat E2E 使用仓内 `test/e2e/docker-compose.yaml` 与现有 `JOTMO_CHAT_E2E_*` 环境契约。原生 Mongo 显式给 `JOTMO_CHAT_CONFIG_PATH`，使用仅 loopback 的独立测试 DB；Redis 用 `JOTMO_READ_GUARD_TEST_REDIS`。
- 本机证据前缀 `dsh-read-recovery-review-`：plugin-final、typecheck-final、build-final、live、browser、public-guard、e2e-green、mongo-final、mongo-sweep、mongo-baseline、race、flutter、flutter-landing、backend-guard。日志为本地诊断证据，CI 应独立归档复跑结果。

生产发布与合并主干未执行。回滚无需撤销数据迁移：插件回退旧包、Chat 回退上一构建即可；保留原锁协议和响应外壳使服务端先上、旧客户端继续工作。

最终本地验收包 `dsh-arkme-read-recovery-verified.tgz`，SHA-256 为 `965ba90af356a71f2b82313ea96ad815ad3b6860d78c4688a9f6ef24387b00cd`。该包已重新通过官方 plugin add 安装；包外 Consumer 使用公开 SDK 导出完成类型检查和五栏目合成调用。无产品版本号变更，不将同版本测试包称为已发布更新。
