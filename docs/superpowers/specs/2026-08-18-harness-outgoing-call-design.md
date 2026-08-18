# Harness 私聊发起通话设计

**日期：** 2026-08-18

**状态：** 已确认

## 目标

在 v95 当前的 `jotmo-dsh-plugins` 中新增“仅发起”的一对一音视频通话能力：

- 私聊内容区标题中的用户昵称后新增通话按钮，点击后选择“语音通话”或“视频通话”。
- 以居中弹窗承载呼叫界面，视觉和交互复用 `jotmo_frontend` 桌面端 Web 呼叫实现。
- 新增 Harness Tool。Agent 先查询现有私聊用户，再用其不透明 `source_ref` 发起通话。
- 页面按钮与 Tool 共用同一条准备、展示、呼叫和错误处理链路。

本期不实现来电注册、来电弹窗、响铃或接听；Web 呼叫引擎只在用户明确发起时按需登录，通话结束后立即销毁。

## 已确认低保真界面

### 私聊标题与媒体类型菜单

通话入口只出现在 `private_chat` 内容区，位于昵称之后。按钮和菜单尺寸遵循现有 `jotmo_frontend` 桌面端实现：

```text
┌──────────────────────────────────────────────────────────┐
│ 小林                                      [☎]            │
│                                            ┌────────────┐│
│                                            │ 🎙 语音通话││
│                                            │ 🎥 视频通话││
│                                            └────────────┘│
├──────────────────────────────────────────────────────────┤
│ 私聊时间线                                                │
└──────────────────────────────────────────────────────────┘
```

- 按钮点击热区为 `24 × 24`，内部图标为 `20 × 20`，使用前端现有通话 SVG 资产。
- 菜单圆角为 `12`，与按钮间距为 `8`；菜单项高度为 `32`。
- 菜单项图标为 `18 × 18`，文字为 `13px / 500`。
- 群聊、自聊和通话记录内容区不显示此按钮。

### 音频呼叫弹窗

```text
                ┌──────────────────────────────────────────┐
                │                                 [缩放][×]│
                │        模糊的对方头像背景                │
                │                                          │
                │                 (头像)                   │
                │                  小林                    │
                │                正在呼叫…                 │
                │                                          │
                │       [麦克风] [扬声器] [挂断]           │
                └──────────────────────────────────────────┘
```

### 视频呼叫弹窗

```text
                ┌──────────────────────────────────────────┐
                │ 对方视频/头像                  [缩放][×] │
                │                                          │
                │                              ┌─────────┐ │
                │                              │本地预览 │ │
                │                              └─────────┘ │
                │                                          │
                │ [麦克风] [扬声器] [摄像头] [挂断]        │
                └──────────────────────────────────────────┘
```

- 默认弹窗内容尺寸为 `960 × 640`，在小视口中按安全边距收缩，最低遵循现有呼叫页的 `360 × 640` 适配能力。
- 弹窗带遮罩，并以 Portal 挂到 `document.body`，不受即我内容区滚动和裁剪影响。
- 继续支持前端 Web 呼叫页已有的全屏与迷你模式。迷你模式约为 `160 × 280`，可恢复默认尺寸。
- 呼叫建立或正在呼叫时，点击遮罩和按 `Escape` 不会直接关闭；关闭动作统一进入挂断流程。
- 终态事件展示原有状态后约 `800ms` 自动关闭弹窗。

## 范围

包含：

- 私聊标题通话按钮和音频/视频选择菜单。
- 复用前端桌面端 Web 呼叫 UI、图标、状态和设备控制交互。
- 主叫身份、对端身份、TRTC 凭证与房间的按次准备。
- 音频/视频权限申请、发起、挂断和明确失败提示。
- 全局浏览器呼叫协调器，使即我内容区未打开时 Tool 仍可调起弹窗。
- `jotmo_call_start` Tool，以及查询私聊用户后精确发起的 Agent 使用规则。
- 单通话互斥、账号隔离、短期 Tool 意图交接和敏感凭据边界。

不包含：

