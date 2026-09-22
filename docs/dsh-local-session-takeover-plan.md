# 本机跨实例无感接管方案

日期：2026-09-22。状态：设计提案；P0 的双平台最小实验已通过，完整产品接管尚未实现。非本机 UI 已独立交付；同机隐藏提示不代表已支持接管。

**结论：可进入受控接管原型开发，尚不能按本文直接宣称任意现有原生会话都支持在线交接。** 冷恢复、插件持有 handle 时的在线交接已经实测；原生 controller 自己创建的存量 Agent 缺少公开释放接口，必须先解决生命周期入口归属。实验范围与结果见 [可行性验证](dsh-local-session-takeover-feasibility.md)。

## 产品行为

- 同一电脑、同一操作系统用户、同一账号、同一环境中的实例共享会话入口。浏览、打开或切换会话不改变执行归属；用户不需要理解实例或点击常驻“接管”按钮。
- 在 A 发送下一条消息时，若 B 已空闲，自动交接到 A；之后关闭 B，A 仍可继续。列表保留同一条会话、历史、标题、工作区、草稿与选中状态。
- B 正在执行时，当前轮继续由 B 完成。A 发来的正常下一轮输入排队，安全边界到达后交接；steer、取消、审批和问答仍发给当前执行者，不切走未结束的工具进程。已有 B 队列必须先明确排空/迁移，不能静默丢弃。
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

官方 DSH 只读，当前检查没有修改其源码。上述能力存在不代表在线无感接管已被验证。

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
5. 云端保存稳定会话与当前 owner 的投影，并用 epoch 拒绝迟到的旧 owner 更新。断网可在同机完成有权限的交接，恢复联网后按序上传；本地 journal 未同步前不能让远端请求绕过新 owner。

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
- writer 锁与 owner 元数据不是同一个事务。必须定义协调记录的 prepare/released/active 状态、epoch 持久化点和恢复规则；A 的 Agent 就绪且 owner 提交前禁止受理业务输入，旧 owner 的迟到请求必须被拒绝。实验尚未实现这一协调协议。
- 首版不迁移 B 的内存队列：冻结新普通输入后，等待已有工作到安全边界；保留对当前 owner 的停止/审批入口。等待与恢复都必须可取消、有界且保留 A 草稿，超时不能强抢。具体队列容量、等待预算及提示属于 P0 后需要定稿的合同。
- prompt 去重优先复用官方 `requestId` / durable `rpcId` 合同；另补跨 owner 的状态查询与结果不明处理，不能仅靠内存去重或一份与日志没有恢复关联的“已受理”标记。
- prepare 阶段失败：B 保留执行权，A 的未提交输入保持可重试。
- B 已释放、A 尚未恢复就崩溃：日志为无主且可恢复状态；后继竞争者拿到锁后恢复，不回退覆盖历史。
- A 恢复成功但确认丢失：按 requestId 查询持久化受理记录；不得创建新 requestId 自动再发一遍。受理、日志事件和回执必须具备可恢复关联，不能只用内存去重。
- 两边同时发送：只允许一个 writer 获权；另一个请求重新解析 owner，按原 requestId 路由/排队。不会因打开窗口或 focus 触发互相抢占。
- B 退出/崩溃：验证真实进程身份和锁可用性；PID 或网络离线状态本身不够。恢复沿用 DSH 对未完成 turn/tool 的修复语义，未知副作用需核查后才能重试。
- 手动“停止并接管”作为异常/忙碌场景下的显式操作，不在正常标题栏暴露实例概念。普通发送不暗中杀掉 B 的进行中任务。

## 必须先完成的 P0：生命周期验证

最小实验已用未修改的官方 DSH 0.1.5-rc.2 发布包和隔离子进程完成，macOS / Windows 都验证了持锁拒绝、handle 交接、历史延续、原控制器 prompt、另一会话不受影响、来回交接、退出后恢复。模型使用本地脚本 adapter，未验证真实模型、工具与完整桌面 UI。以下是 P0 完整退出条件，仍需逐项完成：

1. 插件通过公开 API 拥有 AgentHandle，验证原生页面可正常展示、发送、调用工具、取消、选择模型、审批以及恢复该会话。
2. 同一规范 session root 下的 session ID、历史前缀、工作目录与下一轮 model context 已通过；继续验证上下文压缩、附件、预设、审批、子代理及后台任务的语义，以及原生查询投影和事件订阅重新连接。
3. 同时写入只有一方成功；A/B 连续互换；B 正常退出和强杀后恢复；macOS 与 Windows 分别验证。不能使用用户正在运行的实例做破坏性实验。

关键限制：现有原生 controller 创建的会话未公开精确 release handle。若插件不能通过公开的创建/恢复入口持有 handle 并保持原生行为，就不能在插件中调用私有 controller、任意销毁其他 owner 的 Context 或重启整个 B 来冒充单会话交接。此时在线接管需要最小上游 seam：由原生生命周期 owner 提供有界、可等待、停止接收新命令且 flush/dispose 完成后返回的单会话 release/handoff 能力。停止后的冷恢复可先独立验证，但不得宣称已交付在线无感接管。

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
| P2 本机共享与交接 | 客户端负责共享根目录、IPC 和 OS 安全；插件负责 handoff 状态机、Agent lifecycle 与权限；不复制 DSH 执行内核 |
| P3 产品接入 | 普通发送按需无感接管，忙碌/失败显示反馈；Host 能力同时提供受控 UI、SDK、Tools 入口 |

接管改变跨仓主流程、会话身份和失败恢复，进入实现时同步 OpenSpec 契约；本次 UI 不引入该契约变化。

验收最低集合：A/B 正常互接；B 退出后 A 接续；两实例同时发送不双跑；交接各阶段进程退出不丢记录；未知写操作不重复；账号/环境严格隔离；模型/工具/工作目录兼容；排队/steer/审批正确归属；断网交接后远端目录只出现一条；旧客户端不误写；卸载清理无重复后台进程。两平台都要真实运行，不用单测替代。
