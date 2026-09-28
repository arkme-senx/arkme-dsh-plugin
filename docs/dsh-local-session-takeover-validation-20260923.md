# DSH 三端连续发送验收（2026-09-23）

## 新会话目录延迟（2026-09-23 补验）

定位到目录原先仅每 5 秒刷新；本页涉及 17 个历史实例，每轮逐实例查询工作区；首条 DSH 输入还重复失效整个账号请求作用域，取消并发目录读取。最后一项由真实 `ArkmeStaleRequestError → invalidateScope → createDSHAgentInputText` 堆栈确认。继续实测发现上传适配器拆散原有批量请求，以及元数据变化重复提交完整工作区快照造成写入排队。

- 目录全量或增量写入成功后，复用已有账号 WebSocket 发失效通知；UI/SDK 立即读取权威目录，查询期间的通知合并补拉。五秒轮询保留作兼容/故障恢复，没有缩短间隔或放宽限流。
- `sessions/account-list` 一次返回本页所需的账号工作区；复用现有 Mongo 索引。新客户端遇旧服务端仍可查询原接口。目录三个只读接口复用 registered read 调度和相同参数在途合并，不增加响应缓存。
- 删除输入记录写入后的重复全账号取消，继续复用 facade 的记录/日历投影失效，日历仍可刷新。
- 同 runtime/generation 的未接管会话恢复原批量上传；20 行（含一个删除行）只发一次请求，完成数量为 19。接管会话的规范地址和执行证明保持原校验。
- 工作区未变的事件同步只提交会话增量；启动、工作区变化、周期恢复仍完整提交。同一串行队列保留版本顺序，成功前不通知，账号切换清理已确认工作区投影。
- 后端源提交 `93452cc`，测试 develop `05f0591`，[TEST_jotmo-backend #1033](https://jenkins.senguo.me/job/TEST_jotmo-backend/1033/) 成功；仅测试服部署。
- 后端领域测试、隔离配置下 14 项 DSH API 测试、backend guard 通过。首次直接运行 API 包因本地支付/Redis 初始化失败，使用既有隔离 sandbox 后通过。
- 最终插件相关 7 文件 **255 passed**，类型检查、完整构建/打包通过。测试包含输入记录与目录读取并发、通知合并、增量提交前不通知、工作区变化恢复全量及账号取消。

### v10 真实结果

A = Mac Arkme，B = Mac Browser，C = Windows Arkme。目录测量脚本仅响应 `remote.sessions.observe` 通知读取，**没有轮询计时器**。每端各创建两次，12 次跨端观测：从发起创建到其他端目录含新 ID 为 **773–1520ms，中位数 1100ms**；无目录读取/订阅错误。空白新会话仍按原生 UI 规则隐藏，不将目录含 ID 等同于可见聊天行。

另做每端各两次新建后首条发送，12 次跨端可见非空目录观测为 **492–4051ms，中位数 772ms**。其中 Windows C1 为 4050–4051ms（C 自身 4283ms）；其余五次三端观测为 474–1236ms。**固定五秒发现等待已移除，但首次发送的尾延迟尚未完全消除**；不拿中位数代替异常样本。

Mac 两个页面在菜单保持展开、未刷新/重新打开的情况下自动出现本轮 A1/B1/C1/A2/B2/C2。六会话的 18 个三端原生快照中，用户消息各一次、消息与 turn/end 内容哈希一致。**本轮六次模型请求均返回 `INSUFFICIENT_BALANCE`（HTTP 402）**，所以只证明目录、输入与错误结果同步，不能算成功模型回复回归；发现余额不足后停止新增模型请求，第二组仅创建会话。此前成功模型回归记录不替代本次最终包的成功回复验收。

最终验收包 `senguoyun-dsh-arkme-0.1.76-session-channel-v10.tgz`。Mac Arkme 主 PID 28631/Host 58281，Browser Host PID 28632/端口 50729，Windows Host PID 8568/端口 58509；这些端口仅代表本轮启动。Windows 安装后的 `lib/index.js` 与本机 v10 SHA-256 相同（`cbc35bc4c9abdd9e56c1b2b2c8314481559bb5f2efcb805e2bd4d175cc0615c4`），完整制品指纹见 `directory-lib-manifest-v10.json`。

证据位于 `../../artifacts/observation-decoupling-20260923/`：`directory-create-v10.json/.ndjson/.log`、`directory-first-message-v10.json/.ndjson/.log`、`directory-content-v10.json`、`directory-delta-tests.log`、`directory-related-v10.log` 与 v10 build/typecheck/pack 日志。中间 v6/v7/v8/v9 指标和失败记录保留，均不作为 v10 最终验收。临时分段诊断代码已移除。

补充环境记录：更新期间内置浏览器 tab 2 出现崩溃页，重新打开 tab 3 后完成列表自动更新验收；未证明该 renderer 崩溃根因，与下文 Mac renderer 未闭环限制一并保留。

## 最新结果：稳定会话频道与执行者解耦

已落地 `session.native.channel`：执行者主动向认证账号的 `sessions_v1` 频道发布原生批次，以稳定 originRuntimeRef/sessionRef 分发；Windows 的后续本机 pull 消费接收队列，不再逐批跨机 RPC。正常 A/B 交接保留会话频道与能力绑定，仅按官方协议恢复原生 follow/control generation。旧 Host 继续使用原 runtime RPC。

测试服 Realtime 已部署 [Jenkins TEST_jotmo-realtime-backend #22](https://jenkins.senguo.me/job/TEST_jotmo-realtime-backend/22/)，源提交 `4611debf4e138da714986f406455b462813fd3bb`，develop `cb9b655036a570bc28ac76a7d5d7571612a51872`；未部署生产。插件使用当前任务 worktree，未改上游 DSH 或插件版本号。

### 真实回归

A = Mac Arkme，B = Mac Browser，C = Windows Arkme。五轮均 A/B/C 各连续发送三条、间隔 100ms；上一端获准入后立即下一端，不等待模型完成。**45 条原生用户消息全部存在且各出现一次，每轮三端收到全部回复、顺序一致。** r1/r2 为频道修正版；r3/r4/r5 使用补齐浏览器交接恢复后的最终包。

| 轮次 | 状态 | C 发送确认 | A/B 消息在 C 队列可见 | C 同序号回复落后 Mac | 回复差中位数 |
| --- | --- | ---: | ---: | ---: | ---: |
| r1 | 接管 | 144–280ms | 147–896ms | 49–250ms | 65ms |
| r2 | 稳定 | 186–387ms | 86–172ms | 52–210ms | 81ms |
| r3 | 接管 | 225–452ms | 661–1066ms | 48–180ms | 60ms |
| r4 | 稳定 | 103–166ms | 63–148ms | 42–127ms | 48ms |
| r5 | Mac 重启后接管 | 143–233ms | 98–755ms | 46–53ms | 48ms |

相较上一轮接管时队列补齐 3.7–6.1 秒，本轮最终包接管轮为 661–1066ms。稳定轮为 63–148ms。模型自身排队/生成耗时与同步耗时分开计算；r1 曾因模型思考耗时出现几十秒回复等待，同序号跨端传递仍为 49–250ms。以上是 Host/API/订阅计时，未测量 Windows 桌面像素渲染时刻。

- 原执行者退出：精准关闭 A 测试实例，B 接管，B/C 继续发送、观察收齐；C 客户端订阅连接保持。浏览器页面无需刷新显示 `CHANNEL_EXIT2_B1/C1`，未再出现历史终止错误。A 随后恢复运行。
- 重复命令：C 按同一 transport requestRef 与原生 requestId 重发，返回相同确认，原生用户消息只落一次。
- 原生工具：C 发起只读 `bash pwd`，原生日志 seq 301/302 为 tool/call、tool/result，完成 `TOOL_CHANNEL_OK`；未出现 REQUEST_EXTENSION 装配错误。
- 观察端重启补齐：精准退出 C 测试实例，B 新增两轮 `OFFLINE_GAP_1/2`，重启 C 后三端 cursor=409 与正文 SHA-256 完全一致；C 恢复发送并完成 `RECONNECTED_OK`。本项验证真实连接重建与离线补齐，不等同于覆盖物理网络抖动所有场景。
- 冷启动重连首个快照耗时 3583ms；随后稳定快照 241ms。正常交接无需跨机重连，冷启动的首次发现与连接建立仍有优化空间。
- Mac 原生窗口与 Browser 均观察到最新消息；本机跨实例仍不显示“非本机”。Windows 接口读取与持续订阅通过，未新增 Windows 像素/UI 自动化。

### 补验：原实例不启动时加载与续聊

- 先完全退出 Mac Arkme，再重启独立 Browser；只有 Browser 的 Mac Host 在运行时，读取原会话并完成 `COLD_LOCAL_INSTANCE_OK`。
- 再完全退出 Browser（本验收会话的创建实例），单独冷启动 Mac Arkme；原历史事件逐条保持一致，完成 `COLD_OTHER_INSTANCE_OK`，Mac 页面实际显示回复且没有历史加载错误。恢复 Agent 时官方追加 `session/end-seed` 属正常生命周期，不能把新增元数据当作正文不一致。
- 随后恢复 Browser，保留验收实例。证据 `cold-local-instance.json`、`cold-other-instance.json` 与对应可运行脚本。
- 此能力适用于同一系统用户、同一账号/环境、兼容 Profile 且已进入共享目录的会话；仍只在旧实例私有目录中的历史需要先完成迁移。不表示正在执行的 Shell/后台进程能够原样跨进程续跑。

### 回归发现并修复

1. 选择状态发布误清理了会话频道：清理移回真正的断线/账号退出生命周期，补测注册后发布选择不退订。
2. Windows 时钟领先约 1.5 秒，过窄截止窗口丢弃合法请求：复用既有协议时间容差，补测跨机时钟偏差。
3. 原生 IPC 释放先于 epoch 提交时，被浏览器显示为终止性历史错误：follow 识别释放阶段；已接受的流正常结束并恢复，开流阶段等待交接完成。

### 回归仍未通过的独立项

1. **快速取消的原生轮次结束日志**：在模型请求尚未建立完成的窗口，C 取消和 B 直接官方 `/api/session/cancel` 均接受取消，但产生 `api-session/error: session event "turn/end" carries non-JSON-serializable data`，缺少该轮结束事件。延后取消可正常写 `aborted/user`，取消后再次发送也能完成；不能据此把快速取消算通过。
   - 与运行端相同 Electron Node **24.18.0**、未经修改的 `@deepseek-ai/dsh-util-values@0.1.5-rc.2` 独立复现：`fetch` 取消会给 `{kind:'user'}` 原对象增加 `stack` accessor；官方 `snapshotJsonValue` 随即拒绝含此对象的 turn/end。实验没有加载 Arkme、频道、Gateway 或 Agent 替换。
   - rc.2 原生 `SessionCommands.cancel` 创建该原因对象；`ReactLoopAgent.cancel` 原样传入 AbortController，`turn` 最后又原样写 signal.reason。证据已经排除新频道为必要条件。建议上游在取消原因交给运行时前保持不可变的 JSON 数据，或在写日志前规范化取消原因；插件不补造 turn/end、不修改官方持久化校验、不替换原生 cancel 的鉴权/Agent 选择逻辑。
   - 证据：`cancel-events-immediate.json`、`cancel-events-direct-native.json`、`cancel-events-owner-b.json`、`upstream-cancel-repro.mjs/.json`；对照会话 `session-84e0aa16-6deb-4943-a7a3-02719ef221c8`。
   - [Arkme 开发 Skill](/Users/apple/.codex/skills/arkme-dsh-plugin-development/SKILL.md) 明确“DSH 源码仓只允许 … 运行未修改的源码”“不得编辑、提交、推送或创建 DSH 修复分支”。当前公开 cancel 命令没有原因规范化 hook；本轮不通过覆盖私有 Agent phase 或 append 来绕过。此项作为上游兼容缺陷保留。
2. **Mac 桌面 renderer 稳定性**：最终界面复查发现白屏；桌面日志 `2026-09-23T04:09:24.000Z render-process-gone {reason:crashed,exitCode:5}`。Host/API 与 Browser 正常、三端主会话快照仍一致。旧日志在本次频道改动前（09-22）也有相同 exitCode，但不能仅据此判定同根因或排除本次影响。已保留证据并以 Chromium 诊断日志恢复测试实例；恢复后追加 r5 九条连发、原生历史和三端快照通过；当前窗口恢复正常，未在此轮重现崩溃。不将重启恢复等同于根因修复。

### 自动化门禁与证据

- Realtime 全量 `go test ./...` 通过，真实 WebSocket 用例证明原 Host 退出后同一观察 socket 接收新 Host 增量；账号隔离和发布租约 fencing 通过。
- 插件全量一轮：736 文件通过、3 文件失败、9 文件跳过；8692 项通过、12 项失败、14 项跳过。失败的三文件单独串行复跑：379 项全部通过，未修改这些业务逻辑。没有把初次全量结果写成一次全绿。
- 最终源码相关回归：8 文件 132 passed、1 skipped；类型检查、构建/最终 bundle、打包、OpenSpec strict validation、diff whitespace 检查通过。
- 会话频道单测覆盖 A/B 执行切换、退出、交接空窗请求、唯一观察连接；目录适配测试覆盖所有 native generation 关闭后仍不重复查询 execution；租约/账号/原生事件授权沿用既有门禁。
- 新频道遇到真实传输故障或序号缺口，恢复官方快照和权威历史；当前未实现客户端 `after_seq` 细粒度重放，不宣称已有该能力。producer 仍按 native 订阅产生，不宣称多个观察者合并为一份 producer。
- 真实审批/问答、附件、子代理与复杂后台任务的完整端到端门禁仍保留在任务清单，未因本次同步回归而标成通过。

证据目录：`../../artifacts/observation-decoupling-20260923/`。包含 `r1/r2/r3/r4/r5-live.json/.ndjson`、各轮 metrics、`comparison.json`、`exit-live.json`、`dedup-result.json`、`full-native-history.json`、`durable-audit.json`、`recovered-snapshots.json`、`final-snapshots.json`（最终三端 cursor=507、正文 SHA-256 `7126618d71518e863b300a12e30f6ba3e93d110ea8cadf13d96a676fad2b75c0`）及所有构建/测试/部署日志。验收会话 `session-8bbedcec-f00e-4144-b26e-a6991d8a3d4d`，标题 **ABC 会话频道回归 0923**。

本节原会话频道回归使用的包为 `senguoyun-dsh-arkme-0.1.76-session-channel-v4.tgz`；Mac/Windows 对比 `lib/index.js`、`lib/local-session/index.js`、`lib/local-session-runtime.js` 三个文件 SHA-256 一致，详见 `final-lib-manifest.json` 与 `windows-host.json`。

## 前一轮结果：复用连接，按失效重新寻址（历史记录）


已删除原生持续订阅每批 pull 前的执行者 HTTP 查询。同一会话的正文、control、交互订阅及发送共用一次寻址结果；执行权/连接失效时统一取消旧订阅并重建，close 固定发给原 Host。没有新增定时刷新或放宽全局请求限额。接管完成原生恢复后主动异步发布执行者，失败继续使用原同步 outbox，不阻塞本机发送。

最终包在 A（Mac Arkme）、B（Mac Browser）、C（Windows Arkme）完成三轮各 9 条真实发送，以及一次 A→B 返回接管。每轮均三端收齐、原生用户消息顺序一致。Mac 两个真实页面无需刷新持续更新，最后均为 29 次对话（1 次预热 + 27 条连发 + 1 次返回接管）。**稳定链路明显改善，但接管窗口和跨机尾延迟仍存在，不能宣称完整实时性目标已达成。**

| 指标 | 优化前稳定轮 | 最终包稳定轮 | 最终包接管轮 / 重复接管轮 |
| --- | ---: | ---: | ---: |
| A/B 发送确认 | 7–80ms | 18–59ms | 6–87ms / 15–193ms |
| C 发送确认 | 2031–2589ms | 155–203ms | 1882–2406ms / 2222–2316ms |
| A/B 消息到 C 队列 | 223–531ms | 372–1132ms | 5665–6075ms / 3721–4136ms |
| C 同序号回复落后 Mac | 833–4790ms | 156–1041ms | 303–4471ms / 109–2009ms |
| 回复同步差中位数 | 2949ms | 289ms | 1319ms / 239ms |

最终包两次接管均只有正常订阅结束重建，没有再观察到 SESSION_STATE_CHANGED 反复重试。接管时 C 队列补齐仍需约 3.7–6.1 秒；这包含重新寻址、连接建立及订阅恢复，当前证据不能把全部等待归因于单一环节。稳定发送确认改善约一个数量级，但入队提示、回复到达仍有波动。以上均为真实 Host/API/持续订阅计时，**没有测量 Windows 桌面渲染时刻**。

中间版本（仅复用连接，尚未主动发布）的稳定轮 C 确认为 180–231ms、同序号回复差为 47–140ms，但接管轮仍两次命中旧执行者，确认约 6.2 秒。保留这些数据用于分辨改动效果，不以最好的一轮代替最终包结果。

最终会话为 `session-57a399db-d54f-4a06-af4c-de248939855a`，标题 `ABC 简化链路最终验收 0923`。三端最终快照 cursor = 249、最近 35 条记录 SHA-256 均为 `d44afb9625403785318f56bce37a4f77f4d0354bb8eda81895e31227d34ff7ae`；快照打开 A/B/C 分别 51/52/343ms。完整 27 条的顺序以持续日志验证。

验证与资产：

- 连接相关 9 文件：92 passed、1 skipped；补充激活/发布/协调器 3 文件：10 passed（含前组已覆盖的 runtime 用例）。类型检查、构建、打包、OpenSpec strict validation 通过。
- 三端最终包 `lib/index.js` SHA-256：`3ac8a00e3e8f622568fb3df95a920fc91b99f70f849aafa89691d067fa7ea0b0`；Mac/Windows `lib/local-session/index.js`：`ea72c2b00c98ab98b7838c1084a2e81bf2e195f8262d95025a901d4ec5676d14`。
- 最终 tgz SHA-256：`6562118b5a63850b264d9997de58ed59298929e4a3bac8ab15263118301503c8`。
- 保留实例：Mac Arkme Host 54710，Browser 50729，Windows Arkme Host 64898。端口是本次启动值；后续需重新确认。
- 本轮没有修改上游 DSH、后端或版本号，没有新增部署、提交或推送。

新增证据位于 `../../artifacts/history-loading-20260923/`：`abc-route-final-{handoff,stable,repeat-handoff}-live.json/.ndjson`、对应 `-metrics.json`、`route-sequence-comparison.json`、`abc-route-final-snapshots.json`。`route-tests.log`、`route-handoff-tests.log`、`route-typecheck.log`、`route-build.log`、`route-pack.log` 保存验证结果。中间版本保存在 `abc-route-{handoff,stable}-*`。

## 优化前验收记录（保留历史证据）

以下为本轮连接复用之前的结果，不能视为当前运行状态。

修复后完成两轮 A→B→C 各连续三条、共 18 条真实发送。每端间隔 100ms；上一端三条获准入后开始下一端，不等待模型完成。三端完整持续订阅均收到每条用户消息及回复，顺序相同，无丢失或重复。Mac 两个真实页面不刷新持续更新，最后显示 19 次对话（1 次预热 + 18 次测试）。

**跨电脑实时性仍未通过：Windows 的发送确认及回复同步还存在秒级延迟，不能将消息最终一致说成实时目标完成。**

A = Mac Arkme；B = Mac Browser（50729）；C = Windows Arkme 测试实例。发送和统一时钟打点通过各实例真实 Host 原生 API/持续订阅完成；Windows 使用 SSH 本地隧道，免除逐条启动 SSH 的开销。Mac 两端另做真实页面验收。未对 Windows 桌面渲染时刻打点；下表不是三端点击到像素的端到端 UI 延迟。

## 实测数据

| 指标 | 首条触发 B→A 接管 | 执行者不变对照 |
| --- | ---: | ---: |
| A/B 发送确认 | 10–104ms | 7–80ms |
| A/B 消息到两 Mac 原生队列 | 15–495ms | 12–82ms |
| A/B 消息到 C 原生队列 | 2572–2994ms | 223–531ms |
| C 发送确认 | 1731–5165ms | 2031–2589ms |
| C 收到回复比 Mac 晚 | 371–4489ms | 833–4790ms |

回复同步差值采用同一条 assistant/message 在三端的到达时刻相减，排除模型生成时间。入队到达不等同于持久化 user/message 时间；原生模型逐条处理队列，后续正文及回复时间包含排队。

会话：`session-7a61a17a-d40e-4a50-94bc-6a98b8d3feb8`，标题 `ABC 连发实时验收 0923-2`；规范 runtime 始终为 Browser runtime。两轮结束三端快照 cursor 均为 163、最近 35 条记录 SHA-256 一致：`514628cea2fe30779515bbe787f13140b9d0f8cec3fd8f69ec10b80d2f188bd8`。快照为最近五轮，完整 18 条顺序由持续订阅日志验证。

## 本轮复现与根因修复

1. 卡“载入历史”：按创建 runtime 共享 `$events/control`，接管执行者新建的其他会话被套上旧 runtime。错误地址返回 REMOTE_NOT_FOUND，正确地址约 20ms 返回历史。改为按 runtime + sessionRef 持有来源，过滤其他会话事件，交互结果返回原 source。
2. 并发发送被拒：同一会话 acquire 原来使用 Set 直接拒绝后到请求。改为同会话共用一次交接 Promise；单个等待者取消不终止其他发送所需交接。
3. 连发阻塞与乱序：忙碌会话先等待释放，后来的空闲发送反而抢先。忙碌时立即投递当前 owner 原生队列，下一次空闲发送才接管，不中断正在执行的工具或迁移内存队列。
4. 云端执行者切换窗口：只对 queue prompt 的明确 retryable SESSION_STATE_CHANGED 有界重试；外层 transport ID 更新，原生 requestId 不变，沿用原生去重。未知结果或权限错误不重放。
5. 旧正文订阅停约 20 秒：本机 IPC 转来的 follow 因 incoming 标记绕过执行权监听。删除该绕过，复用现有 250ms owner/epoch 检查。新增 incoming 回归修复前失败、修复后通过。

## 验证与运行资产

- 相关 8 个测试文件：67 passed、1 skipped；plugin build（含类型产物）通过。
- Windows 与 Mac 的 `lib/local-session/index.js` SHA-256 相同：`d3b78f3f06a97ca068219ab2c7e07ff1ac109be1bfd97062b81e0e6509b53d1d`。
- 本轮包 SHA-256：`85df59a47de054cb99856d730643cef557c235f33c74618af4a3703f678ee1b9`。
- 验收实例保留：Browser 50729、Mac Arkme Host 49498、Windows Arkme Host 57147；端口为本轮启动值，下次须重新确认。
- 没有修改上游 DSH；没有本轮新增后端部署或生产发布。

## 剩余调查边界

不发生接管的对照轮仍有 Windows 秒级延迟，因此不能全部归因于接管。Mac Host trace 显示该轮三条 Windows prompt 到达执行者后处理为 6–15ms、回复发布确认 35–50ms，主要等待发生在此范围之外；客户端路由查询/请求准入、跨机传输和订阅回包须进一步分段测量，尚未确认唯一根因。

源码显示每次跨机 native pull 都先查询执行者，且 DSH HTTP 请求统一走 write lane（5次/秒）。这是下一步重点核查对象，目前没有足够证据将其写成已确认根因，也没有用放宽鉴权或全局提高限额掩盖延迟。

## 可复现证据

所有原始数据位于 `../../artifacts/history-loading-20260923/`：

- `identity-before.json`：错误身份与正确身份历史读取对照。
- `abc-before.*`、`abc-second-before.*`、`abc-third-before.*`：三次修复前失败证据。
- `abc-handoff-live.json` / `.ndjson`、`abc-handoff-metrics.json`：接管轮 9 条。
- `abc-stable-live.json` / `.ndjson`、`abc-stable-metrics.json`：固定执行者对照轮 9 条。
- `abc-final-snapshots.json`：三端最终快照一致性。
- `abc-live.mjs`、`abc-metrics.py`：连发与指标脚本，断言三端收齐且原生用户消息顺序一致。
- `final-tests.log`、`final-build.log`、`final-pack.log`：最终构建/测试结果。
