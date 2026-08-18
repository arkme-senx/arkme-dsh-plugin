# Arkme master 合并与私聊呼出能力移植设计

## 背景

当前分支 `codex/tmp-v95-outgoing-call-20260818` 已实现私聊主动发起语音、视频通话，并已推送到 `arkme`。最新 `arkme/master` 从共同基点之后完成了 Jotmo 到 Arkme 的架构迁移：客户端组件、服务类型、Host API 和模型工具注册方式均已重构。直接选择任一侧的冲突内容都会丢失另一侧能力。

本次合并以最新 master 为架构基线，仅移植当前分支的私聊主动呼出能力，不恢复 master 已删除的旧通话记录、录音或相关录音界面。

## 目标

- 将最新 `arkme/master` 正常合并到当前临时分支，保留可追溯的合并历史。
- 完整保留 master 的 Arkme 会话目录、主题树、官方群、实时聊天和模块化工具体系。
- 在 Arkme 私聊会话页中继续支持用户主动发起语音或视频通话。
- 保留现有通话意图、呼叫租约、心跳、释放和仅主动呼出的安全约束。
- 解决全部文本冲突，并通过类型检查、测试、通话资源校验和构建。

## 非目标

- 不恢复 master 已删除的 Jotmo 旧 UI 或服务入口。
- 不恢复旧通话记录、全天候录音、相关录音界面及其导航状态。
- 不增加被叫、群通话或新的通话产品行为。
- 不重写或强制推送现有临时分支历史。
- 不修改固定 `desktop_call` 派生产物的业务逻辑或安全清单。

## 合并策略

使用普通 merge 将 `arkme/master` 合入当前临时分支。冲突处理遵循以下规则：

1. 架构、命名、目录结构和 master 新增功能以 master 为准。
2. 当前分支中与私聊主动呼出直接相关的能力按 Arkme 约定移植。
3. master 已删除且不属于主动呼出的旧功能不保留。
4. 共享文档、配置和导出只保留新架构实际需要的条目。
5. 不采用 `ours` 或 `theirs` 批量覆盖；每个冲突按职责逐项解析。

该策略会生成一个正常的 merge commit，GitHub 能识别 master 已被合入，无需 force-push。

## 客户端设计

### 私聊入口

在 `ArkmeSidebar` 的会话页头增加通话操作，仅当当前 source 的 `kind` 为 `private_chat` 时显示。点击按钮展开包含“语音通话”和“视频通话”的菜单；点击外部或按 Escape 关闭菜单。

```text
┌──────────────────────────────────────┐
│ 张三  [通话]                         │
├──────────────────────────────────────┤
│                聊天消息              │
│                                      │
│                           [发送框]    │
└──────────────────────────────────────┘

点击 [通话]：

       ┌──────────────┐
       │ 🎙 语音通话  │
       │ 🎥 视频通话  │
       └──────────────┘
```

群聊、自建主题、官方群入口和未登录状态均不显示该按钮。组件沿用 Arkme 页头现有视觉变量与布局，不引入新的全局样式依赖。

### 通话容器

保留全局 outgoing-call controller、runtime、bridge 和 Host 容器。用户发起呼叫后，容器加载固定桌面通话资源，并继续支持普通、紧凑和全屏布局。

```text
┌──────────────────────────────────────┐
│          正在呼叫张三…               │
│                                      │
│      桌面通话组件（可缩小/全屏）      │
│                                      │
│              [挂断]                  │
└──────────────────────────────────────┘
```

组件和公开导出改为 Arkme 命名；内部通话运行时职责保持不变。

## 服务与 Host API 设计

将主动呼出相关契约、broker 和服务方法接入 `ArkmeService`：

- `prepareOutgoingCall`：校验 source 是当前用户可访问的私聊，并获取呼叫凭据。
- `claimOutgoingCallIntent` / `resolveOutgoingCallIntent`：承接模型工具创建、UI 消费的单次呼叫意图。
- `heartbeatOutgoingCall` / `releaseOutgoingCall`：维护同一用户的单通话租约并在结束时释放。
- logout/dispose：清理用户意图、租约和定时器。