- 来电监听、被叫弹窗、接听、拒接或后台响铃。
- 群聊或多人通话。
- 通话记录、录音、转录和摘要流程的改动。
- 重拨、预约、屏幕共享、通话邀请链接或离线推送配置界面。
- 把原始用户 ID、TRTC account、room ID 或 UserSig 暴露给 Tool、Agent 或公开 Consumer SDK。
- 远程托管呼叫页；运行时只加载插件随包携带并校验版本的本地资产。

## 方案比较

### 方案 A：在插件 React 中重写呼叫 UI

优点是 React 状态统一；缺点是必须复制设备菜单、全屏/迷你模式、权限提示、呼叫状态机和大量视觉细节，后续容易与桌面端前端漂移。

### 方案 B：在弹窗 iframe 中复用桌面端 Web 呼叫产物（采用）

把 `jotmo_frontend/assets/web/desktop_call` 的固定版本资产随插件打包，仅增加很薄的 Harness Host Bridge。优点是 UI 和呼叫行为与现有桌面端一致，迁移范围清晰；代价是需要严格定义父子页面通信和凭据生命周期。

### 方案 C：打开独立浏览器窗口

优点是接近 Flutter 桌面窗口；缺点是弹窗可能被浏览器拦截、窗口生命周期难与 Harness 页面同步，也不符合已确认的“内容内弹窗”体验。

因此采用方案 B。业务与安全编排留在插件 Host/父页面，iframe 只负责既有呼叫 UI 和 TRTC 引擎。

## 总体架构

```text
私聊标题按钮 ───────────────┐
                            │
Harness Tool                │
  jotmo_sources_list        │
  jotmo_call_start          │
        │                   │
        └─ 短期呼叫意图 ────┤
                            v
                JotmoOutgoingCallHost
                （全局单实例、Portal）
                         │
                same-origin Host API
                         │
                  JotmoService
          ┌──────────────┼──────────────┐
          v              v              v
      Chat Detail   TRTC Credentials  Create Room
          │              │              │
          └──────────────┴──────────────┘
                         │
                   临时呼叫 DTO
                         │
                         v
             本地 desktop_call iframe
                  bootstrap -> call
                         │
                  calling/begin/end
                         │
               状态回传父页面与 Tool
```

### 前端入口

新增聚焦组件 `JotmoPrivateCallMenu`，由 `JotmoSidebar` 的标题区域渲染：

- 仅当当前 Source 的 `kind === 'private_chat'` 时显示。
- 点击菜单项只提交 `sourceRef + mediaType`，不在组件内获取用户 ID、凭据或房间。
- 组件调用全局 `jotmoCallUi.start()`；因此按钮和 Tool 不会形成两套呼叫实现。

### 全局呼叫协调器

`JotmoOutgoingCallHost` 挂在始终存在的 Footer 插槽树，而不是即我 Surface 内部。这样用户关闭即我页面后，Tool 仍能找到浏览器协调器并打开弹窗。

协调器职责：

- 全局维护 `idle | preparing | bootstrapping | calling | active | ending | failed` 状态。
- 只允许一个 `preparing/calling/active` 会话；第二次发起返回“当前已有通话进行中”。
- 调用 Host API 准备本次呼叫，再创建本地 iframe。
- 把固定白名单命令发送给 iframe，把固定白名单事件映射回父页面。
- 处理默认、全屏、迷你模式与统一挂断/关闭。
- 对 Tool 发起的意图回报 `calling` 或终态失败。
- 页面卸载、退出登录或账号切换时挂断并清除所有临时状态。

## 桌面端 Web UI 复用

复用源以 `jotmo_frontend/tools/desktop_call_web` 为准，发布产物以 `jotmo_frontend/assets/web/desktop_call/bundle.js` 为准。实现阶段把经确认的固定版本复制到插件资产目录，并记录：

- 上游仓库提交号。
- `bundle.js` 的 SHA-256。
- 上游包版本及 `@trtc/call-engine-lite-js` 版本。

CI 检查插件内资产与记录的 hash 一致，避免人工修改生成文件。后续升级通过显式同步完成，不在插件构建时跨仓库隐式读取。

