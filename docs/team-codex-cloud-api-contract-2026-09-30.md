# Codex 工作动态云端完整接口草案 仅供后续参考

> 本草案已被 [云端同步首期后端交接](team-codex-cloud-sync-minimal-v1-2026-09-30.md) 的三个接口方案取代。保留本文件不代表要求同时实现设备证明、租约、独立授权、路由、迁移等接口；本轮不要依据下文旧 P0 清单排期。

日期：2026-09-30；契约版本提案 `work_activity.v1`。

配套：[业务规则与交接验收](team-codex-cloud-backend-handoff-2026-09-30.md)。**下文路径和字段均为待后端确认的建议，不表示线上可调用。** 现有 `/api/v1/teams/*` 复用，不重复建立团队系统。未说明处以主文档的严格隔离规则为准，不得以缺字段为由推断授权。

## 1. 通用约定

### 1.1 传输、身份和响应

- 建议全部使用 `POST /api/v1/work-activity/<operation>`，与现有 Arkme 能力网关风格一致，避免敏感筛选和引用进入 URL 日志。
- 所有云端请求使用当前 Arkme 登录主体的托管凭据 `Authorization: Bearer <managed credential>`；由 Host 管理，不传给网页、Hook 或复制指令。
- 上传额外需要 `X-Activity-Lease: <short-lived lease token>`。租约只能追加已授权数据，不能读取别人的正文、登记新目标或扩大分享。
- 对未知/不属于当前主体的资源统一返回 404；已验证属于本人但当前状态不允许的资源可返回明确 409/403。不得在错误中暴露另一个账号身份。
- TLS、现有服务端认证中间件、请求体限制和速率限制必须启用。Cookie 模式如被采用，须保留平台 CSRF 防护；Origin 不能替代认证。
- `user_ref` 由认证和服务端映射得到；事件写入不接受 `owner_user_ref`、`member_name`、`avatar` 等身份自报字段。
- ID 均为不透明字符串；已有 team/user ref 沿用平台格式。示例 ID 为说明性占位符，不是真实用户/设备数据，不用于签名验收。
- 时间使用 UTC RFC3339 字符串；源序号/计数使用非负安全整数；客户端时间不参与授权裁决。查询上限和保留期由 context 返回。
- 所有有副作用请求携带持久 `request_key`，作用域为认证主体＋操作，重试相同 key/相同内容返回同一结果；不同内容返回 409。事件另有永久 event_id 幂等约束，不能随 request_key TTL 消失。
- 状态修改使用 `expected_version` 乐观锁，过期返回 409 和当前可见版本；不能 last-write-wins 覆盖另一设备的暂停/撤销。

成功：

```json
{"code":200,"data":{"example":true},"request_id":"req_example"}
```

失败（HTTP 状态与业务一致，不一律 HTTP 200）：

```json
{"code":409,"error":{"code":"POLICY_EPOCH_STALE","message":"同步授权已变化，请重新确认","retryable":false,"retry_after_ms":null},"request_id":"req_example"}
```

### 1.2 稳定枚举

| 字段 | 值与含义 |
| --- | --- |
| `mode` | `local_only / private_cloud / team_shared`；个人云端与团队分享均需明确授权 |
| `kind` | `UserPromptSubmit / Stop / Interrupt`；不接受任意 role/tool/system 内容 |
| `task_state` | `waiting / working / turn_finished / interrupted / stale`，不是业务完成与否 |
| `binding_state` | `registered / active / paused / revoked` |
| `route_state` | `active / paused / revoked / membership_invalid` |
| `sync_state` | `synced / pending / blocked / partial / offline`，与 task_state 分开 |
| `scope.view` | `mine / team`；team 必须带一个 team_ref，mine 禁止带其他 owner |
| `coverage.state` | `complete / partial / unknown`；complete 仅针对已授权采集范围，不代表完整 Codex 历史 |

### 1.3 云端不得接收的元数据

禁止上传 `cwd`、完整 worktree 路径、`CODEX_HOME`、原 homeKey、Git credentials/remote URL、transcript_path、平台登录 token 和原始工具日志。`local_project_key` 是客户端新生成的账号/采集器范围不透明键，不直接使用可猜测本机路径的无盐散列。显示项目名、分支、设备别名需纳入云端授权说明。

本地需继续使用路径定位时，保留本地映射。正文中可能仍有敏感路径或凭据，采用客户端尽力脱敏＋服务端防护，不能因此宣称无敏感信息。

## 2. 接口索引和最小权限

`activity.*` 为建议能力名，后端可映射到现有 scope；不能用一个「全部团队管理员」权限替代。

