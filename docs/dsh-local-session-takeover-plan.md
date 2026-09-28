# 本机跨实例无感接管方案

日期：2026-09-22。状态：本机协调及测试 Profile 产品入口已实现；双平台 16 项隔离实验通过，Mac Arkme 与浏览器文本接管闭环已验收，完整发布门槛仍见下文。非本机 UI 已独立交付；同机隐藏提示不代表已支持接管。

**状态：本机接管与稳定会话频道已在测试服完成多轮三端回归。** 正常 A/B 交接时 Windows 保留账号会话连接；最终包接管轮的队列可见耗时 661–1066ms、稳定轮 63–148ms，未测量 Windows 像素渲染时刻。退出恢复、重启补齐、重复命令及原生只读工具通过；冷启动首个快照仍约 3.6 秒。全部审批/问答、附件、子代理/后台任务与生产发布门禁仍未完成，详见 [实时性验收](dsh-local-session-takeover-validation-20260923.md)。

## 2026-09-23 同步边界修订（已实现并完成本轮三端回归）

同步以稳定会话为入口，不以当前执行实例为入口。用户已确认：Windows 观察同一个对话，Mac A/B 的执行权变化不得要求 Windows 重新寻址、建立新的观察连接或重载完整历史。

正常路径：执行者产生原生增量 → Realtime 按认证账号和稳定会话地址扇出 → 各端交给原生数据投影消费。发送携带稳定会话地址与 requestId，当前执行者完成入队并发布确认；本地发送中状态不能代替已入队、已持久化事实。

- 复用既有规范地址 `(environment, account, originRuntimeRef, sessionRef)`；originRuntimeRef 是固定身份命名空间，不是当前 executor。不得因执行者切换搬迁历史或新增对话。
- 复用 Realtime Kernel 的连接、顺序、幂等和有限重放；在 DSH 模块提供与执行者独立的会话订阅，不另造同步引擎。服务端按认证账号隔离订阅和发布，客户端比对会话 ID 仅负责分发，不能代替服务端权限校验。
- 持久化消息按原生 journal seq/id 去重、补缺；流式临时帧沿用原生 turn/stream revision，不能把所有增量都当成可直接追加的完整消息。接收端沿用原生 reducer，不另建一份正文真相。
- 本机 writer 锁、交接和在途命令保护仍由执行层持有。只允许当前执行者接受命令与产生有效的新结果；旧执行者的迟到帧不能覆盖新状态。观察端不参与 writer 协调。
- 普通接管不重建观察订阅。只在实际传输断线、游标缺口或会话权限变化时恢复；有限重放不足时按权威历史补缺，不为每批数据重新查询 execution 或执行握手。
- 不采用“固定观察 Host → IPC 转发当前执行者”作为最终架构：它仍引入一个必须存活的中间 Host。本轮未部署的 relay 草稿已撤回，已验证的连接复用与本机接管实现保留。

当前通过 `session.native.channel` 协商新路径：每账号一条 `sessions_v1` WebSocket 逻辑频道，多路复用稳定 originRuntimeRef/sessionRef。执行者主动推送各原生订阅的增量批次，观察端的本机 pull 只消费接收队列，不再逐批跨机请求；旧 Host 保留 runtime RPC 路径。

官方 DSH 的 follow generation 仍有自己的初始快照/assistant revision 合同。交接时旧 native generation 结束，原生消费者恢复新 generation；这不关闭账号会话频道、不重新定位执行者，也不拼接两个 opened 帧。会话能力绑定在所有 native generation 关闭后最多保留 45 秒，避免同时切换正文/control/交互时重新查询 execution；真正连接失效或确认执行者离线才重查。

Host 先订阅账号频道，再注册租约并声明就绪。同机 peer 保留有效观察登记，取得执行权后续推；新启动的 Host 就绪时观察端补发登记。原执行者退出不要求 Windows 寻址重连。非当前 writer 不保留普通调用，避免结果未知的写入在后续接管时被重放。

服务端测试服 Realtime build 22 已部署（源提交 4611deb，develop cb9b655）。最终相关回归 132 passed、1 skipped；四轮 ABC 共 36 条连发、执行者退出、重复命令、原生只读工具与 Windows 重启补齐已验证。全量测试的初次失败和独立复跑证据见验收文档；复杂产品入口及生产发布门禁仍单列。

