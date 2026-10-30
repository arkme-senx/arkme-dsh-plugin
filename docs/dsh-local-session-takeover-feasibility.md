# 本机接管：可行性验证记录

日期：2026-09-22。关联：[接管方案](dsh-local-session-takeover-plan.md)。

## 结论与决策

数据恢复和跨进程 writer 排他有可运行基础。插件合法持有 `AgentHandle` 时，可只释放一条会话，另一进程按同一 session ID 恢复，继续经过官方原生 controller 的 prompt 路径执行；源进程的其他会话继续工作。

**原生会话的在线释放与原生装配恢复已通过公开 Registry 扩展验证。** 新 Profile 在启动时使用 `LocalSessionRegistry`，捕获 `super.create/resume` 返回的精确 handle，保留原调用方 Context 和 setup。该方式不修改 DSH，不销毁外来 Context，也不停止整个客户端。已经运行、未装配该 Registry 的旧实例仍不支持在线交出 handle；cancel 仍不等于 release。

开发状态：已实现 Registry、账号/环境隔离的 SQLite ownership 和带凭据的 loopback IPC 协调器。协调器调用原生 controller.resolveAgent，Registry 在原始 setup commit 中提交 owner epoch，然后发布 Agent。测试 Profile 已接入原生发送、正文订阅、控制投影、稳定云端地址适配和旧目录迁移；Mac Arkme 与浏览器的双向文本接管已实测。云端新接口尚未部署，复杂工具/审批及全部旁路命令仍受下文验收门槛约束。

## 早期生命周期实验的验证对象与隔离

- 未修改的官方 `@deepseek-ai/dsh-*` 0.1.5-rc.2 发布包；Cordis 4.0.2。源码按 `dsh-v0.1.5-rc.2` 核对，不使用当前 master 代替运行版本。
- macOS、Windows 都使用该验收客户端自带 Electron 的 Node 模式运行独立子进程，Node 24.18.0；另有系统 Node 补充运行。
- 每轮独立的 session 存储目录，目录包含空格；不读取用户对话、不接入账号云端，不重载或停止验收实例。
- 实际执行官方 Agent loop、JSONL/Zstandard 持久化、跨进程锁、Agent registry、Session Controller 和 session query。只调用包公共入口，没有复制或改写 DSH 内部实现。
- 模型是本地脚本 adapter；文本 prompt 的附件/上传/default-model/workspace 依赖采用最小测试替身。没有请求真实模型、执行真实 Shell 工具或操作审批 UI，不能据此宣称完整原生功能兼容。

## 已执行检查

| 检查 | macOS | Windows | 能证明什么 |
| --- | --- | --- | --- |
| B 持有 writer，A 尝试 resume | 按预期拒绝 | 按预期拒绝 | 两进程不能同时打开同一日志写入 |
| B cancel 后 A 再 resume | 按预期拒绝 | 按预期拒绝 | cancel 不等于交出执行权 |
| B 用自己的 handle dispose，A resume 后通过原生 controller prompt | 通过 | 通过 | 受控在线交接及原生文本发送路径可行 |
| A 下一轮 model request 包含 B 的输入和回复；日志前缀逐事件相等 | 通过 | 通过 | 恢复真实上下文，保留原 session ID、工作目录和原始事件 |
| B 的第二条会话继续执行 | 通过 | 通过 | 单会话释放无需停止整个 B |
| A 再释放、B 再恢复 | 通过 | 通过 | 可反向交接，不限于一次搬运 |
| B 持锁时被终止，已尝试过竞争的 A 存活并恢复执行 | 通过 | 通过 | 此平台/版本/场景下锁可恢复；不是对一切 Windows 故障的保证 |
| 原生 controller 没有 release 方法，但 Profile Registry 子类捕获精确 handle | 通过 | 通过 | 原生会话可在线释放，不需要私有 API |
| 原生会话释放后，旧实例隐式 resolve 被拒绝，A 可继续 | 通过 | 通过 | 旧页面不能直接绕过 Registry fence 抢回会话 |
| 原生 controller fiber 卸载只处理其拥有的 Agent | 通过 | 通过 | Registry 没有改变原生 caller scope 生命周期 |
| 真实 jobs-local 有未结束任务时拒绝释放，不取消任务 | 通过 | 通过 | 忙碌拒绝不会暗中终止任务；producer 为脚本 Promise |
| 已结束子代理随父会话移交后，sendMessage 冷恢复原 child 历史 | 通过 | 通过 | 使用官方 subagent/spawn-in-process，不重造子代理内核 |
| 通过认证 IPC 请求源实例释放，原生 controller 恢复后 epoch 变为 2 | 通过 | 通过 | 不需人工先 dispose；原始 setup 得到保留 |
| 忙碌拒绝后正常反向接管，epoch 变为 3 | 通过 | 通过 | 失败准备可回退，conversationRef 不变 |
| 持有者实验子进程异常退出，存活方恢复为 epoch 4 | 通过 | 通过 | 最终以 DSH writer 为准，不靠心跳强抢 |

