# Harness 通话记录设计

**日期：** 2026-08-18

**状态：** 待书面设计审阅

## 目标

在 v95 当前的 `jotmo-dsh-plugins` 中新增只读“通话记录”能力。登录用户可以从 DSH 左侧 Footer 的即我下拉面板进入通话记录，在右侧即我内容区内以“通话列表 + 通话详情”双栏布局查看真实 TRTC 通话的概览、AI 摘要与转录。

本设计延续当前 v95 已上线的 Footer 导航、导航缓存、头像安全读取、临时 `conversation` 插槽和 Session 切换行为，不把即我导航迁回旧版 `conversation` 左栏。

## 范围

包含：

- 从 Data 聚合接口分页读取历史，只保留真实 TRTC 通话。
- 通过 Auth 公共资料接口批量补全列表展示名称。
- 从 WebRTC 详情接口读取选中通话的参与人、概览、查看者视角 AI 摘要和转录。
- Provider、Host API 与 Browser SDK 的只读列表/详情契约。
- Footer “通话记录”入口以及内容区内部双栏页面。
- 加载、空数据、处理中、失败、重试、分页和过期响应保护。

不包含：

- 发起通话、重拨、删除、分享、导出或下载。
- 重试或触发摘要/转录生成。
- 音频或视频播放、预览、对象下载。
- Data 聚合返回的 AI 对话和微信导入通话。
- SQLite 缓存、全文搜索、Agent 工具、系统提示词注入或自动加入 DSH 会话上下文。
- 按群主题查询群名称；群通话使用参与人名称组合或人数兜底。

## 已确认界面

Footer 导航保持 v95 当前结构，只新增一个入口；双栏只存在于右侧即我内容区：

```text
DSH 左侧栏 / 即我下拉                  右侧即我内容区
┌─────────────────────┐      ┌────────────────────┬───────────────────────┐
│ 即我                │      │ 通话记录列表       │ 通话详情              │
│                     │      │                    │                       │
│ 发给自己            │      │ [选中] 小林        │ 小林 · 视频通话       │
│ 通话记录  ← 新入口  │      │ 视频 · 24分30秒    │ 今天 14:10 · 已接通   │
│ 小林                │      │ 今天 14:10         ├───────────────────────┤
│ 项目群              │      │                    │ AI 摘要               │
│                     │      │ 群通话（3人）       │ 讨论了 V95 发布范围…  │
└─────────────────────┘      │ 音频 · 未接通      │                       │
                             │ 昨天 18:42         │ 转录                  │
                             │                    │ 00:12 我   先同步……  │
                             │     加载更多       │ 00:25 小林 登录链路…  │
                             └────────────────────┴───────────────────────┘
```

交互规则：

- “通话记录”只出现在 Footer 下拉的根会话目录，位置在“发给自己”之后、私聊/群聊之前。
- 点击入口调用现有 `onActivateSurface`，继续使用官方 `conversation` 临时插槽；Footer 展开/关闭逻辑不变。
- 首个成功列表页自动选中第一条通话；选择其他记录只刷新详情栏。
- “加载更多”追加并按 `callRef` 去重，不清空当前选择。
- 聚合当前页没有 TRTC 项但 `has_more=true` 时仍显示“加载更多”，因为后续混合页可能存在 TRTC 通话。
- 终态空列表显示“暂无通话记录”；没有选择时详情栏显示“请选择一条通话记录”。
- 列表失败在左栏显示重试；详情失败在右栏显示重试，互不覆盖。
- 详情响应带请求代次；旧选择的迟到响应不得覆盖当前详情。
- 关闭即我、切换原生 Session 或点击“新会话”继续遵循 v95 现有行为。页面重新挂载后重新读取首屏，不把通话正文持久化到导航缓存。

## 架构与数据流

Host 侧 `JotmoService` 继续独占 Keychain 凭据和远端请求，新增两个 HTTPS Origin：

| 配置 | 测试环境默认值 | 生产环境显式覆盖目标 |
| --- | --- | --- |
| `dataBaseUrl` | `https://jotmo-data.senguo.me` | `https://data.jotmo.cc` |
| `webrtcBaseUrl` | `https://jotmo-webrtc.senguo.me` | `https://webrtc.jiwo.cc` |

两项配置复用现有校验：必须是 HTTPS Origin，不允许用户名、密码或业务路径。与现有服务地址相同，Schema 默认指向测试环境；生产部署必须显式覆盖地址并设置 `allowProduction: true`。