| 操作（共同前缀省略） | 权限 | 请求要点 | 返回要点 |
| --- | --- | --- | --- |
| `context` | 本人读取 | 无 owner 参数 | current_user_ref、teams、membership、capabilities、limits |
| `collectors/challenge` | 本人设备登记 | 公钥/既有受信设备引用、collector_local_id | 短时一次性 proof challenge |
| `bindings/register` | 本人设备登记 | challenge、持有设备密钥的证明、设备别名、request_key | collector_ref、固定 owner 的 binding_ref、version；不默认开启上传 |
| `bindings/list` | 本人读取 | cursor、limit | 本人各设备连接、健康度、版本 |
| `bindings/control` | 本人控制 | binding_ref、pause/resume/revoke、expected_version | 新状态、binding_epoch、失效时间 |
| `bindings/lease` | 本人当前设备上传 | binding_ref、uploader_instance_id、设备证明、expected_epoch | 短期 lease、到期、策略摘要 |
| `projects/upsert` | 本人写元数据 | binding_ref、local_project_key、名称、可选既有 project_ref | owner 范围的 project_ref 与映射 |
| `projects/list` | 当前读取范围 | scope、cursor、query | ACL 过滤后的项目及计数 |
| `consents/prepare` | 本人授权 | 固定私有/团队范围、project/task、history、新任务策略 | consent_ref、计划散列、展示摘要、到期时间 |
| `consents/confirm` | 本人授权 | consent_ref、plan_hash、request_key | consent_version、绑定的可执行授权结果 |
| `routes/set` | 本人路由配置 | binding_ref、project_ref 或默认规则、consent_ref、expected_version | route_ref、policy_epoch、明确目标 |
| `routes/list` | 本人配置读取 | binding_ref | 私有默认、项目规则、排除和冲突 |
| `routes/control` | 本人控制 | route_ref、pause/resume/revoke、expected_version | 新版本和 policy_epoch |
| `tasks/register` | 本人当前设备上传 | binding、route、project、source_task_key、source session key、lease | task_ref、固定归属、首次同步边界 |
| `tasks/control` | 本人控制 | task_ref、exclude/include/delete、expected_version | 状态、task_epoch 或 tombstone |
| `events/batch` | 本人当前设备上传 | 固定任务授权＋最多 100 个事件 | 每条 accepted/duplicate/rejected、持久 ACK |
| `summary` | ACL 范围读取 | scope | 成员/项目/任务数、状态与覆盖信息 |
| `members/list` | 团队有效成员 | team_ref、cursor、query | 有权限的成员及工作动态摘要 |
| `tasks/list` | ACL 范围读取 | scope、member/project/device、状态、query、cursor | 按权限筛选分页，稳定排序 |
| `events/list` | ACL 范围读取 | scope、task_ref、cursor、limit | 输入/回答分页、授权版本、coverage |
| `changes` | ACL 范围读取 | scope、change_cursor、limit | upsert/remove/invalidate 及新游标，不带正文 |
| `shares/revoke` | 作者或团队管理者隐藏权限 | grant_ref、expected_version、request_key | 团队授权撤销及变更序号，私有正文保留 |
| `imports/prepare` | 本人明确历史迁移 | 已在本地选定的最小 manifest、目标 | import_ref、计划摘要、计划散列；不接收正文 |
| `imports/commit` | 本人历史迁移授权 | import_ref、confirmed consent_ref、manifest_hash | 允许上传的冻结范围及到期时间 |
| `imports/batch` | 本人当前设备历史上传 | import_ref、lease、固定 manifest 中的事件 | 逐条 ACK，不扩范围 |
| `imports/status` | 本人读取 | import_ref | 已接收/拒绝/待传/完成、可重试边界 |

团队历史分享已有云端私有内容不必重新上传正文：使用 `consents/prepare/confirm` 的 `share_history` 操作产生固定事件范围 grant。首期不把该 grant 变成未来自动分享规则，也不允许同任务共享给第二个团队。

## 3. 上下文和设备登记

### `context`

请求 `{}`。核心响应示例：

```json
{
  "current_user_ref":"usr_v1_exampleA",
  "profile":{"display_name":"示例用户","avatar_ref":"avatar_example"},
  "teams":[{"team_ref":"team_v1_exampleAlpha","name":"团队甲","membership_ref":"membership_alpha_A","membership_epoch":8,"role":"member","can_share_activity":true,"can_view_activity":true}],
  "capabilities":{"cloud_sync":true,"team_share":true,"history_import":true,"push":false,"protocol_versions":[1]},
  "limits":{"max_batch_events":100,"max_request_bytes":1048576,"max_text_bytes":262144,"max_page_size":100,"lease_ttl_seconds":120,"outbox_max_bytes":104857600,"outbox_max_age_seconds":604800},
  "retention":{"state":"configured","body_retention_days":90,"backup_purge_max_days":30},
  "quota":{"state":"available","used_bytes":0,"limit_bytes":1073741824},
  "policy_version":1,
  "server_time":"2026-09-30T10:00:00Z"
}
```

示例中的 90 天、30 天、1 GiB 只是演示值，**不是已确定的定价/保留承诺**；后端须返回经产品确认的真实配置。未知额度返回 null＋state，不能冒充 0 或 unlimited。team 列表需分页或复用现有团队分页，不能在账号团队多时静默截断；当前成员身份直接返回，不让客户端遍历全体成员猜本人。

### `collectors/challenge` / `bindings/register`