验收：A/B 往返接管时 C 的逻辑订阅不变、无新增执行者查询/跨机握手；ABC 连续各发三条后同序号正文一致且不重复；断线补齐、原执行者退出、重复发送和旧帧迟到均保持正确。性能以同序号到达时间测量，不能用“WebSocket 已连接”代替实时性证据。

## 产品行为

- 同一电脑、同一操作系统用户、同一账号、同一环境中的实例共享会话入口。浏览、打开或切换会话不改变执行归属；用户不需要理解实例或点击常驻“接管”按钮。
- 在 A 发送下一条消息时，若 B 已空闲，自动交接到 A；之后关闭 B，A 仍可继续。列表保留同一条会话、历史、标题、工作区、草稿与选中状态。
- B 正在执行时，当前轮继续由 B 完成。A 发来的正常下一轮输入立即进入 B 的原生队列；这次不迁移执行者，后续空闲发送再交接；steer、取消、审批和问答仍发给当前执行者，不切走未结束的工具进程。已有 B 队列必须先明确排空/迁移，不能静默丢弃。
- B 已退出时，A 恢复最后完整持久化历史；中断轮明确标记中断，不把缺失工具结果伪装成功，不自动重放结果不明的写操作。
- 正常成功过程仅表现为短暂发送中。交接失败时保留输入，并给出可重试原因；工作目录、模型或工具不可用时禁止静默降级。
- 跨电脑维持现有源电脑执行方式，标题显示“非本机 · 电脑名称”。本方案不迁移跨电脑文件或工具环境。

## 已核对的代码事实

| 位置 | 当前事实 | 对方案的影响 |
| --- | --- | --- |
| 插件 `src/client/harness-account-sessions.tsx` / `accountSessionKey` | 非本地 UI identity 为 `runtimeRef + sessionRef` | 执行者变化会改变列表 identity，必须增加稳定逻辑会话身份与旧地址映射 |
| 插件 `src/dsh-remote/account-sessions.ts` | 已有 `sameDesktop`、`local`、电脑名称，控制通道仍按 runtime 定位 | UI 可独立交付；同机直连或接管均不能靠改一个 local 标记完成 |
| 客户端 `src/dsh-account-scope.ts` | 每个 userData 下的 `dsh-containers/scope_…` 独立持久化 | 仅同步显示历史不能让另一实例恢复完整 Agent，必须统一持久化或受控导入 |
| 后端 `internal/dshremote/mongo_store.go` | 会话、轮次、上传幂等索引均含 runtime_ref | 不能把记录搬到 A 后再次当新会话上传；需要稳定 conversation identity 与 owner projection |
| 官方 DSH `dsh-v0.1.5-rc.2`，`packages/core/agent-loop/README.md` | 公开 `ctx.agents.resume()`，返回拥有精确 teardown 能力的 `AgentHandle` | 能复用官方恢复/停止排空机制，无需复制 Agent loop |
| 官方 DSH `packages/core/agent/src/index.ts`，`AgentHandle` | 只有创建者持有 dispose；`ctx.agents.get(id)` 只返回 Agent | Arkme 不能获取任意原生 Agent 后直接假定有安全释放权限 |
| 官方 DSH `packages/api/session-controller/src/agent.ts`，`resumeObserved` | 原生 controller 取返回值 `.agent`，未向插件提供按会话移交 handle 的接口 | 原生会话空闲时也可能仍持有 writer，`session/cancel` 不等于释放执行权 |
| 实际安装 `@deepseek-ai/dsh-session-persistence-jsonl@0.1.5-rc.2` 的 README / lib | 有 POSIX flock 与 Windows named semaphore 路径；通用 persistence 文档仍有“仅进程内”的旧描述 | 以实际 backend 实现为准，必须实测 Windows 进程异常退出和竞争者存活后的锁恢复，不能只信文档的崩溃自动恢复表述 |

官方 DSH 只读，当前没有修改其源码。`LocalSessionRegistry` 使用公开子类与 Profile 替换机制保留原调用方 Context、原 setup 和精确 handle；双平台已验证原生会话在线释放。Mac Arkme + 浏览器已完成多轮真实模型往返接管、状态同步和跨实例停止，完整工具/审批与 Windows 新装配 UI 验收尚未完成。

## 推荐架构：共享会话日志，执行者按需转移

比较三条路径：

| 路径 | 能否满足 B 退出后 A 继续 | 结论 |
| --- | --- | --- |
| 同机转发给 B | B 退出后不能继续 | 只能改善延迟，不能交付接管 |
| 复制历史到 A，再回写 B | 两份日志和副作用容易分叉，失败恢复复杂 | 不采用作为常规方案 |
| 同机共享规范日志 + 每会话独占执行权 | A 拿到执行权后独立运行 | 推荐，需先证明生命周期扩展点 |

