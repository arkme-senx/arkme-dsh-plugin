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