目的：证明是同一个本机采集器，而不是任意客户端提交了别人的 collector_local_id。优先复用 Arkme 既有设备持有证明；若没有，需要新增标准设备公钥登记与短期 challenge-response，私钥存在系统安全存储。算法、签名载荷、nonce TTL 和重放规则须由后端安全实现给出，不能只验证一个自报 UUID。

Challenge 至少绑定：当前主体、环境、用途 `register_activity_binding`、collector_local_id、公钥指纹、到期和单次消费标识。建议 5 分钟有效。注册失败重试不得创建多个有效绑定；请求幂等。

Register 请求/结果字段：

```json
{"request_key":"register-example-1","challenge_ref":"challenge_example","collector_local_id":"11111111-1111-4111-8111-111111111111","device_name":"我的工作电脑","client_version":"example","proof":{"method":"platform_device_proof","value":"<Host 提交的设备证明>"}}
```

```json
{"collector_ref":"collector_example","binding_ref":"binding_A_1","owner_user_ref":"usr_v1_exampleA","binding_state":"registered","binding_epoch":1,"version":1,"cloud_enabled":false}
```

同一个 collector 可以保留多个账号的非活动 binding，但同一时刻仅一个活动上传账号。取得 B 的绑定不能改写 A 的任务 owner；源任务冲突需拒绝。新电脑登录查看不调用登记接口。

### `bindings/lease` / `bindings/control`

```json
{"request_key":"lease-example-1","binding_ref":"binding_A_1","uploader_instance_id":"22222222-2222-4222-8222-222222222222","expected_epoch":3,"proof":{"method":"platform_device_proof","value":"<Host 提交的设备证明>"}}
```

返回 `lease_token/expires_at/renew_after_ms/binding_epoch/policy_version`。token 只留 Host 内存或平台安全凭据容器，不写普通队列。恢复网络可以换 token，但旧事件的 owner/route/epoch 不能换。

续租是新的逻辑操作，使用新 request_key；仅重试同一次续租才沿用原 key。所有 challenge/lease 请求同样遵守幂等约定，避免重试无意创建多个活动采集实例。

租约同绑定单实例独占；另一运行时返回 `UPLOADER_CONFLICT`，不能自动踢掉当前实例。明确接管须本人确认并轮换 epoch。租约失效但账号未变时，更新租约可以传原队列；授权 epoch 已变则不能。

Control 请求：`{binding_ref, action:"pause"|"resume"|"revoke", expected_version, request_key}`。暂停/撤销在同事务递增 epoch 并使旧租约失效，且生成 invalidation。resume 不能恢复已经 revoked 的绑定，须重新授权。远程管理同账号设备允许；不能替其他成员操作。

## 4. 项目、授权与不可变路由

### `projects/upsert`

请求：`{binding_ref, local_project_key, name, existing_project_ref?, expected_version?, request_key}`。服务端 owner 来自认证主体。没有 existing_project_ref 时按 `(collector_ref, local_project_key)` 幂等登记；有则检查 project 属于本人，再做显式映射。只改显示名不改变所属团队。

同一 Git 仓库不同 worktree 在本机共用 local_project_key；服务器不能据此推断其他电脑或其他成员的同名仓库。项目在不同成员名下分别展示，即使名称完全相同。

### `consents/prepare`

必须从用户主动操作进入，禁止轮询或插件升级自动调用以开启分享。准备阶段无正文上传、无启用副作用，返回确认计划。

```json
{
  "request_key":"prepare-team-alpha-1",
  "operation":"enable_future_sync",
  "binding_ref":"binding_A_1",
  "selection":{"type":"project_new_tasks","project_ref":"project_example"},
  "destination":{"visibility":"team","team_ref":"team_v1_exampleAlpha"},
  "event_kinds":["UserPromptSubmit","Stop","Interrupt"],
  "include_history":false,
  "policy_version":1
}
```

可选操作：

- `enable_future_sync`：selection 为 `default_private_new_tasks` 或 `project_new_tasks`。全局默认仅支持 private；禁止团队通配符、全部团队和隐含当前选中团队。
- `share_history`：selection 为已存在的一个 task_ref 与固定 `through_event_seq` 或 event_id 清单，目标一个 team_ref；授权前预览真实范围。不能包含后续新增事件。
- `import_local_history`：引用服务端已准备的 import_ref，不能在 confirm 时换清单或目标。

Private destination 只有 `{"visibility":"private"}`，带 team_ref 应拒绝；Team destination 必须带唯一 team_ref。上述准备结果示例：

```json
{
  "consent_ref":"consent_example",
  "owner_user_ref":"usr_v1_exampleA",
  "plan_hash":"sha256-of-immutable-plan",
  "expires_at":"2026-09-30T10:05:00Z",
  "summary":{"account_name":"示例用户","device_name":"我的工作电脑","project_name":"示例项目","team_name":"团队甲","audience":"current_and_future_active_team_members","include_history":false,"applies_to":"new_tasks_only"},
  "membership_epoch":8,
  "policy_version":1,
  "state":"awaiting_confirmation"
}
```

### `consents/confirm`