列表数据流：

```text
JotmoCallHistorySurface
  -> same-origin POST /jotmo-self/api { operation: calls.list }
  -> JotmoService.listCalls()
  -> Data POST /api/v1/call/history-aggregate
  -> 过滤 source=trtc
  -> Auth POST /api/v1/auth/get-public-users-by-ids（名称补全，失败可降级）
  -> Host 安全 DTO
```

详情数据流：

```text
选中的 callRef
  -> same-origin POST /jotmo-self/api { operation: calls.detail }
  -> JotmoService.readCall(callRef)
  -> 校验账号绑定的 callRef
  -> WebRTC POST /api/v1/trtc/call-detail { room_id }
  -> Host 剔除媒体、对象、原始账号与声纹字段
  -> Host 安全 DTO
```

Data、Auth、WebRTC 都由 Host 注入 Bearer。遇到 HTTP 401/403 时复用现有短 Token 刷新机制，只刷新并重放一次；请求超时继续使用 `requestTimeoutMs`。

## Provider 与 SDK 契约

这是纯增量只读能力，`JOTMO_PROVIDER_CONTRACT_VERSION` 保持 `1`，已有 Consumer 无需修改。

能力表新增：

```ts
features: {
  callHistory: true
  callDetail: true
}
```

操作新增：

```ts
type JotmoPluginOperation =
  | /* 现有操作 */
  | 'calls.list'
  | 'calls.detail'
```

SDK 新增：

```ts
listCalls(options?: {
  limit?: number
  cursor?: string
  signal?: AbortSignal
}): Promise<JotmoCallList>

readCall(
  callRef: string,
  options?: { signal?: AbortSignal },
): Promise<JotmoCallDetail>
```

`limit` 默认 `20`，Host 约束为 `1..50`；Data cursor 作为不透明字符串原样往返。SDK 在发请求前拒绝空 `callRef`。

### 列表 DTO

```ts
type JotmoCallMediaType = 'audio' | 'video' | 'unknown'
type JotmoCallDirection = 'incoming' | 'outgoing' | 'group' | 'unknown'
type JotmoCallSectionState = 'ready' | 'empty' | 'processing' | 'failed'

interface JotmoCallListItem {
  callRef: string
  displayName: string
  participantCount: number
  mediaType: JotmoCallMediaType
  direction: JotmoCallDirection
  connected: boolean
  startedAtMillis: number
  acceptedAtMillis: number
  endedAtMillis: number
  durationMillis: number
  summaryState: JotmoCallSectionState
  summaryPreview: string
}

interface JotmoCallList {
  items: JotmoCallListItem[]
  hasMore: boolean
  nextCursor?: string
}
```

列表投影规则：

- 只接受 `source === 'trtc'` 且 `trtc.room_id` 为非空字符串的聚合项；其他来源和缺少房间 ID 的坏项直接丢弃，不拖垮整页。
- 参与人是 `caller_user_id + callee_user_ids` 去重后的正整数集合。Host 用当前登录 `userId` 识别自己，用其余 ID 批量查询 Auth 公共资料。
- Auth 补全是展示增强：请求失败或个别资料缺失时列表仍成功。一对一兜底为“即我用户”；群通话优先组合已知参与人名称，否则使用“群通话（N人）”。
- 公共资料中的用户 ID 与签名头像 URL只在 Host 内参与投影；列表 DTO 不返回它们，也不新增头像读取。
- `call_media_type=0` 映射 `audio`，`1` 映射 `video`，其他值映射 `unknown`。
- 参与人数大于 2 时 direction 为 `group`；否则当前用户是主叫时为 `outgoing`，是被叫时为 `incoming`，其余为 `unknown`。
- `start_time`、`accept_time`、`end_time` 接受秒或毫秒并统一为 epoch 毫秒；开始时间缺失时回退到聚合 `sort_time_ms` 或 TRTC `create_at`。
- 明确的 `cancel/canceled/cancelled/reject/rejected/notanswer/noanswer/missed/callbusy/busy/offline` 结果视为未接通。否则 `accept_time > 0`、正时长或 `connected_user_ids` 非空任一成立即视为接通。
- 时长为 `max(0, endedAtMillis - (acceptedAtMillis || startedAtMillis))`。
- 摘要状态：`pending/processing -> processing`；`failed -> failed`；`done` 且 `call_summary` 非空时为 `ready`；其余为 `empty`。
- `summaryPreview` 来自查看者视角 `call_summary`，合并空白并按 Unicode code point 截断到 160 个字符，避免截断代理对。
- `has_more` 和 `next_cursor` 保持 Data 原始分页语义，即使本页过滤后为空也不改写。

