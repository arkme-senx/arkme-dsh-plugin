# DSH 远控连接恢复

远控由登录账号作用域内的 Host 持有，与桌面是否显示 DSH 会话无关。连接只有完成 WebSocket ready、命令频道订阅和 Host lease 注册才可用。完整工作区/会话快照在连接完成后异步同步；账号及会话所有权验证仍须先完成。

Transport 默认在最后一次有效入站协议帧/服务端 Ping/Pong 后 45 秒终止失活 Socket，不以发包、HTTP 同步或 `readyState=OPEN` 延长该期限。默认 `ws` adapter 使用公开控制帧事件；自定义 socket factory 必须提供 `subscribeHeartbeat`、`terminate`；缺失时明确拒绝能力，不带着不完整的保活语义运行。

每次连接尝试总预算 30 秒，注册控制面单步最多 10 秒；所有取消和回调带连接 generation，旧订阅退出不会取消新订阅。连接被同身份替换时旧 Host 退出自动重连，避免双实例互相抢占。其他可重试错误复用已有 1–30 秒退避，稳定 60 秒后重置。

`lifecycle.get` 由受控桥的 `capabilities.get` 显式声明：原生生命周期取样不阻塞账号轮询；已提供该能力时，resume generation 变化使旧连接重新验证。未提供原生能力的 Harness 通过 Transport 入站活性确认连接，不根据错误文案猜测版本。缓存中的 suspended 提示不阻止连接恢复。该桥不承载新的业务数据或模型工具。

## 诊断部署

关键事件默认进入 Harness 日志，含 user/client/runtime、attempt、connection/lease generation、HTTP request_id 及 App/Harness/插件版本。逐帧日志仍受 `ARKME_DSH_REMOTE_DIAGNOSTICS` 控制，不默认开启。

`dshRemoteSentryDsn` 配置为该环境的 Sentry 项目 DSN 后，Host 通过隔离的 NodeClient 上报连续失败/恢复；不安装全局 Node 监控，不记录错误原文、凭据、工作目录或对话内容。未配置时保留本地日志与有界诊断缓存，不声称已具备远程 Sentry 交付。

一次 episode 在三次失败或持续 60 秒后汇总一次，恢复另记一次。最近状态最多 32 条，事件最多 24KiB；待发送事件最多 100 项、每项 24KiB、保留七天，落盘不超过 3MiB。持久写入合并，发送由现有 Host poll 驱动，最多一个 flight、30 秒失败重试间隔。账号切换清除不属于当前账号的积压。

保活改动的 Tools/SDK：未新增业务能力，现有 remote.getStatus 和业务操作保持契约。UI：手机消费独立连接失败状态；桌面业务不因远控故障重启 Harness。Client：lifecycle.get 增量桥需配套测试；旧客户端不支持时降级。

验证命令：`pnpm test`、`pnpm run typecheck`、`pnpm run build`。`tests/dsh-remote-socket-liveness.integration.test.ts` 使用本地真实 WebSocket 验证无关闭通知的静默失活与替换握手；假时钟测试覆盖 deadline、资源释放、旧 generation 和慢快照。正式交付还需用目标平台和实际 Release Set 验收睡眠/网络恢复及 Sentry 入站。

账号切换使旧后台快照的 generation 和取消信号失效，迟到结果不得完成新账号的投影或污染告警。诊断配置无效只降级日志；缓存加载重建允许字段，异步入队与发送以账号 generation 隔离，日志收尾具有总时间上限。

## 移动端入口跟随桌面当前会话

`session.current` 是 Host 声明的增量只读能力。内嵌 DSH 页面通过公共 `ISessions.list.current` 读取选择，Arkme 自己的 surface 标记提供当前账号和页面可见性；独立小模块只进入 iframe Boot graph，不加载外层业务 UI。普通聊天、日历、登录页或没有当前会话时清空选择。列表更新但选择未变不会发请求。可见会话每 10 秒续期，窗口状态最多 8 个、按 Host 单调时钟 30 秒过期，无业务历史或排序字段写入；账号退出清空；页面关闭或刷新通过同源 beacon 清空选择，页面恢复重新读取公共选择状态。

Host 的 `currentSession` 通过只读 Session 归属查询及公共会话列表验证归属、目录、归档和 subagent 状态，不认领未知会话，不改写归属文件。`session.current` Realtime 请求、SDK `currentDesktopSession()` 和只读工具 `arkme_current_dsh_session` 共用这个方法。Browser `remote.reportCurrentSession` 只报告真实页面状态，要求同源和当前账号；不向 Tool 提供伪造用户页面选择的写入口。