请求 `{consent_ref, plan_hash, request_key}`；以当前身份重新验证成员资格、项目/绑定 owner、policy_version 和 plan 到期。摘要已变、切号、退组或目标变化均拒绝，要求重新 prepare。返回 `state:"confirmed", consent_version, confirmed_at, resulting_grant_ref?`。

只有这一步后的授权可用于 routes/set 或 imports/commit；event API 不能自己产生授权。后端记录操作人和批准范围，页面仍须让用户实际确认，普通 `confirmed:true` 标记不等于已经完成产品授权流程。

### `routes/set` / `routes/list` / `routes/control`

```json
{"binding_ref":"binding_A_1","selector":{"type":"project_new_tasks","project_ref":"project_example"},"consent_ref":"consent_example","consent_version":1,"expected_version":0,"request_key":"route-alpha-1"}
```

```json
{"route_ref":"route_alpha","rule_version":1,"policy_epoch":1,"task_destination":{"visibility":"team","team_ref":"team_v1_exampleAlpha"},"applies_to":"new_tasks_only","state":"active"}
```

`expected_version` 对应 selector 的规则版本，0 表示尚不存在。修改目标创建新 route 并替换「新任务默认规则」，不能原地修改旧 route 的 team_ref；旧任务仍引用旧 route。旧 route 是否继续采集需单独 pause/revoke，不能将其内容搬到新目标。

List 返回私有默认、每项目规则、version、route_ref、effective destination、排除状态和冲突。后台/页面不得靠「当前团队页」维护路由。

Control 请求 `{route_ref,action:"pause"|"resume"|"revoke",expected_version,request_key}`，轮换 policy_epoch。排除某项目时包括后续新任务；可复用项目规则的 `excluded` 控制，但必须返回实际生效状态。新 `routes/set` 不得偷偷解除排除，应单独明确恢复。

团队成员资格变化或路由暂停时，不自动改为另一团队；可保留本机内容。若需要继续本人私有云端，须有独立有效私有授权，并且不能把旧队列重新套入新路由。

## 5. 任务登记与控制

### `tasks/register`

要在上报正文前建立归属。本机已维护 `(collector, source_task_key) → owner/route`，服务端再做一次权威唯一校验。

```json
{
  "request_key":"register-task-1",
  "binding_ref":"binding_A_1",
  "route_ref":"route_alpha",
  "policy_epoch":1,
  "project_ref":"project_example",
  "source_task_key":"33333333-3333-4333-8333-333333333333",
  "source_session_key":"opaque-persistent-local-session-key",
  "source_origin":"new_verified",
  "source_start_seq":401,
  "title":"示例任务",
  "branch":"feature/example"
}
```

返回 `task_ref,owner_user_ref,project_ref,route_ref,policy_epoch,task_epoch,version,task_state,allowed_event_kinds,grant_ref?`。来源 session key 应为本机持久随机映射，原 Codex session ID 本机保存，不通过更换此键绕过账号锁定。

目标为 team 时，在任务登记事务内从已确认 route 产生该任务的未来事件 grant，记录作者/查看团队/作者 membership_epoch/metadata 范围；私有任务不产生团队 grant。首次正文写入不得凭 team_ref 自建授权。本人任务管理响应需返回 grant_ref 与 available_actions 供明确撤销；普通团队阅读不暴露管理 token。

登记校验：

- 认证 owner、binding 和租约一致；project 是本人已确认映射；route 授权匹配该 project/selector。
- source_task_key 在 collector 内从未被其他账号认领；命中时通用 `SOURCE_OWNER_CONFLICT`，不回传原账号信息。
- 已登记同源任务仅返回原 task 和路由；请求不同团队/账号不做更新，返回 `TASK_DESTINATION_LOCKED`。
- 无明确路由的任务返回 `ROUTE_REQUIRED`，前端应保持本地或使用已授权私有规则；后端不填默认团队。
- 从旧的本地任务转新云端时，先登记迁移来源信息。已存在会话不是「新任务」，不能套用新团队项目规则自动公开。
- 不允许把其他账号的源任务清空归属后重新登记；软删仍保留最小归属/tombstone。

`source_origin=new_verified|existing|unknown` 表示采集器依据可验证生命周期信息作出的分类，不能用「第一次见到 session」替代。它不是授权凭证，仍需 owner/设备证明/consent/route 的全部检查。existing/unknown 不允许自动命中 project_new_tasks 的团队规则；应返回 SOURCE_ORIGIN_REVIEW_REQUIRED，按主文档先私有或本地、再由本人确认适用范围。实现前必须给出生命周期判断的真实测试证据，不能仅添加一个默认 true 字段。现有本地版尚未具备这一新增分类。

### `tasks/control`

请求 `{task_ref,action:"exclude"|"include"|"delete",expected_version,request_key}`。

- exclude：停止新采集/上传，原云端数据保留，轮换 task_epoch。
- include：本人确认恢复，仅新事件进入，新 task_epoch 生效。不能恢复 revoked route，不补传旧 epoch 队列。
- delete：用户确认后删除该任务本人云端正文及对应分享投影，生成 tombstone/change；不能删除 Codex 原任务或自动删除本地原文。返回 `deleted_at,purge_state,purge_deadline,tombstone_ref`。
- 删除与「仅撤销团队可见」必须在产品上分开。正文删除后任务引用若仍需保留，只返回不含标题/预览/分支的 tombstone。