实验中每轮完成后显式调用公开 `ctx.sessions.flush(agent.session)`，再验证其他进程可读的 durable 状态。`idle` 不能当作已落盘证明。A 直接调用 `ctx.agents.resume()`，由官方 persistence 获取 writer 锁；没有先持一把相同的锁再调用 resume。

## 源码证据

以下位置均指 `dsh-v0.1.5-rc.2`：

- `packages/core/agent/src/index.ts`：`AgentHandle` 的 dispose 是创建者持有的能力；`get()` 只返回裸 Agent；`create/resume` 返回 handle。
- `packages/api/session-controller/src/agent.ts`：`resumeObserved` 和 `createOrAdopt` 只保留 `(await ctx.agents.resume/create(...)).agent`；已有 live Agent 可被 controller 使用。
- `packages/api/session-controller/src/index.ts`：公共服务有 create/prompt/cancel/resolveAgent 等方法，没有单会话 release/handoff。
- `packages/core/agent-loop/src/index.ts`：resume 先通过 persistence write-open 拿写权限，再读取/修复日志；不能由插件另开 writer 抢同一锁。
- `packages/session/session-persistence-jsonl/src/lease.ts`：POSIX flock、Windows named semaphore 的排他 owner。

## 尚未完成的 P0 退出条件

1. **生命周期入口收口**：普通 create、fork、冷会话 prompt、rename、模型设置、文件引用和 Typert Agent lookup 都不能绕过 owner；B 移交后不能被旧页面隐式 resume 抢回。已证明 controller 能给插件持有的 Agent 发送文本，但尚未证明全部原生入口和预设行为可以保持一致。
2. **真实能力装配**：模型选择、权限、预设、MCP、Shell、附件、压缩历史、子代理和后台任务；尤其要证明 dispose 完成时没有仍能写文件的受管任务。已覆盖后台任务拒绝、已结束子代理冷恢复；仍未验证真实 Shell 副作用、图像、MCP、压缩历史或审批 UI。
3. **身份与恢复协议**：稳定 conversation identity、ownerEpoch、所有权提交与 input requestId 的关联恢复，断网和并发交接。本机 stable conversationRef、epoch CAS、IPC 与真实 writer 绑定已实现；云端固定地址和执行者 proof 已接线，断网补投影、输入回执恢复与实库并发仍需验收，不由 writer 锁自动提供。
4. **迁移与版本门禁**：已有实例独立目录迁入共享根后，旧版本不能继续写原副本；不允许自动降级到过时的备份。

原生 controller 的公开类本身仍没有 release，但这不再阻止启动时装配的新 Profile：Registry 捕获精确 handle 的路径已得到验证。无需为这一部分请求上游修改。Gateway 在途命令计数已接入 Registry 释放判定；仍需覆盖所有绕过 Gateway 的产品入口。旧 Profile 迁移和真实用户会话不会自动启用这份实现。

## 当前代码与交付门槛

| 部分 | 状态 |
| --- | --- |
| `src/local-session-registry.ts` | 生命周期捕获、版本门禁、空闲 flush/dispose、旧入口 fence、setup commit 协调 |
| `src/local-session-ownership.ts` | 账号/环境绑定、进程间 SQLite CAS、稳定 conversationRef、epoch、私有 peer 发现 |
| `src/local-session-coordinator.ts` | 认证 loopback IPC、忙碌拒绝、原生恢复、异常退出后 writer 验证；仅实验 Profile 启用 |
| `src/local-session-runtime.ts` / `local-session-gateway.ts` | 原生普通发送自动 acquire；其他实例的命令/流转发；在途命令阻止释放；审批和全部入口尚未端到端验收 |
| `src/local-session-control.ts` | 每 Host 一组 peer 原生控制订阅；按 owner/epoch 过滤并转发 projection、queue、jobs、status 与 activity；取消、容量与错误恢复有界 |
| UI / Tools / SDK | 账号目录已识别执行者，命令/历史/观察共用执行者解析；Browser 优先本机 carrier；直接未发现地址、跨 owner 订阅等仍需审查 |
| Client / Profile | `ARKME_LOCAL_SESSION_TAKEOVER=1` 仅在测试环境 rc.2 开启；Mac Arkme 与浏览器双向文本接管、原会话保留、正文及 control 摘要同步、观察端停止和刷新恢复已实测 |
| Backend | 已实现 claim/read 与 execution proof，保留原 runtime/session 云端地址；旧 owner 写入及过期上传 intent 有单测；已部署测试服并完成多端真实模型联调；Mongo 实库并发压测尚未完成 |