iframe 的 Host Bridge 只适配宿主通信：

- 把 Web 页原有 `postFlutterMessage` 输出转为受控的 `parent.postMessage`。
- 父页面向 Web 页发送原有 `bootstrap`、`call`、`hangup`、麦克风、摄像头、扬声器、全屏、迷你和销毁命令。
- 不改写呼叫页的视觉结构、设备菜单、状态提示和 TRTC 呼叫状态机。

iframe 必须为同源本地资源，设置最小所需的 `allow="camera; microphone; autoplay"`。消息接收同时校验 `event.source`、同源 `event.origin`、当前 `callRequestId` 和事件 schema；未知事件、旧会话事件和任意外部消息直接丢弃。

## Host API 与服务设计

浏览器敏感操作属于插件内部 Host API，不进入通用 Consumer SDK。公开 Provider 契约仍可增加 `outgoingCall: true` 的能力标记，但不会公开包含 UserSig 的 DTO。

### 按次准备

内部操作 `calls.outgoing.prepare` 接收：

```ts
interface JotmoOutgoingCallPrepareInput {
  sourceRef: string
  mediaType: 'audio' | 'video'
  callRequestId: string
}
```

Host 执行顺序：

1. 验证登录态、`sourceRef` 签名和当前账号绑定。
2. 拒绝非 `private_chat` Source；不根据显示名猜测目标。
3. 通过 Source 中的私聊会话引用重新查询 Chat Detail，读取当前 `private_counterpart.user_id` 和会话/共享主题标识。这样不会使用可能过期的列表目标。
4. 获取当前登录用户的 TRTC credentials 和安全的公开通话资料。
5. 调用 WebRTC `create-room`，只提交当前对端 user ID、媒体类型、会话标识和主叫展示名。
6. 校验 WebRTC 返回的 `callee_accounts` 非空，并投影为 iframe 所需的临时 DTO。

准备结果包含 `bootstrap` 和 `call` 所需字段，但有以下边界：

- UserSig 只存在于本次 HTTP 响应、协调器临时变量和 iframe 内存中。
- UserSig 不写入 Tool 结果、日志、异常文本、DOM 属性、URL、导航状态、localStorage、sessionStorage、IndexedDB 或 SQLite。
- 父页面完成 `bootstrap` 后立即释放其 UserSig 引用；iframe 在终态执行 `terminate/logout` 并销毁。
- Access Token、Refresh Token 和 OSS 临时凭据始终只在 Host 内。
- 头像只允许规范化的公开 HTTPS URL；无法安全提供时使用默认头像，不返回签名存储凭据。
- 原始 user ID、room ID、TRTC account 只进入 iframe 临时调用参数，不进入 Agent 可见契约。

401/403 继续复用现有短 Token 刷新机制，只刷新并重放一次。准备流程任何阶段失败都不得遗留已登录的 iframe 引擎。

### Tool 与浏览器的短期意图交接

Tool 运行在 Host，而弹窗只能由已连接的 Harness 浏览器页面呈现。服务层提供账号绑定的内存态意图队列：

```ts
interface OutgoingCallIntent {
  intentId: string
  sourceRef: string
  mediaType: 'audio' | 'video'
  createdAtMillis: number
  expiresAtMillis: number
}
```

- `jotmo_call_start` 创建意图后等待结果，不直接接触 UserSig。
- 全局协调器以约 `750ms` 间隔 claim 当前账号的最早意图；一个意图只能被一个页面领取。
- 意图 TTL 为 `30s`；页面需在领取后立即打开弹窗和执行准备。
- 协调器在收到 iframe `calling` 后回报成功；准备、权限、登录、呼叫或引擎失败则回报结构化失败。
- Tool 最长等待 `30s`，调用被取消时同步取消未领取意图；已开始的呼叫不因 Agent 响应取消而自动挂断。
- 无浏览器页面领取时返回 `call-ui-unavailable`，不把“已入队”误报为“已发起”。
- 退出登录、账号切换和服务销毁会清除本账号待处理意图，并唤醒等待方。