手机只在普通 DSH 入口执行一次有 2 秒总预算的读取，优先查询上次使用的在线 Runtime；没有可用选择时检查其他支持该能力的在线 Runtime。旧 Host 不声明能力时不发送新请求。超时、失效、账号变化均回退本地上次会话。显式会话路由、指定目录新对话以及用户手动导航不跟随；进入后不持续跟随桌面跳转。

手机入口等待预算只限制查询等待和应答 waiter，保留原有 30 秒远端命令执行窗口。加载期间输入区可用；输入、焦点、菜单、侧栏和应用退后台都会撤销自动导航，撤销标记持续到首次页面安装前，已展示的会话仍按原有 generation 处理后续刷新。


## 流式投递批处理与耗时诊断

Host 的单一消费者在上批完成后，从当前缓冲取下一批。空闲时 assistant/chunk 最多合并等待 40ms，语义事件或达到 50 项/32KiB 后立即唤醒消费者；同会话按 canonical seq 保序，不让工具结果或 turn/end 越过前文。不同会话每批轮转，共享现有 ChannelManager 的串行发送和分片协议。单条超出 32KiB 的事件沿用既有分片路径。

缓冲最多 4096 项、64MiB 序列化 payload、256 个待处理会话；这些是缓冲容量，不是进程 RSS 上限。容量满后保留会话序号水位，用现有公开 Host history 逐段读取 canonical 事件，再依次归档、投递；读取受既有 64MiB 响应预算约束，失败不推进水位，2 秒后重试准备。超过会话容量显式记录投影错误，原始 DSH 历史仍由既有 owner 持有。账号/Runtime 队列关闭时清除缓冲和 timer，迟到结果不能投递到新作用域。

保留原有 capture-before-send 顺序及归档失败的 historySyncError 降级，不把实时传输成功等同于持久化成功。发送重试仍只由 ChannelManager 按稳定帧 ID 最多尝试三次；重试耗尽后记录投影错误，由既有历史恢复补齐，不重新执行已完成的 Turn capture。桌面 Agent 的事件生产不等待归档或 ACK。

默认 `live_delivery_window` 每 10 秒最多一条，复用 Host poll 和现有日志出口。含 user_id/runtime_ref、batch_count/event_count/incomplete_batches/replayed_batches、payload_bytes、pending_entries_max/pending_bytes_max，以及 queue_ms、ownership_ms、capture_ms、channel_queue_ms、publish_ack_ms 的 sum/max。capture_ms 包含 outbox 队列等待及落盘调用；publish_ack_ms 包含分片、重试和等待确认，不是单次网络 RTT。replay 的 queue_ms 是原积压起点计算的保守年龄。incomplete_batches 表示未完整确认的批次；event_count 是尝试处理数量，不是已确认数量。指标使用单调时钟；不包含事件正文或凭据，不挤占连接故障的 32 条上下文，不新增 Sentry 连接事故。

受控性能回归：`pnpm exec vitest run tests/dsh-live-batching-benchmark.test.ts --disableConsoleIntercept`。它对比相同生成流和模拟归档/ACK，不能替代实际 Profile、设备和网络验收。

## DSH Gateway 兼容

旧版通过 `apiProxy` 创建远控 Host；新版通过 `typertGateway`、`sessionController`、`workspaceController` 和 `connection` 创建同一个 Host。两者仍由账号作用域持有，不改变 Realtime 协议、租约、心跳和重连策略。功能关闭或依赖缺失时，Host API 返回具体原因；普通业务请求不执行远控诊断探测。

新版在 `gateway-api.ts` 适配公共接口：

- `session.list` 使用 Gateway 的 `_request` 命名参数；发送把已有稳定 RPC ID 映射为 `requestId`，不另造去重标识。
- 工作区读取消费 `workspace.follow` 的首个 baseline 后立即取消、关闭迭代器；历史读取从 `session.follow` 获取确定水位，再以 `throughSeq` 调用 `session.page`。读取不恢复 Agent。
- 实时日志使用一条公开 `session/event` 订阅；`session.control` 提供基线和 goal 投影；Gateway `$events` 提供问题和审批，结果通过公开的进程内 Connection Fetch carrier 回传。不会对每个历史会话建立 follow 流。
- 交互必须匹配本代事件 ID 和 Session；过期事件不可回答。保留原有审批安全限制：上下文不完整时只允许拒绝，不能远程批准。
- 本地事件缓冲最多 1024 帧、8 MiB，待处理交互最多 256 个。超限使本代失败，交由已有订阅恢复逻辑重新建立基线，不新增重连 owner。取消时移除日志监听、取消两条流并清除本代交互。