当前边界：最多 16 个本机连接与 16 个并发 acquire；单次 acquire 30 秒，release 请求 5 秒、native 请求 25 秒；Registry 最多保留 1024 条 fence，peer 发现表最多 256 条，满时拒绝而不驱逐可能仍活着的 writer。正常关闭删除对应 peer。普通发送遇到忙碌 owner 时立即转发至其原生队列，不等待模型结束、不取消旧实例工作；空闲接管本身仍有界，没有独立持久排队服务。以上不能当作产品验收完成。

### 2026-09-22 产品装配检查

- 装配改为随插件构建发布的单一 `local-session/index.js` Host entry，拥有自身包名/版本且不声明 Browser bundle；不再在 Profile 目录生成散落的 re-export。独立 Browser carrier 保留官方 Gateway 0.1.5-rc.2 的原始客户端字节和 `dsh.client` 声明，其 Host entry 为空实现，防止重复注册官方 Host。
- `REQUEST_EXTENSION` 根因是先前 Profile 私有入口被上游 package inventory 归属到有 name、无 version 的 Profile 包。新产物已通过实际 rc.2 inventory prepare 校验，官方真实模型请求成功；没有修改上游源码或安装的运行包。
- macOS Arkme 与独立浏览器 Harness 使用同一测试账号/环境的共享目录；原来的常驻 macOS、Windows 实例未重载。原生 create/selectModel/prompt 后，浏览器 → Mac → 浏览器在同一 session 完成三轮真实模型回答，分别为 `PROFILE_OK`、复述 `PROFILE_OK`、`ROUNDTRIP_OK`，owner epoch 依次为 1、2、3。会话 ID 记录在任务 artifacts/takeover-ui/profile-verification-session.txt。
- 修复 IPC 正常 HTTP pull 完成被误判为订阅取消，造成重复 opening cursor 的问题。正常 response finish 保留 iterator，异常断开仍取消；真实 HTTP 双 pull 回归验证只打开一个 iterator。
- 执行权变化后结束已接受的 follow，由上游 `RemoteJournalStream` 原生重连并重新读取快照；本地和 peer follow 都监听 owner/epoch，不在同一流中拼接两份 snapshot。14 项定向回归覆盖订阅、IPC、原生传输和交接移除事件过滤。最终构建真实 UI 已验证浏览器回复 `HANDOFF_WEB_OK`、Mac 接回回复 `HANDOFF_MAC_OK`，两边均保留原会话并自动显示对方回复，不需要刷新。证据见 artifacts/takeover-ui/final-native-acceptance.json。
- `session/disposed` 原生会触发 `api-session/removed`，从而清空旧页面选择。Gateway 通过公开 `registerRemoteEvents` 过滤 Registry 仍保留交接 fence 的会话移除事件；真正删除和其他事件继续转发，不改写上游事件分发器。
- 打包前必须停止开发产物验收或显式使用 `ARKME_SKIP_PREPARE_BUILD=true`（前提是已经完整构建）。`pnpm pack` 默认 prepare 会清理并重建 lib，覆盖运行实例所加载的文件，触发热更新白屏；全量测试中的 `tests/package-contents.test.ts` 也会三次执行 bundle。因此构建、全量测试和依赖 lib 的开发实例验收必须串行，受影响的运行验收作废并重启。
- **控制面已补齐：** Host 通过公开 `SessionController.control()` 及 `api-session/status/activity/added` 取得当前执行者的权威状态，经现有鉴权 loopback pull/close 通道转发。每个执行实例只建立一条观察订阅，各窗口共用；owner/epoch 改变后重新拉取 baseline。原生控制 baseline 保持第一帧，随后重放 peer 投影；刷新时的原生 session/list 按相同 owner/epoch 合入已订阅的 running 状态，避免冷列表将执行中覆盖为空闲，不从正文推测状态。双向真实发送后，两端次数、轮次和 token 用量一致；观察端显示进行中和停止按钮，停止后官方 journal 记录 `aborted/user`；刷新观察端仍恢复相同摘要。
- 控制面边界：250 ms 检查 owner 变化，最多观察 8 个有会话的实例、64 个窗口订阅；单消费者积压最多 256 帧或 8 MiB，缓存最多 1024 会话、每会话 256 个投影键、合计 32 MiB。网络失败有界退避；过期 epoch 丢弃；源流异常结束和容量超限显式断开，不静默保留失效状态。关闭 Host 取消订阅并释放 listener/lease。以上为结构性边界与功能验收，不是性能提升测量。
- Arkme 托管模型曾返回 `INSUFFICIENT_BALANCE` / 402，与已验证成功的官方模型分开记录。后端测试服随后已部署；本机文本续聊、云端目录和 Windows 远端控制已有多轮证据，真实审批、附件与 Windows 本机模型执行仍有独立验收边界。
- 迁移移动完整原生日志目录、先放置附件并保留已有云端 alias；当前不是自动降级/备份恢复实现。旧目录不会再保留一份可写日志副本，异常冲突保留源数据并拒绝覆盖。