### 详情 DTO

```ts
interface JotmoCallParticipant {
  displayName: string
  isSelf: boolean
  connected: boolean
}

interface JotmoCallTranscriptItem {
  itemId: string
  startOffsetMillis: number
  endOffsetMillis: number
  speakerLabel: string
  isSelf: boolean
  text: string
}

interface JotmoCallTextSection {
  state: JotmoCallSectionState
  content: string
  message: string
}

interface JotmoCallTranscriptSection {
  state: JotmoCallSectionState
  items: JotmoCallTranscriptItem[]
  message: string
}

interface JotmoCallDetail {
  callRef: string
  displayName: string
  participants: JotmoCallParticipant[]
  mediaType: JotmoCallMediaType
  direction: JotmoCallDirection
  connected: boolean
  startedAtMillis: number
  acceptedAtMillis: number
  endedAtMillis: number
  durationMillis: number
  summary: JotmoCallTextSection
  transcript: JotmoCallTranscriptSection
}
```

详情投影规则：

- `participant_profiles` 只用于生成 `displayName`、`isSelf` 和 `connected`；原始 user ID 不进入 DTO。
- 详情标题：一对一使用对方展示名；群通话组合最多两个非本人名称并附人数；资料缺失时使用与列表相同的兜底文案。
- AI 摘要只使用 WebRTC 已按查看者渲染的 `call_summary`。UI 以普通文本保留换行，不使用 `dangerouslySetInnerHTML`。
- 摘要状态由 `call_summary_status` 投影；`done` 但内容为空时为 `empty`。
- 转录只读取 `room_transcript_segments`；空文本片段丢弃。`start_ms/end_ms` 作为通话内相对毫秒，不转成 epoch 时间。
- 说话人名称优先级：当前用户为“我”；已绑定参与人为参与人展示名；匿名说话人使用 `inner_spk_remark`；最后使用“说话人 N”或“说话人”。
- `itemId` 由片段序号、时间边界和说话人标签确定性组合；不返回 `spk_id`、`inner_spk_id` 或 profile segment key。
- `call_transcription_progress.overall_status=processing` 时转录为 `processing`；`failed` 时为 `failed`；存在显示片段时为 `ready`；终态且无片段时为 `empty`。显式进度优先于录音切片内部状态。
- 元数据使用与列表相同的时间、方向、接通和时长规则。
- Host 明确剔除：`recording_url`、录音切片 URL、转录 `audio_url`、视频与截图 URL、对象 key、文件 ID/名称/大小、member actions、原始 user ID、TRTC account、`spk_id`、`inner_spk_id`、置信度、声纹与配额字段。

## callRef 与账号隔离

列表不把原始 room ID 当作公开标识。`JotmoService` 复用 `sourceRef` 的账号绑定和完整性保护模式：

```text
jotmo-call-v1.<base64url payload>.<HMAC-SHA256 signature>
```

payload 只包含 `version`、`userId`、`roomId`，签名密钥使用现有安装级 `uniqueCode`。`readCall()` 在联系 WebRTC 前验证：前缀、签名（timing-safe compare）、版本、当前账号 ID 和非空 room ID。篡改引用或跨账号复用在本地失败，且不发送远端请求。

`callRef` 是不透明的完整性令牌，不是加密或保密边界。Consumer 不得解析、构造或跨账号持久化它。

## 错误与并发

- Data、Auth、WebRTC 成功 envelope code 均按 `200` 处理。
- HTTP 401/403 触发一次短 Token 刷新和一次重放；再次失败沿用现有登录过期行为。
- 网络、超时、HTTP 错误、非法 JSON 和非成功业务码统一转为 `JotmoPluginError`，继续使用 Host API 的 `{ ok, value/error }` 响应。
- Data `items` 缺失或不是数组时按空页处理；合法的 `has_more/next_cursor` 仍保留。若 `has_more=true` 但 `next_cursor` 为空，则抛出 `call-list-contract-invalid`，避免 UI 进入无法继续的分页状态。
- WebRTC 详情返回的 `room_id` 必须与已验证 callRef 一致，否则抛出 `call-detail-contract-invalid`，不渲染内容。
- Auth 名称补全失败只降级显示名，不使 Data 列表失败；WebRTC 详情失败则只影响当前详情栏。
- React 列表与详情请求使用递增 generation；组件卸载、账号变化或选择变化后，旧 generation 的回调不得修改状态。