## 6. 事件批量上传及幂等

### `events/batch`

请求固定一个 binding，事件可属于该绑定下不同任务。初始最大 100 条/1 MiB；授权版本/归属逐条检查，外层认证或租约无效则整批失败且零写入。

```json
{
  "schema_version":1,
  "request_key":"batch-example-1",
  "binding_ref":"binding_A_1",
  "binding_epoch":3,
  "items":[
    {
      "event_id":"44444444-4444-4444-8444-444444444444",
      "task_ref":"task_example",
      "task_epoch":1,
      "route_ref":"route_alpha",
      "policy_epoch":1,
      "source_seq":401,
      "source_turn_key":"turn-example-1",
      "turn_order":1,
      "kind":"UserPromptSubmit",
      "occurred_at":"2026-09-30T10:00:01Z",
      "text":"请修复示例组件的布局。",
      "truncated":false,
      "redaction_version":1,
      "content_hash":"<SHA-256 of canonical immutable event payload>"
    }
  ]
}
```

字段语义：

| 字段 | 约束 |
| --- | --- |
| event_id | 捕获时生成并落盘 UUID；重试/导入相同记录沿用，不能每次生成 |
| task_ref/route_ref/epochs | 捕获时固定，不因重连/账号切换而重写；server 拒绝任何不匹配 |
| source_seq | 每 collector 持久单调增长；允许因排除/丢失出现空洞，不把连续性当完整性证明 |
| source_turn_key/turn_order | 同 task 内稳定标识和递增轮次顺序；同 turn 的输入/Stop/Interrupt 共用，不由上传到达顺序生成 |
| kind/text | 输入来自 prompt，Stop 来自 last_assistant_message，Interrupt 文本为空；未知 kind 拒绝 |
| occurred_at | 事件在设备捕获的时间，服务端另存 received_at；不信任它判断是否已获授权 |
| truncated | 源端已截断则 true，不能跨端变 false；空 Stop 可保留终止状态但不造回答 |
| redaction_version | 已执行的文本脱敏规则版本，不代表没有敏感内容 |
| content_hash | 服务端重新计算，覆盖所有不可变事件字段，不含 content_hash 本身及外层传输认证；双方固定 canonical JSON 编码规则/测试向量后开发，禁止只按正文做 hash |

同 collector 下 `source_seq` 对应一个持久事件，重用序号配不同 event_id/payload 返回冲突。相同 task/turn/kind 但不同 ID 命中逻辑槽位：内容一致返回原记录 duplicate，差异返回 EVENT_SLOT_CONFLICT；不能 last-write-wins。首期真实多次 Stop 修订的差异保留本地待处理，coverage 为 partial，不虚报完整。

源端的任务标题只作展示，不是命令/授权；无标题可由服务端用首个获授权输入生成有长度限制的纯文本预览。禁止以标题与正文相同来去重任务。

成功的逐条响应示例：

```json
{
  "results":[
    {"event_id":"44444444-4444-4444-8444-444444444444","status":"accepted","event_ref":"event_example","event_seq":920,"change_seq":1208},
    {"event_id":"55555555-5555-4555-8555-555555555555","status":"duplicate","event_ref":"event_existing","event_seq":919,"change_seq":1207},
    {"event_id":"66666666-6666-4666-8666-666666666666","status":"rejected","error":{"code":"POLICY_EPOCH_STALE","retryable":false}}
  ],
  "server_time":"2026-09-30T10:00:05Z"
}
```

示例响应演示三种结果，实际 results 必须与请求 items 一一对应。只有 accepted/duplicate 可从待上传队列确认完成；拒绝保持原因及本地原文，不把最后一个成功序号当作整批都 ACK。event_seq/change_seq 是服务端 opaque 序列意义，不必连续，客户端读取仍使用服务端签发的 cursor。

批次单项权限失败可部分成功；但每个项目的授权判断必须与该项落库同一事务边界。已删除或撤销资源不可为了给 duplicate 成功而跳过 tombstone/ACL 检查。

## 7. 跨端读取、成员分组与增量

### 7.1 统一读取 scope

本人：`{"view":"mine"}`。团队：`{"view":"team","team_ref":"team_v1_exampleAlpha"}`。

所有 summary/projects/tasks/events/search/changes 复用 scope。mine 永远是当前主体；团队视图由服务端核对当前成员资格、作者分享有效性及团队状态。客户端不能用 `view:mine, user_ref:other` 越权。团队中的 member_user_ref 只是权限范围内的筛选，不是授权。

通用分页：`limit` 默认 50、最多 100，服务端返回 `next_cursor,has_more,snapshot_ref,acl_version`；cursor 不透明，绑定认证主体、scope、ACL epoch、筛选、排序和快照。不能跨账号/团队/筛选复用。

### `summary` / `members/list` / `projects/list`