意图 API 只接受同源已认证页面，按账号隔离，并使用一次性 claim token 完成状态回报。过期、重复、跨账号或旧 callRequestId 的回报均拒绝。

## Tool 设计

新增 Tool：

```text
jotmo_call_start
  source_ref: string
  media_type: "audio" | "video"
```

Agent 的固定执行规则：

1. 只有用户在当前对话中明确要求发起通话时才调用。
2. 先调用 `jotmo_sources_list(root)` 查询现有 Source，并只选择 `kind=private_chat` 的项。
3. 使用列表返回的精确 `source_ref`；不得根据昵称、历史通话、页面内容或模型记忆构造、猜测引用。
4. 同名或目标不明确时先请用户确认，不自动选择第一项。
5. `media_type` 未明确时根据用户原话判断；仍不明确时先询问音频还是视频。
6. Tool 仅在 iframe 报告 `calling` 时返回成功；否则返回可行动的失败原因。

Tool 成功输出只包含安全展示信息，例如：

```text
已向“小林”发起视频通话，呼叫界面已打开。
```

失败输出只包含规范化错误码和用户文案。不得包含 `source_ref`、user ID、TRTC account、room ID、UserSig、Token、原始远端响应或内部堆栈。

页面按钮虽然不经过 Tool，但仍由用户点击这一显式动作授权；两种入口都不会自动重试到其他私聊用户。

## 端到端时序

### 页面按钮发起

```text
用户点“视频通话”
  -> JotmoOutgoingCallHost.start(sourceRef, video)
  -> Host API prepare
  -> 创建弹窗和本地 iframe
  -> iframe ready
  -> bootstrap(credentials)
  -> call(room + callee account)
  -> iframe calling
  -> UI 保持并等待 begin/end
```

### Tool 发起

```text
用户要求“给小林打视频电话”
  -> Agent: jotmo_sources_list(root)
  -> Agent 选择小林的精确 private_chat source_ref
  -> Agent: jotmo_call_start(source_ref, video)
  -> Host 创建短期意图并等待
  -> 全局协调器 claim 意图、打开弹窗、prepare
  -> iframe bootstrap + call
  -> iframe calling
  -> 协调器完成意图
  -> Tool 返回“已发起”
```

## 状态与错误

| 场景 | 行为与用户文案 |
| --- | --- |
| Source 不是私聊 | 不联系 WebRTC；“仅支持向私聊用户发起通话” |
| Source 篡改、过期或跨账号 | 统一按无效私聊引用处理，不泄露校验细节 |
| 私聊对端已不存在 | “当前私聊用户不可用，请刷新后重试” |
| 对端没有可呼叫账号 | “对方暂不可通话，请对方登录后再试” |
| 已有呼叫正在准备或进行 | “当前已有通话进行中” |
| 浏览器页面未领取 Tool 意图 | “呼叫界面不可用，请打开 Harness 页面后重试” |
| 麦克风/摄像头权限拒绝 | 保留桌面端 Web 呼叫页的权限说明，并向 Tool 返回权限失败 |
| 凭证过期 | Host 刷新并重放一次；再次失败后停止 |
| iframe 未 ready 或 Bridge 超时 | 销毁 iframe；“呼叫界面加载失败，请重试” |
| TRTC 呼叫失败/忙线/无响应 | 使用前端已有状态文案；Tool 返回对应规范化失败 |
| 页面退出或账号切换 | 主动挂断、终止引擎、关闭弹窗、清理待处理意图 |

不对准备、创建房间或引擎呼叫做无限自动重试，避免产生重复房间或重复外呼。

## 安全与隐私

- 只有显式点击或当前对话中的显式通话请求才可触发麦克风/摄像头权限和网络外呼。
- `sourceRef` 继续使用账号绑定和 HMAC 完整性校验；Host 重新读取私聊详情确定当前对端。
- Tool 意图、准备请求、iframe 命令和事件都携带随机 `callRequestId`，旧状态不能覆盖新通话。
- iframe Bridge 采用精确 origin/source/schema 白名单；禁止把任意 iframe 消息转发到 Host API。
- 插件 CSP 只允许本地呼叫资产和已配置的 TRTC 必需连接；不加载任意远程呼叫页面或脚本。
- Host 的请求与错误日志只记录阶段、规范化错误码和 request ID，不记录请求正文中的凭据/账号/房间字段。
- 本期不保持后台 TRTC 登录，因此不存在被动收取来电的能力。