## v95 UI 与状态边界

- `JotmoUiState.mode` 从 `'login' | 'source'` 增加 `'calls'`；新增 `showCalls()`。进入 calls 时保留 `selectedSource`，便于返回来源会话；账号变化仍清除账号绑定选择。
- `JotmoNavigation` 在根目录插入“通话记录”行。只有 `mode === 'calls'` 时该行选中；来源行的选中判断增加 `mode === 'source'`，避免双选中。
- calls 模式不写 `navigation-cache`；现有目录、来源列表和最后选中来源缓存保持不变。
- `JotmoSurface` 在已登录且 `mode === 'calls'` 时渲染独立的 `JotmoCallHistorySurface`，不显示消息 header、时间线和 composer。
- `JotmoCallHistorySurface` 自身使用 `grid-template-columns: minmax(260px, 320px) minmax(0, 1fr)`。左栏独立滚动并分页；右栏独立滚动并展示概览、摘要和转录。
- 页面复用现有 CSS Token；“通话记录”入口使用 CSS/文本圆形标识，不引入新图片或私有 DSH UI API。
- `JotmoConversationSurface`、Footer 容器适配、官方 slot 注册和新会话监听无需改变。

## 文件边界

新增文件：

- `src/call-presentation.ts`：纯 Host 投影、时间/状态/名称归一化，不执行网络请求。
- `src/client/call-presentation.ts`：列表合并、日期、时长、媒体与状态文案等纯 UI helper。
- `src/client/JotmoCallHistorySurface.tsx`：双栏状态与渲染。
- `tests/call-presentation.test.ts`：Host 投影测试。
- `tests/client-call-presentation.test.ts`：纯 UI helper 测试。

修改文件：

- `src/types.ts`：call DTO、能力与操作。
- `src/jotmo-service.ts`：Data/WebRTC 请求、Auth 名称补全、callRef seal/open。
- `src/index.ts`：两个 Origin 配置、校验和类型导出。
- `cordis.patch.yml`：测试环境默认 Origin。
- `src/host-api.ts`：`calls.list` 与 `calls.detail` dispatch。
- `src/sdk/index.ts`：SDK 方法与类型导出。
- `src/client/ui-controller.ts`：calls 模式。
- `src/client/JotmoVirtualWorkspace.tsx`：Footer 入口与互斥选中态。
- `src/client/JotmoSidebar.tsx`：calls surface 分派。
- `README.md` 与 `docs/consumer-plugin-contract.md`：只读通话契约和隐私边界。
- `tests/jotmo-service.test.ts`、`tests/sdk.test.ts`、`tests/ui-controller.test.ts`：请求、SDK 与状态测试。

不修改 `jotmo-data`、`jotmo-webrtc` 或 `jotmo_frontend`；本功能只消费其现有契约。

## 测试策略

实现阶段遵循 red-green-refactor，每项生产行为先由聚焦测试产生预期失败，再写最小实现。

Host 纯投影测试：

- 混合聚合只保留 TRTC，坏项被丢弃，分页语义不变。
- 秒/毫秒归一化、方向、参与人数、接通、时长和摘要状态。
- 一对一/群通话名称补全与缺失资料兜底。
- 详情摘要/转录投影、说话人名称、处理/失败/空状态。
- 序列化结果不包含 room ID、user ID、媒体 URL、对象 key、声纹或文件字段。

Service 测试：

- `calls.list` 请求正确 Data Origin、Bearer、limit 和 opaque cursor。
- Auth 名称补全成功与失败降级。
- callRef 篡改和账号切换在发送 WebRTC 请求前失败。
- 有效详情只发送已验证 room ID，且 room mismatch 被拒绝。
- Data 和 WebRTC 401/403 各只刷新一次。

SDK 与 UI 测试：

- SDK 操作名、参数、signal 转发和空 ref 校验。
- calls 模式进入、来源互斥切换、登录重置和 surface 激活。
- 列表追加去重、时间/时长/媒体/接通/状态文案。
- 不新增 DOM 测试依赖；React JSX 由 TypeScript 构建覆盖，复杂逻辑留在纯 helper 中。

最终验证：

```sh
pnpm test
pnpm run typecheck
pnpm run build
git diff --check
```

现有 Provider、SDK、导航缓存、Footer 多插件布局、头像、Session/new-session 与官方 DSH slot 测试必须全部保持通过。