- summary：返回可见的 `member_count/project_count/task_count/working_count/last_activity_at`、coverage、updated_at、change_cursor、acl_version。未建好投影返回 state building/unknown，不能把未知计数置 0。
- members/list：`{team_ref,query?,limit?,cursor?}`；包括 user_ref、display_name、avatar_ref、membership_state、可见任务数、最后活动和 `activity_state=not_connected|no_shared_activity|has_activity`。从团队现有成员目录出发，尚未分享的成员也可显示，但不能借状态披露其私人任务数量。
- projects/list：`{scope,member_user_ref?,query?,limit?,cursor?}`；按 owner+project 分组，返回 project_ref、name、owner 投影、visible_task_count、last_activity_at。默认不可读取绝对路径。
- 不要统计私有任务再在前端减掉；归组、总数和正文可见范围必须一致。

### `tasks/list`

```json
{"scope":{"view":"team","team_ref":"team_v1_exampleAlpha"},"member_user_ref":"usr_v1_exampleA","project_ref":"project_example","query":"布局","state":"all","sort":"recent","limit":50}
```

```json
{
  "items":[{
    "task_ref":"task_example",
    "owner":{"user_ref":"usr_v1_exampleA","display_name":"示例用户","avatar_ref":"avatar_example"},
    "project":{"project_ref":"project_example","name":"示例项目"},
    "device":{"device_name":"我的工作电脑"},
    "title":"示例任务","branch":"feature/example",
    "task_state":"turn_finished","sync_state":"synced",
    "last_activity_at":"2026-09-30T10:01:00Z",
    "visible_event_count":2,
    "preview":"已完成本轮修改和检查。",
    "coverage":{"state":"complete","basis":"authorized_capture_range","reasons":[]},
    "version":2
  }],
  "has_more":false,"next_cursor":null,"snapshot_ref":"snapshot_example","acl_version":12,"change_cursor":"cursor_example"
}
```

只分享局部历史的任务，其 preview、计数、活动时间和状态都从可见事件范围生成，不能泄露范围外正文/题目。为这类 grant 单独保存经确认的 title/project 别名，不能直接复用含私有内容的原标题。项目/设备/分支信息也必须在确认的 metadata 范围内；未授权时省略，不用补全接口绕过。

recent 稳定排序为 `last_visible_activity_seq DESC, task_ref ASC`；新增活动可使任务前移，但同一分页快照不能重复/漏项。首次加载 snapshot 与 change_cursor 要有一致边界：快照建立后产生的变化由 changes 补齐。搜索首期支持可见任务标题/项目/分支/成员名，不宣称全正文搜索；若后续加全文索引也必须使用同一 ACL。

### `events/list`

请求 `{scope,task_ref,limit?,cursor?}`。首次返回最近 50 条，页内按任务轮次与阶段正序展示；next_cursor 向历史翻页。建议语义顺序 `turn_order ASC, kind(UserPromptSubmit→Interrupt→Stop), event_seq ASC`，保留发生/接收时间；不把迟到输入显示在本轮回答之后。

每条返回 `event_ref,event_id,turn_key,turn_order,kind,text,occurred_at,received_at,truncated,event_seq`，以及当前页 `has_more,next_cursor,coverage,acl_version,task_version`。按需加载，不在整个团队入口返回所有正文。主账号视图可见全任务，团队视图只见 grant 允许的事件。

### `changes`

```json
{"scope":{"view":"team","team_ref":"team_v1_exampleAlpha"},"change_cursor":"cursor_example","limit":100}
```

```json
{"items":[{"kind":"task_upsert","task_ref":"task_example","version":3},{"kind":"task_remove","task_ref":"task_removed"},{"kind":"scope_invalidate","reason":"acl_changed"}],"has_more":false,"next_cursor":"cursor_example_next","acl_version":13}
```

- 只返回当前有权限的更新及该主体曾获授权缓存所需的移除/失效信号，不附正文、全局隐藏计数或另一团队引用。
- ACL 变化后，旧游标不得继续获取数据；首期统一 409 `ACL_CHANGED` 并要求清空受影响团队缓存、重建快照。上面 scope_invalidate 示例用于权限仍有效但投影需重建，不作为已失权读者继续读取的通道。不能以 cursor 本身授权。
- 游标过期返回 410 `CURSOR_EXPIRED`，允许重建列表快照；客户端合并已缓存任务，不显示为所有记录都新产生。
- 团队离线页面不继续展示已缓存正文，恢复在线先验当前权限；本人私有缓存可按现有账号安全存储策略保留。
- 首期建议前台 3–5 秒、后台 30 秒轮询变化元数据，隐藏页面不拉正文；实际间隔服从后端 retry_after_ms。
- SSE/WebSocket 为 P1，只推变更引用，按连接身份及最新 ACL 发出；重连依靠 changes 补齐，推送不能取代持久游标。

## 8. 分享撤销与历史导入

### `shares/revoke`

请求 `{grant_ref,expected_version,request_key}`；作者可撤销本人分享，团队管理者可隐藏该团队中的分享。返回 `state:revoked,effective_at,version,change_cursor`，只取消团队可见性，不删本人私有正文。