## 本轮状态同步回归

- 相关回归 5 文件 16 项通过，覆盖真实双 coordinator HTTP、共享订阅、原生投影与状态、刷新列表、过期 epoch、慢消费者上限、异常源结束和退出清理。
- `pnpm run typecheck`、完整 build 与官方 package inventory 校验通过。全量 `NODE_OPTIONS=--no-experimental-webstorage pnpm test --maxWorkers=1`：738 文件通过、9 文件跳过，8679 项通过、14 项跳过，未提高测试超时或删减断言。较高并发的前序运行曾出现既有 home-tour 时序断言与脚本超时，保留失败日志；最终串行运行通过。
- 官方 `dsh plugin --profile web add <artifact.tgz>` 已在新的独立 DSH_HOME 安装，实际页面加载了 Arkme 0.1.76 与原生输入页，没有 loader entry 错误。该证明与两实例使用开发路径的真实模型验收分开记录。

## 重跑与证据

可重跑脚本为 `scripts/verify-local-session-takeover.mjs`。本任务 `artifacts/takeover-probe/` 保存 `coordinator-mac-final/result.json`、`coordinator-windows-final-result.json` 及日志。两平台各 16 项检查通过。模型为本地 adapter，账号鉴权回调为隔离测试替身，没有对用户账号云端写入。

插件验证：类型检查、构建通过；全量 8670 passed / 14 skipped。系统 Node 25 的实验性 Web Storage 会破坏既有浏览器测试，完整回归使用 `NODE_OPTIONS=--no-experimental-webstorage`；双进程实验使用客户端自带 Node 24.18.0。

本轮增量证据：`runtime-mac-final3/result.json` 的 16 项通过，包含普通发送自动来回接管、源进程退出后先打开历史/订阅再继续发送。仍是脚本模型。全量回归为 8671 passed / 1 failed / 14 skipped，唯一失败是可选 Gateway 的旧版本兼容断言；修正该断言后，7 文件 29 项定向回归通过。客户端 Profile/账号作用域 60 项、后端 dshremote 模块及 DSH HTTP handler 通过。类型检查、构建和 OpenSpec strict 校验通过；Mongo 实库并发与真实 UI 不在上述结论中。

先将 Registry 与 Coordinator 打包到隔离实验目录，再运行：

```text
ARKME_TAKEOVER_REGISTRY_MODULE=<built local-session-registry.mjs>
ARKME_TAKEOVER_COORDINATOR_MODULE=<built local-session-coordinator.mjs>
<matching Node executable> scripts/verify-local-session-takeover.mjs <client-root> <fresh-output-root>
```

使用 Electron 时，仅为实验进程设置 `ELECTRON_RUN_AS_NODE=1`。每次使用新的输出目录；脚本内的进程终止只针对它创建的子进程。未提供上述模块变量时仍执行原始 9 项官方 Registry 对照实验。两个窗口连接同一个 Harness 不算跨实例；上述早期脚本证据与新增 Mac Arkme + 浏览器真实 UI 证据分开记录。

2026-09-22 后续真实证据已超过上述脚本模型：测试后端 #1028 已部署，Mac Arkme 与 Browser 使用不同 Harness 进程，Windows 从另一台电脑控制；最后新增 9 轮真实模型接续均完成，逐轮三端原生历史 SHA256 一致，三个官方 journal 持续五分钟自动恢复订阅并收到全部轮次。同机共享会话显示去重已在 Mac UI 验证。最终 119 项定向通过；单次 Mac renderer crash 的根因、Windows 原生窗口视觉验收与复杂交互仍作为未关闭项，不据此宣称全产品验收完成。