1. 客户端提供按 OS 用户、测试/生产环境、账号隔离的共享 **session 存储根目录**与实例发现入口。只共享会话/必要附件，不共享整个 DSH_HOME、登录凭据、所有 Profile 设置或工作区。
共享的是会话数据，不是实例的运行环境：

| 数据或资源 | 恢复方式 |
| --- | --- |
| 规范会话日志、恢复所需元数据与附件 | 通过 DSH persistence/query 公共接口读取；不自行解析 JSONL 重造 model history |
| 工作目录 | 使用已验证的原路径；不复制项目，不把会话目录当工作目录 |
| Agent、模型连接、工具与预设 | A 通过公开 resume/setup 重新装配；不得静默改变原模型或权限 |
| 登录凭据、实例设置 | 保留在各实例；不复制整个 DSH_HOME 或凭据 |
| 草稿、流式临时帧、后台任务、子代理 | 不假定存在于可恢复日志；分别确认 owner 与恢复合同，未验证前不得承诺完整迁移 |

共享根目录只表示“可读到这条会话”，不表示“当前实例拥有执行权”。原生列表与账号目录必须按稳定身份去重，发送和所有会触发恢复的入口仍需检查当前 owner；不能把共享日志中的每条会话直接标成可本地执行。

2. 插件 Host 持有会话协调逻辑，通过公开 DSH 服务创建、恢复和释放 Agent。会话身份固定为 `conversationRef`；记录 `nativeSessionId`、原始地址 aliases、当前 `ownerRuntimeRef` 与递增 `ownerEpoch`。UI、云端目录与历史不因 owner 改变而新增会话。
3. 所有执行者必须使用同一个规范日志路径；writer 锁由 DSH persistence 在 create 的首次落盘或 resume 的 write-open 中取得、由对应 handle 关闭时释放。插件不提前打开第二个 write handle 或另行抢同一个锁，避免与 resume 自己冲突；同机注册信息通过 OS 用户权限保护的 IPC/文件访问，校验账号、环境、兼容版本和实例身份。服务端 `sameDesktop` 仅供展示，不能充当访问本机其他目录的授权。
4. metadata 的 owner 变更串行化并持久化；请求带 `conversationRef + ownerEpoch + requestId`，旧 owner 拒绝新请求。writer 锁保护日志写入；释放之前必须停止并排空旧 Agent 及其受管工具。超时/心跳失联不能覆盖活着的持锁者。
5. 同机观察端通过现有鉴权 IPC 订阅执行者的原生 control 与状态事件，按 owner/epoch 校验、共享 Host 订阅并有界缓存；切换执行者后重拉 baseline，正文仍由原生 follow 恢复。观察不取得 writer，也不以正文推断状态；刷新列表同样合入当前 owner 的 running 状态。
6. 云端保存稳定会话与当前 owner 的投影，并用 epoch 拒绝迟到的旧 owner 更新。断网可在同机完成有权限的交接，恢复联网后按序上传；本地 journal 未同步前不能让远端请求绕过新 owner。

## 自动交接顺序

```text
A 收到发送意图（固定 requestId；输入与附件保持在 A）
  → 验证账号/环境/会话格式/工作目录/模型与工具能力
  → 向 B 请求 prepare-handoff(expectedEpoch)
  → B 关闭新写入入口，结束当前轮和既有队列，flush
  → B dispose 对应 Agent，等待工具退出、日志排空与锁释放
  → A 调用 agents.resume，由 DSH 原子取得 writer 锁并恢复，完成就绪检查
  → 提交新的 ownerEpoch，发布目录 owner 变化
  → 幂等提交该条输入，A、B 订阅新执行者的结果（B 不再次执行或回写一份日志）
```