对于未来自动团队路由，撤销须同时冻结该 grant 的后续团队投递并使相关 policy_epoch 失效；不能撤销后下一条新事件又创建同等授权。重新分享需新 consent，且不得为同任务切换到另一个团队。团队管理者隐藏不能修改作者个人采集配置。

### `imports/prepare`

只用于用户主动选择的本地历史。无云端授权时不自动调用，也不扫描 Codex 原始历史文件。本地升级保留 journal.sqlite 与独立迁移映射。

```json
{
  "request_key":"prepare-import-1",
  "binding_ref":"binding_A_1",
  "source_namespace":"77777777-7777-4777-8777-777777777777",
  "destination":{"visibility":"private"},
  "manifest_hash":"sha256-of-frozen-manifest",
  "event_count":2,
  "task_count":1,
  "range":{"from":"2026-09-29T09:00:00Z","to":"2026-09-29T09:05:00Z"},
  "items":[
    {"event_id":"88888888-8888-4888-8888-888888888888","source_task_key":"source-task-example","source_record_key":"local-row-101","source_payload_hash":"sha256-source-payload-1"},
    {"event_id":"99999999-9999-4999-8999-999999999999","source_task_key":"source-task-example","source_record_key":"local-row-102","source_payload_hash":"sha256-source-payload-2"}
  ]
}
```

manifest 不含正文、原标题、cwd 或仓库地址。单页最多 100 条，大清单支持 `manifest_part_index/manifest_part_count` 分段；所有部分到齐且服务端重算总 manifest hash 前不能确认。计数、范围与原始记录映射仍可能敏感，上传前本地确认会传这些元数据。

返回 `import_ref,state:prepared,manifest_hash,event_count,existing_count,tombstoned_count,requires_identity_resolution,expires_at`。原记录账号不能可靠映射到当前 user_ref 时直接阻断，不凭同昵称/头像判定本人。

### `imports/commit` / `imports/batch` / `imports/status`

1. prepare 完成后用 `consents/prepare` 的 import_local_history，引用该 import_ref 展示账号/目标/条数；用户 confirm 得到固定 consent。
2. commit 请求 `{import_ref,manifest_hash,consent_ref,consent_version,request_key}`。服务器重验 owner、团队资格和版本，返回 committed、导入授权截止、需要的 source→task_ref 映射或可分页取得的映射引用。
3. batch 只能上传冻结 manifest 内事件。使用 events/batch 相同正文限制和逐条 ACK，但加 import_ref/source_record_key；首次从源记录到 task_ref/route/epoch 的转换写入持久映射，重试不可重新分配 ID 或改变目标。源 hash 与云端 payload hash 分开，服务端都需验证。
4. 已在云端存在的原事件，只校验映射/正文一致后返回 duplicate；不重复创建正文，不原地改 owner/route。如果新增团队历史授权，通过独立 grant 完成，不改写原事件 payload。
5. status 返回 `state:prepared|committed|uploading|completed|blocked|expired`、`accepted/duplicate/rejected/pending/tombstoned` 计数和分页失败列表；不把客户端请求结束当完成。只有 manifest 所有条目有明确终态才 completed，部分拒绝时 completed 仍带 coverage partial。
6. 建议准备计划 24 小时有效、已确认导入 7 天有效；实际服务端下发。到期停止接收新正文，重新确认沿用原 source/event 映射，防止重复；旧 team 权限不能续用。
7. 私有导入完成后要分享给团队，另走 share_history；不以「原本地 team_ref 相同」自动产生 grant。

## 9. 必需错误码与客户端动作