Host API 继续提供以下内部操作：

- `calls.outgoing.intent.claim`
- `calls.outgoing.intent.resolve`
- `calls.outgoing.prepare`
- `calls.outgoing.heartbeat`
- `calls.outgoing.release`

Arkme 客户端配置增加 `callAssetBasePath`，其值使用 `/arkme-self/api/call`。静态资源处理器仍只允许 manifest 中列出的文件，并维持 `outgoingOnly: true` 校验。

## 模型工具设计

不恢复已删除的 `jotmo-tools.ts`。新增一个符合 master 模块契约的 Arkme business write 模块：

- 工具名：`arkme_call_start`
- effect：`write`
- grant：`explicit-user-write`
- 输入：未修改的私聊 `source_ref` 与 `audio | video`
- 输出：安全的呼叫请求结果，不暴露 userSig 等敏感凭据

工具仅在当前人类明确要求发起通话时使用，并要求 source 来自 Arkme source 列表且类型为私聊。执行后写入 broker 意图，由 UI runtime 认领并真正发起呼叫。

## 数据流

### 人工点击

1. 用户在 Arkme 私聊页头选择语音或视频通话。
2. UI controller 发布呼叫请求。
3. runtime 调用 `calls.outgoing.prepare` 获取短期呼叫配置并占用租约。
4. 固定桌面通话资源通过 bridge 启动呼叫。
5. runtime 定期发送 heartbeat；结束、失败或卸载时 release。

### 模型工具

1. 模型在用户明确授权后调用 `arkme_call_start`。
2. 工具校验输入并向 broker 写入一次性 intent。
3. UI runtime 认领 intent，随后复用人工点击的 prepare、bridge、heartbeat 和 release 流程。
4. runtime 将 calling、completed、cancelled 或 failed 状态回写 intent。

## 错误与安全处理

- 非私聊 source、失效 source、非法媒体类型在请求远端前拒绝。
- 同一用户已有通话租约时拒绝第二路主动呼叫。
- 敏感凭据只存在于 Host 与受控 bridge 消息中，不写入模型工具结果或日志。
- bridge 校验消息来源、请求 ID 和 outgoing-only 标记。
- prepare 后任一步骤失败都释放租约并回写明确失败状态。
- UI 展示可恢复错误，关闭或退出登录时清理本地呼叫状态。

## 冲突处理范围

预计需要手工整合的核心文件包括：

- 包配置与文档：`package.json`、`cordis.patch.yml`、README 和 consumer contract。
- 客户端：Arkme 主入口、`ArkmeSidebar`、UI controller 和客户端导出。
- 服务：`ArkmeService`、Host API、插件入口、类型与 SDK 导出。
- 工具：Arkme business 模块和 catalog。
- 测试：Host API、服务、工具、UI controller、SDK 与主动呼出专项测试。

旧 `JotmoSidebar`、`jotmo-service.ts`、`jotmo-tools.ts` 及 master 已淘汰的录音相关文件不作为冲突结果保留。

## 验证

至少执行以下验证：

1. 检查 Git 冲突标记和未合并索引全部清零。
2. 运行 TypeScript 类型检查。
3. 运行完整 Vitest 测试集，包括 Arkme master 新增测试与主动呼出专项测试。
4. 运行 `scripts/verify-call-assets.mjs`，验证固定资源清单和 outgoing-only 约束。
5. 运行声明文件生成与生产构建。
6. 检查 merge commit 的两个 parent，并确认当前分支包含最新 `arkme/master`。
7. 推送当前临时分支到 `arkme`，确认远端分支哈希与本地一致。

## 完成标准

- 工作区无冲突、无未暂存改动。
- 最新 master 的 Arkme 功能与测试均被保留。
- 私聊页头可发起语音、视频通话，其他 source 不显示入口。
- 模型工具通过 `arkme_call_start` 接入 master 的模块化注册体系。
- 通话敏感信息、租约与 outgoing-only 安全测试通过。
- 类型检查、完整测试、资源校验、声明生成和构建全部通过。