- 交接入口必须覆盖 create、fork，以及 prompt、rename、模型设置、文件引用和 Typert Agent 查找等可能隐式 resume 的路径。B 释放后，这些旧入口必须重新解析 owner，不能自动复活旧 Agent 抢回锁。仅拦截“发送”按钮不成立。
- writer 锁与 owner 元数据不是同一个事务。原型已用 SQLite CAS 保存 prepare/released/active、stable conversationRef 和 epoch；本机 IPC 请求原 owner 释放，再在原生 setup commit 中提交执行权。失败时保留可恢复状态。尚未将全部原生命令的在途写入计数、UI 输入和云端投影纳入同一协议。
- 不迁移 B 的内存队列。忙碌时普通输入直接转发给 B 的原生队列，并保留停止/审批入口；空闲发送才交接。同一目标实例内的并发 acquire 合并为一次原子交接，各发送请求保留原生 requestId；取消单个等待者不取消其他请求所需的交接。
- prompt 去重优先复用官方 `requestId` / durable `rpcId` 合同；另补跨 owner 的状态查询与结果不明处理，不能仅靠内存去重或一份与日志没有恢复关联的“已受理”标记。
- prepare 阶段失败：B 保留执行权，A 的未提交输入保持可重试。
- B 已释放、A 尚未恢复就崩溃：日志为无主且可恢复状态；后继竞争者拿到锁后恢复，不回退覆盖历史。
- A 恢复成功但确认丢失：按 requestId 查询持久化受理记录；不得创建新 requestId 自动再发一遍。受理、日志事件和回执必须具备可恢复关联，不能只用内存去重。
- 两边同时发送：只允许一个 writer 获权；另一个请求重新解析 owner，按原 requestId 路由/排队。不会因打开窗口或 focus 触发互相抢占。
- B 退出/崩溃：验证真实进程身份和锁可用性；PID 或网络离线状态本身不够。恢复沿用 DSH 对未完成 turn/tool 的修复语义，未知副作用需核查后才能重试。
- 手动“停止并接管”作为异常/忙碌场景下的显式操作，不在正常标题栏暴露实例概念。普通发送不暗中杀掉 B 的进行中任务。

## 必须先完成的 P0：生命周期验证

最小实验已用未修改的官方 DSH 0.1.5-rc.2 发布包和隔离子进程完成，macOS / Windows 都验证了持锁拒绝、handle 交接、历史延续、原控制器 prompt、另一会话不受影响、来回交接、退出后恢复。早期实验使用本地脚本 adapter；新增 Mac Arkme + 浏览器已验证真实模型文本续聊与历史保留，复杂工具和完整桌面 UI 门禁仍未完成。以下是 P0 完整退出条件，仍需逐项完成：

1. 插件通过公开 API 拥有 AgentHandle，验证原生页面可正常展示、发送、调用工具、取消、选择模型、审批以及恢复该会话。
2. 同一规范 session root 下的 session ID、历史前缀、工作目录与下一轮 model context 已通过；继续验证上下文压缩、附件、预设、审批、子代理及后台任务的语义，以及原生查询投影和事件订阅重新连接。
3. 同时写入只有一方成功；A/B 连续互换；B 正常退出和强杀后恢复；macOS 与 Windows 分别验证。不能使用用户正在运行的实例做破坏性实验。

已解决的限制：通过启动时安装公开 `AgentRegistry` 子类，可捕获原生 controller 返回前的 handle，不需要修改上游。只支持验证过的 DSH Agent 0.1.5-rc.2；旧版 setup 签名不同，必须拒绝启用。仍不得事后接管任意外来 Context。当前 Registry 会拒绝忙碌、未汇报后台任务、活跃子代理与持久终端；这些状态不能静默丢弃。最终启用前还须给全部异步命令增加准入与排空边界，避免释放前已经拿到 Agent 的命令在释放后继续写入。

## 兼容与迁移

- 新能力由 capability/version 协商开启。旧客户端继续原路由；不能将旧版参与者纳入共享写入协议，也不能从“目录已显示”推断它可交接。
- 活着的旧会话首次迁移必须先取得源 owner 的冻结/释放确认；源实例已退出时，核对来源并通过官方 writer 排他证明没有写入者。校验完整规范日志、格式版本、校验和及附件可用性。迁移采用暂存、验证、原子发布和持久化 alias；不删除源数据，不同时激活两份可写副本。
- 迁移 alias 只约束理解新协议的版本。原目录保留备份后，必须阻止旧版本继续写这份源副本；不能把“保留原目录”当作可安全降级。降级不得自动切回过时副本，迁移/版本门禁需在产品接管启用前完成。
- 同名电脑、同名工作区、相同旧 session ID 按真实 account/environment/runtime provenance 分离，不能按标题或路径字符串合并。
- 元数据、附件、压缩后的 model history、请求设置与业务授权分开处理；A 重新装配当前允许的模型和工具，历史中的旧工具声明不是权限。
- 运行环境版本不兼容、工作目录消失、挂载变化、模型无授权、附件缺失必须在发送前给出确定失败；原草稿和日志仍可恢复。