该适配转发新版的已提交 canonical 事件。新版进程内 `assistant-stream` 的无序号临时片段不伪装为 canonical 日志；逐 token 展示不在本次协议适配的验收范围。

能力面保持原合同：Host 是唯一远控业务 owner；现有 SDK、UI 和 `arkme_current_dsh_session` 工具继续消费同一 Host，无新增业务入口。客户端和 DSH 源码无需修改，桌面生效仍需正式插件制品发布与客户端消费。

回归：`NODE_OPTIONS=--no-experimental-webstorage pnpm test`、`pnpm typecheck`、`pnpm build`。`dsh-remote-gateway-api.test.ts` 覆盖参数映射、分页水位、事件和交互、取消、积压上限；`dsh-remote-host-api-sdk.test.ts` 覆盖缺失依赖诊断。旧版适配器和 WebSocket 保活测试继续运行。

2026-09-16 在独立数据目录、独立凭据前缀、空闲端口的未修改 DSH `0.1.5-rc.2` 中安装本地 `.tgz`：Host 成功创建，未登录时返回登录提示；真实 Gateway 验证了工作区、创建/列举 Session、历史首屏和分页、发送参数进入业务校验，以及问题回答和审批拒绝的往返。审批探针走公共 scoped waterfall，不执行工具。该 CLI 探针没有使用生产账号发送提示词，未验证真实模型响应、生产 Realtime 注册/心跳、移动端消费或 Windows/Linux。

随后使用客户端官方 master 基线 `f5e0c00` 启动独立 App Data 的 macOS 开发实例，加载本次插件与 DSH `0.1.5-rc.2`。实例通过正常登录态读取完成生产 Realtime 注册，`remote.getStatus` 返回 `available/enabled/connected=true`。该证据证明连接和注册，实际远程操作由用户在此常驻实例回归；开发路径运行不等同于正式 Release Set 发布。

## 原生远程订阅与交互回复（2026-09-21）

控制端由 `DshAccountSessions` 持有逻辑订阅的连接引用，同一 Runtime 的连续 pull 和并发订阅共享一条 Realtime 连接。账号内最多 8 条 Runtime 连接、64 条原生订阅；close、done、失败和账号退出释放引用，丢失 close 时按源 Host 同样的 45 秒空闲期限回收。并发路由发现共用一个 flight，单个调用取消只移除自己，最后一个调用退出才取消底层请求。存活连接的路由结果最多复用 5 秒，断开及 Host generation/lease 失效立即废弃；每次实际请求仍由 Realtime 和 Host 校验归属及精确租约。

Browser 将传输中断标记为 DSH 官方 `dshRemoteStreamFailure.kind=carrier`，业务拒绝保留错误码并终止。原生和云端订阅过期属于可重试错误。首帧前失败在当前 opener 内恢复；已经交付快照后交还官方 `RemoteStream` 开启新 generation，避免同一代重复 opening cursor。每个 Runtime 共用一个 250 毫秒起步、5 秒封顶并附加至多 25% 抖动的重试时钟；取消和 pagehide 停止重试，close 最多等待 3 秒。该恢复只作用于订阅，不自动重放写命令。

Host ChannelManager 使用两个有界 FIFO 通道，最多同时等待两个帧 ACK：历史、native pull/page、投影事件沿原 bulk 队列发送；不超过 32 KiB 的交互回复使用保留通道。每通道最多 64 个逻辑载荷，两通道待发原始 JSON 合计最多 64 MiB，超限显式失败。各载荷的分片顺序、重试 ID 和三次发送上限保持不变；事件之间仍按原顺序发布。现有 `queue_ms` / `publish_ack_ms` 分别记录排队与发送时间。

回归覆盖连续拉取连接次数、并发调用独立取消、45 秒回收、换账号、Host 换代、重复断流、鉴权拒绝、发送积压上限和关闭后的排队清理。可选的官方兼容测试通过 `DSH_GATEWAY_PACKAGE=<已安装 dsh-api-gateway 的包目录>` 运行 `tests/harness-native-transport-script.test.ts`，实际装配未修改的官方 Client Gateway 与 RemoteStream，验证传输断开且连续两次重开失败后仍能在下一代恢复。

Tools/SDK 继续使用既有账号 owner，无新增业务入口；UI 只修改既有传输恢复。客户端、后端与 Realtime 服务契约不变。以上确定性测试和官方包兼容测试不等同于双电脑、睡眠唤醒、长时间弱网或 Windows/Linux 实机验收；桌面生效还需正式插件制品被客户端消费。
