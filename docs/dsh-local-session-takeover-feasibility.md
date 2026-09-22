# 本机接管：可行性验证记录

日期：2026-09-22。关联：[接管方案](dsh-local-session-takeover-plan.md)。

## 结论与决策

数据恢复和跨进程 writer 排他有可运行基础。插件合法持有 `AgentHandle` 时，可只释放一条会话，另一进程按同一 session ID 恢复，继续经过官方原生 controller 的 prompt 路径执行；源进程的其他会话继续工作。

**任意现有原生会话的在线无感接管尚不能承诺。** 原生 controller 创建/恢复会话后只向调用者返回 session ID 或裸 Agent，不公开精确 release/handoff。实验确认 cancel 不释放 writer。对这类会话，已证实的路径是源生命周期结束后冷恢复；不能强行 dispose 别人的 Context，不能停止整个客户端冒充单会话交接。

开发决策：可以开始“插件拥有生命周期”的受控原型；将所有普通会话创建/恢复入口纳入该 owner 后，才可以开启在线接管。若通过公开扩展点无法覆盖这些入口，则在线接管需要原生生命周期 owner 新增最小释放能力。在 P0 退出前不开展完整接管交付，也不宣称无需 DSH 上游支持。

## 验证对象与隔离

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
| 原生 controller 自己创建的会话，没有公开 release/handoff 或裸 Agent dispose | 已确认 | 已确认 | 现有原生 owner 接口缺口 |
| 上述原生会话 cancel 后仍持锁，源 Context 正常退出后 A 可继续历史 | 通过 | 通过 | 原生存量会话冷恢复可行；没有证明在线释放 |

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
2. **真实能力装配**：模型选择、权限、预设、MCP、Shell、附件、压缩历史、子代理和后台任务；尤其要证明 dispose 完成时没有仍能写文件的受管任务。当前实验仅覆盖文本，不包括进行中的工具崩溃。
3. **身份与恢复协议**：稳定 conversation identity、ownerEpoch、所有权提交与 input requestId 的关联恢复，断网和并发交接。这些是 Arkme 层尚未实现的合同，不由 writer 锁自动提供。
4. **迁移与版本门禁**：已有实例独立目录迁入共享根后，旧版本不能继续写原副本；不允许自动降级到过时的备份。

如果必须直接交接仍活着的旧原生 Agent，所需最小上游能力应由原 owner 实现：按 session ID 冻结激活/写入入口，处理队列，停止并等待该 Agent 及受管任务退出，flush/close writer，再给出可恢复的释放结果。仅新增一个 cancel 别名或返回当前 Agent 都不满足要求。该能力尚不存在于当前已验证接口中，本次未修改 DSH。

## 重跑与证据

可重跑脚本为 `scripts/verify-local-session-takeover.mjs`。本任务工作目录的 `artifacts/takeover-probe/` 保存 macOS `mac-final/result.json`、Windows `windows-electron-result.json` 及日志；交付记录给出实际位置。脚本接收已安装客户端根目录和全新输出目录：

```text
<matching Node executable> scripts/verify-local-session-takeover.mjs <client-root> <fresh-output-root>
```

使用 Electron 可执行文件时，仅为实验进程设置 `ELECTRON_RUN_AS_NODE=1`。每次使用新的输出目录；脚本内的进程终止只针对它创建的子进程。9 项检查均通过，部分检查是“正确拒绝”的负向断言，不表示原生在线释放已通过。没有提交、推送或修改业务运行代码。