## Owner、实施顺序与验收

| 阶段 | owner / 交付 |
| --- | --- |
| 当前 UI | 插件 Browser，复用已存在目录；UI 必需，Tools/SDK N/A（没有新增查询/命令/持久化能力） |
| P0 能力验证 | 插件 Host + 客户端隔离运行装配；证明确切生命周期 API 和两平台 writer 排他，必要时提出上游最小 seam |
| P1 稳定会话身份 | 后端目录/历史 owner + 插件映射；旧 runtime/session 地址兼容、ownerEpoch 与去重 |
| P2 本机共享与交接 | 客户端负责共享根目录选择、退出确认和 Profile 装配；插件负责私有 IPC、OS 权限、handoff 状态机与 Agent lifecycle；不复制 DSH 执行内核 |
| P3 产品接入 | 普通发送按需无感接管，忙碌/失败显示反馈；Host 能力同时提供受控 UI、SDK、Tools 入口 |

接管改变跨仓主流程、会话身份和失败恢复，进入实现时同步 OpenSpec 契约；本次 UI 不引入该契约变化。

验收最低集合：A/B 正常互接；B 退出后 A 接续；两实例同时发送不双跑；交接各阶段进程退出不丢记录；未知写操作不重复；账号/环境严格隔离；模型/工具/工作目录兼容；排队/steer/审批正确归属；断网交接后远端目录只出现一条；旧客户端不误写；卸载清理无重复后台进程。两平台都要真实运行，不用单测替代。

## 2026-09-22 追加真实运行验收

测试服后端已部署 #1028。Mac Arkme、独立 Browser 与 Windows 控制端新增 9 轮真实模型接续，保留前端留下的验证词，逐轮三端原生历史 SHA256 一致；三个官方 journal 消费器持续五分钟自动收齐全部轮次。Mac 页面确认共享会话只出现一条，列表沿用原生 sessionId，云端地址不变。

最终定向 119 passed / 1 skipped，类型检查与构建通过；较早隔离全量 8689 passed / 14 skipped，不包含最后两个小修，不混作最终全量证明。Windows 原生窗口视觉验收、一次 Mac renderer crash 的根因、复杂审批/附件/子代理和 Mongo 并发仍未关闭。原始证据在任务 artifacts/multi-round/extended-*，详细验收与边界在同任务 meta 的 validation-20260922.md。


## 会话频道能力与资源边界

| 消费面 | 本轮覆盖 |
| --- | --- |
| UI | 复用原生正文、队列、控制及交互处理器；跨机传输换为主动推送 |
| Tools | 原有公开会话操作及原生权限不变；内部频道没有新增可供模型调用的业务命令 |
| SDK | 原有公开 native 会话入口不变，通过 Host capability 选择新载体；不导出凭据或执行者私有 IPC |
| Host | 同一个执行权检查、原生 Gateway、命令账本和请求 ID；新频道不另造业务状态 |
| Client | 继续消费插件包及既有 native-streams 入口，无新增桌面 bridge |

- Realtime 只转发认证账号内的数据；Host 发布必须匹配当前注册租约，订阅无需指定当前执行者。
- 每 Host 至多 64 个 producer、128 个执行中/待交接请求；非本机会话直接忽略。交接空窗内暂存命令到原有 30 秒截止，不以新请求 ID 自动重放未知结果。
- 每观察端至多 64 个 native stream、128 个在途 call，接收队列总计 64MiB，每 stream 最多 256 批。溢出失败并使用原生历史恢复。
- 使用现有有界分片协议。流式批次最多每 producer 25 次/秒；请求结果不等待该节流。stream 45 秒空闲租约，由观察端每 15 秒合并续租；观察端每 15 秒清理，Host 每 100 毫秒检查取消/执行权，退出账号释放整个 scope。
- 当前 producer 对应 native 订阅，尚未合并多个观察者的相同原生订阅；不宣称跨所有观察者只读取/发布一份 native stream。该优化不影响会话频道与执行实例解耦。

### 09-23 补充回归边界

会话频道四轮同步已通过，但整体桌面稳定性还不能全绿：快速取消触发官方 rc.2 的取消原因 JSON 校验失败（直接官方 API 和无插件最小实验复现）；Mac renderer exitCode 5 再现，正在保存诊断证据。详情见 `dsh-local-session-takeover-validation-20260923.md`，不覆盖原有未完成门禁。