## 测试策略

### Service 与 Host API

- 私聊 Source 可准备；群聊、自聊、篡改引用和跨账号引用在远端请求前失败。
- Chat Detail 重新解析当前对端，并正确向 credentials/create-room 发送所需字段。
- credentials/create-room 的成功、空账号、坏 envelope、401/403 单次刷新和超时路径。
- 准备 DTO schema 严格；Tool 输出和日志格式化器不会序列化 UserSig、room ID、账号或 Token。
- 意图的 TTL、单次 claim、并发互斥、账号隔离、取消和退出登录清理。

### Tool

- `jotmo_call_start` 只接受非空 `source_ref` 和 `audio|video`。
- 工具描述明确要求先查询 Sources、仅私聊、目标歧义时询问和显式用户授权。
- `calling` 才返回成功；无页面、超时、准备失败、权限失败和引擎失败均返回规范化错误。
- 成功/失败文本不包含内部引用或敏感字段。

### React 与 Bridge

- 通话按钮只在私聊标题出现，菜单标签、尺寸、定位和键盘交互符合已确认原型。
- 全局协调器在即我 Surface 关闭时仍能领取 Tool 意图。
- 单通话互斥；活动通话不能被遮罩或 Escape 静默关闭。
- iframe 只接受当前同源、当前 source、当前 request ID 的事件。
- 覆盖 `ready -> bootstrap -> call -> calling -> begin -> end` 以及权限、忙线、无响应和 fatal error。
- 默认、全屏、迷你和恢复模式均映射到弹窗容器。

### 资产与集成

- 校验插件内 `desktop_call` 产物 hash 和记录的上游版本。
- `pnpm test`、`pnpm typecheck` 和 `pnpm build` 通过，构建包包含本地呼叫资源。
- 在 Harness 手工验证音频、视频、麦克风/摄像头切换、扬声器选择、挂断、拒绝权限和 Tool 外呼。
- 手工确认 Tool 发起时即使即我内容区关闭，也会在当前 Harness 页面弹出呼叫界面。

## 实施顺序

1. 先补 Service/Host API 的失败测试，实现私聊解析、凭证、创建房间和临时准备 DTO。
2. 补意图协调和 Tool 测试，实现 `jotmo_call_start` 的等待/完成链路。
3. 同步并校验固定版本的桌面端 Web 呼叫资产，完成最小 Bridge 适配。
4. 实现全局 `JotmoOutgoingCallHost` 与弹窗状态机。
5. 实现私聊标题按钮和媒体类型菜单，接入同一协调器。
6. 完成安全回归、构建、手工音视频验收和文档更新。

每一步遵循测试先行；在 Service 与 Tool 的安全边界稳定前，不接入真实 UI 呼叫。

## 验收标准

- 私聊标题昵称后能选择语音或视频；其他 Source 不出现通话入口。
- 点击后在 Harness 内以弹窗呈现与 `jotmo_frontend` 桌面端一致的呼叫 UI。
- 音频和视频均可真正向当前私聊对端发起，设备控制和挂断可用。
- 不注册来电、不展示接听 UI，也不会在空闲时保持 TRTC 登录。
- Agent 可先列出现有私聊用户，再用精确 `source_ref` 调用 `jotmo_call_start`。
- Tool 只有在实际进入 `calling` 后才报告已发起；页面不可用或呼叫失败时不会误报成功。
- 即我内容区关闭时，Tool 仍能通过全局协调器打开呼叫弹窗。
- UserSig、Token、原始用户/房间/账号标识不会进入 Tool、Agent、持久化存储或日志。
- 自动测试、类型检查、构建和 Harness 手工音视频验证全部通过。