| HTTP | error.code | retryable | 客户端动作 |
| --- | --- | --- | --- |
| 401 | AUTH_REQUIRED / AUTH_EXPIRED | false | 暂停请求，当前账号重新认证；不切换别人的凭据重试 |
| 403 | CAPABILITY_DISABLED / SCOPE_DENIED | false | 保持本地，提示未开通/未授权 |
| 403 | MEMBERSHIP_REVOKED / TEAM_UNAVAILABLE | false | 停止该团队投递、清缓存；不得选其他团队兜底 |
| 404 | RESOURCE_NOT_FOUND | false | 不存在或不可访问，不披露 owner |
| 409 | ACCOUNT_BINDING_MISMATCH / SOURCE_OWNER_CONFLICT | false | 切号防护，隔离原队列；要求原账号或新建源任务 |
| 409 | UPLOADER_CONFLICT | false | 显示另一个采集实例，只有明确接管才能轮换租约 |
| 409 | CONSENT_REQUIRED / CONSENT_PLAN_CHANGED | false | 重做 prepare/用户确认，不自动点同意 |
| 409 | VERSION_CONFLICT / POLICY_EPOCH_STALE / TASK_EPOCH_STALE / BINDING_EPOCH_STALE | false | 拉状态，原队列本地待处理，不重贴新版本 |
| 409 | ROUTE_REQUIRED / ROUTE_CONFLICT / TASK_DESTINATION_LOCKED | false | 选择明确目标或新任务，不猜团队 |
| 409 | SOURCE_ORIGIN_REVIEW_REQUIRED | false | 未确认的新/旧会话归属，先保持本地或既有私有范围，不默认分享到团队 |
| 409 | EVENT_ID_CONFLICT / EVENT_SLOT_CONFLICT / SOURCE_SEQUENCE_CONFLICT | false | 保留本地差异，提示覆盖不完整，不覆盖云端 |
| 409 | ACL_CHANGED | false | 清对应 scope 缓存并重建授权快照 |
| 410 | CURSOR_EXPIRED | false | 重建列表快照；不代表数据都被删 |
| 410 | CONSENT_EXPIRED / IMPORT_EXPIRED / LEASE_EXPIRED | false | 分别重新确认/续期/取租约，不能用统一重试逻辑扩大授权 |
| 410 | RECORD_DELETED / BINDING_REVOKED | false | tombstone/撤销阻断重传，不自动复活 |
| 413 | PAYLOAD_TOO_LARGE | false | 拆批；单条过大保留本地并明确截断/失败，不静默 ACK |
| 422 | INVALID_EVENT / INVALID_PROOF / MANIFEST_MISMATCH | false | 修正协议或重新登记；不保存无效正文 |
| 429 | RATE_LIMITED | true | 服从 retry_after_ms，加抖动退避 |
| 429 | QUOTA_EXCEEDED | false | 暂停云端新增队列并提示额度，保留本地；不是快速重试 |
| 503 | TEMPORARILY_UNAVAILABLE | true | outbox 保留，指数退避，原 owner/route 不变 |

团队资格或 ACL 拒绝必须优先于是否存在/是否重复的细节回执，防止探测隐藏任务。生产日志可使用 request_id 查明原因，不把正文写进错误响应。

## 10. 时序验收及一致性测试向量

### 正常跨设备

```text
A 端登录 U → context → 登记 collector/binding（仍关闭）
→ 用户确认个人云端/指定项目团队范围 → routes/set
→ lease → task register → 本地捕获固定归属 event → batch ACK
B 端登录 U → mine snapshot → changes → task events
同事 V 登录 → 验证团队成员资格 → team snapshot → 获授权事件
```

### 切号并发与延迟队列

```text
捕获 E(owner=U, route=甲, epoch=3) → 本地 outbox
U 切到 V → 本机先 fence → 云端 epoch=4/原租约撤销
旧请求 E 到达：若撤销已提交，拒绝；若此前已提交，只存在 U/甲
V 的凭据提交 E：拒绝，不能重写成 V/乙
切回 U：明确恢复，旧 E 仍 epoch=3，不能重新贴 epoch=5 自动发送
```

### 修改新任务默认团队

```text
任务 X → route 甲（固定）
项目新任务规则改为乙 → 新 route 乙
X 的后续事件仍只允许 route 甲；新任务 Y 才允许 route 乙
项目改名/同仓库另一个 worktree/浏览乙团队：都不改 X 的 route
```

联调除主文档 A01–A25，还需机器测试：

1. 同 event_id 同 payload 连续/并行/ACK 丢失重试，只一条事件、一次计数、一个变更版本；不同 payload 明确 409。
2. 批次第 2 项拒绝、其他项成功，重试只确认成功 ID，不因最大序号覆盖失败项。
3. Stop 的 turn_order=7 先到，后到 turn 7 的输入仍是 turn_finished；turn 8 输入才 working；不会根据 received_at 简单取最后一条。
4. 普通终端换行、中文 emoji、空 Stop、含 HTML/链接/密钥样式、超过字节上限等 payload；验证大小、转义和 hash 编码一致。
5. 读取快照中有新事件/删除/退组，snapshot＋changes 不漏变更；失权时连计数和 preview 都不可见。
6. 固定 manifest 导入后删除，再上传原事件或另一批次同源记录，都命中 tombstone。
7. 所有请求伪造 user/team/task/project/binding/route/lease/cursor 的交叉组合，鉴权不能只做其中一项。
8. 服务重启、数据库重启、上传器崩溃、两上传器抢租约、客户端时间倒退；不重复、不串号、不把 stale 当完成。

## 11. 后端回包检查表

- [ ] 最终接口清单与示例覆盖以上 P0 语义；未支持项显式 capabilities=false。
- [ ] 设备证明机制、上传租约和最小 scope 已有明确实现，不用 UUID/Origin/昵称冒充授权。
- [ ] canonical payload 编码/hash 测试向量、源序号/turn_order 生成约定、分页方向和排序已确认。
- [ ] 身份映射、成员 epoch、作者离队及查看者离队的失效路径已联调。
- [ ] 新任务/旧任务/历史 grant 三种范围明确，路由不可变且账号不能被改写。
- [ ] 返回真实性和边界明确：synced ≠ Codex 全历史完整，turn_finished ≠ 开发完成。
- [ ] 真实 limits/quota/retention、灰度环境、请求 ID 定位、错误码和撤销竞态测试有结果。
- [ ] 前端仍需对接，现有 localOnly 不会因服务部署自动改为 cloud。
