# 手动导入录音：批次完成通知与自动更新日总结、时间轴

日期：2026-10-13。适用：Arkme 插件手动「导入历史音频」。

## 交付状态与分工

插件已准备批次关联、任务重启恢复、通知列表/未读/分页/已读、按日期查看录音和具体总结/时间轴版本的前端及 Host 适配。以下 HTTP 接口、字段扩展均为**提议的 v1 合同，待后端确认、开发、部署与联调**，不代表现网已有这些能力。本次没有修改、部署 Audio/Record 云端，也没有在真实账号触发上传或自动模型生成。

后端应先提供测试环境并通过文末验收，最后才令 capabilities 返回 supported:true。不支持时保留原有上传，插件不制造本地完成通知，不由浏览器调用生成接口替代后台调度。所有 HTTP 调用使用现有 authenticatedAudioPost，鉴权在 Host 完成，不把访问令牌交给浏览器。

## 已确认产品流程

1. 用户一次点击「导入」提交的所选文件构成一个固定批次；之后再点导入是新批次。
2. 本批所有文件在云端完成必要的解析、人声/说话人处理与转写，且转写已可读，持久化第一条「录音处理完成」通知，进入对话板块的总通知。
3. 第一条通知写入成功后，按本批文件实际覆盖的录音日期自动生成/更新总结和时间轴。**不需要用户打开通知，不等待推送送达或已读。**
4. 总结和时间轴的新版本全部落库并可读取后，持久化第二条「录音总结与时间轴已更新」通知。多个日期合并到这条通知，详情按天给查看入口。
5. 已有当日内容结合当日全部可用转写生成新版本，保留历史；不是只总结新文件，也不是按上传日期更新。
6. 失败、取消、额度暂停、无有效人声/转写不能误报完整成功。部分结果分别显示；成功的项目可查看，失败项目由后端自动重试或沿用现有手动重试流程。

## 批次关联：扩展现有 Audio new-session

现有 `POST /api/v1/audio/new-session` 在手动导入时可新增：

```json
{
  "source": 2,
  "recording_kind": 3,
  "operate_at": 1791849600000,
  "orig_name": "会议.wav",
  "tz_offset": 28800000,
  "start_at": 1791504000000,
  "import_batch": {
    "batch_id": "由客户端生成的UUID",
    "item_index": 0,
    "item_count": 12,
    "time_zone": "Asia/Shanghai"
  }
}
```

- `batch_id` 标识一次提交；唯一键必须含鉴权账号，不能仅靠客户端 UUID 作为访问权限。
- `item_index` 从 0 起，固定小于 `item_count`；同批所有成员的数量及时区必须一致。插件当前校验上限 10000 个，后端可给出实际容量限制，需联调一致后再启用。
- 后端必须把 session 创建和批次成员绑定原子持久化；唯一约束 `(account_id,batch_id,item_index)`。超时重试返回原 session，不重复建批/成员。相同索引但文件身份不一致时返回明确冲突。
- 缺少 import_batch 的旧端、实时录音、目录工具保持原有行为。本版本只有手动导入弹窗在能力确认后传此字段。
- 插件将字段经 loopback 请求头 `X-Arkme-Import-Batch`（encodeURIComponent(JSON.stringify(context))）传入 Host，随 RecordingImportJob 保存，上传恢复/重试保留，new-session 转成上例 snake_case。请求头仅是本机桥接，不是新增云 API。
- 本机已有未完成同文件任务可能被复用，而没有创建新的云 session；后端不可把本批缺少的索引视作完成。新批次不偷改旧任务归属。

### 文件未到齐、关闭客户端与重试

不能用 active 列表变空、`accepted`、`has_done_child` 单一布尔值，或已到达成员数作为完整成功条件。必须同时校验预期数量、逐成员最终结果，以及对应转写读模型已就绪。

本版在创建首个云 session 时建立批次，不另设由浏览器负责的 seal 调用，避免把最终触发依赖于页面仍打开。全部 item_count 成员已到齐且成功即可收尾。若某些成员根本未上传到云端（关闭页面、格式失败、网络中断、手动移除），后端需建立持久的未完成批次与失联超时策略，超时只报告未全部完成，不能报成功或永久等待。**超时窗口、续传后的恢复策略需后端同事确认并交付**；不得简单用几秒无新请求判定失败，大文件可长时间上传。

- 尚无任何云 session 的本地失败，只在原上传弹窗报错，无云端通知可产生。
- 已保存云端的音频处理和后续生成不依赖客户端在线；尚未传到云端的字节当然不能在关机后继续上传。
- 本机已有任务的「重试」保留原 batch/index；用户重新选文件并点击导入产生新批次。后端按原始文件/session 身份防止同一天同一输入重复耗费模型调用。
- 暂停与可重试故障不是成功。失败通知及恢复后结果可以更新同批同阶段记录，不能每次轮询或进程重启新增一条通知。

## 新增能力与通知接口（待后端确认）

所有请求：POST，Audio 服务现有鉴权与业务响应 envelope，以下展示 envelope 解包后的 data。不能只依赖 HTTP 200；沿用现有业务成功码检查。路由前缀：`/api/v1/audio/import-batches/`。

| 后缀 | 请求 | 响应/用途 |
| --- | --- | --- |
| capabilities | `{}` | `{"supported":true}`；只有整个 v1 链路可用时才置 true |
| notifications/query | `{"cursor":"","limit":50}` | 下面的通知页；空 cursor 第一页 |
| notifications/read | `{"ids":["notice-id-0001"]}` | `{"acknowledged":true}`，当前账号精确已读，最多 50 条 |
| notifications/read | `{"through_sequence":"序列游标"}` | `{"acknowledged":true}`；将已观察序列及之前标已读，不误读并发产生的新通知 |

query 或 capabilities 明确 404/501 时，插件视为尚不支持；401/403/5xx/无效响应必须显示可恢复错误，不能装作没有通知。read 请求的错误永远不能视作成功。

```json
{
  "supported": true,
  "total": 60,
  "unread_count": 12,
  "through_sequence": "opaque-sequence-60",
  "next_cursor": "opaque-next-page",
  "latest": {
    "id": "notice-id-0002",
    "batch_id": "batch-uuid-0001",
    "stage": "analysis",
    "state": "completed",
    "file_count": 12,
    "completed_count": 12,
    "failed_count": 0,
    "created_at": 1791849660000,
    "read_at": 0,
    "message": "",
    "days": [{
      "date": "2026-10-09",
      "summary": {"state":"completed","version_id":"existing-summary-id"},
      "timeline": {"state":"completed","version_id":"existing-timeline-id"}
    }]
  },
  "items": []
}
```

实际第一页 `items` 应包含 latest；上例省略重复正文。所有页的 total/unread_count/latest/through_sequence 均为账号级真值，而不是当前页统计。按 created_at 倒序，等时间用稳定 ID/序列打破平局；游标为不透明值，不能重复返回当前游标。结束时 next_cursor 为空。

- id、batch_id：8～80 位字母、数字、下划线或短横线；不同账号不可互读。
- stage：processing 或 analysis。state：completed/partial/failed/skipped，均为可通知的阶段结果。
- file_count > 0；completed_count/failed_count 是云端文件处理数量，之和不得超过 file_count。未到达、暂停、取消等差额在 message 说明，禁止标为完整成功。
- created_at/read_at 为毫秒整数，未读 read_at=0。阅读操作绝不能改 created_at、对话排序时间。
- days：本批涉及的录音日，严格 YYYY-MM-DD，去重，最多 366 天；如实际业务超过该上限需先协商分页。使用固定 time_zone 及录音时间计算；跨午夜音频按实际覆盖拆分，夏令时不能简单加 24 小时。
- processing 通知中的 summary/timeline 可为 `{"state":"pending"}`，表示下一阶段还未完成。
- analysis 通知中两个结果均应为终态。各结果 state 为 completed/partial/failed/skipped；completed 必须带真实、可读的 version_id，复用现有总结/时间轴查询返回的版本 ID。
- analysis 的整体 completed 仅用于所有涉及日期的两种结果都 completed；无转写可生成时用 skipped，并说明原因。生成失败/额度不足用对应失败结果，不能带旧版本伪装本次成功。
- message 是普通文本说明，不能含密钥、调试堆栈或不必要的录音全文。
- total>0 必须给 latest 与 through_sequence；插件的通知行排序和未读数量使用账号级汇总，不从 50 条列表推算。

## 服务端自动整理与一致性

建议由 Audio 拥有批次聚合和生成任务，现有通知 owner 可协同持久化。接口对插件暴露统一 Audio facade，内部领域归属由同事决定。

1. 成员处理完成事件事务更新批次；重复投递幂等。所有必要阶段成功且转写可读后，写唯一 processing 通知和 outbox。
2. 通知持久化成功后创建/唤醒按日整理任务。推送失败不阻塞整理，用户已读不是前置条件。采用 outbox 保证崩溃恢复时通知和任务不丢失。
3. 生成输入由后端重新鉴权后汇总对应日期全部可用转写；范围包含当天已有录音。权限、录音“我的/他人”归属遵循现有 daily projection 合同，不新增别人账号可见性，不直接采信客户端文件名或时间范围决定数据权限。
4. 不依赖前端 `recordings.generate` 传来的整段文本。复用现有 summary/create 所属生成服务和用户模型配置，冻结路由/提示词版本，并按正常额度/计费逻辑执行。
5. 幂等键至少包含账号、录音日期、转写输入版本/指纹、生成类型、模型路由及提示词版本。同批或同日多批到达合并/串行调度，不让旧任务晚完成覆盖更新输入生成的版本。处理同时存在的实时录音时，采用明确输入快照，不能无限等待当天未来录音结束。
6. 每个日期独立保留 summary 和 timeline 状态、输入版本、输出版本 ID、失败原因与重试次数。可重试错误退避；额度/权限问题明确结束或暂停，禁止无限忙轮询和重复扣费。
7. 两种结果均落库并能通过现有日查询读到后，再写/更新该批唯一 analysis 通知。先前历史版本保留；已通知的版本 ID 稳定。允许复用相同输入已生成的新版本，但不得拿旧输入的旧版本报告更新成功。
8. 失败/取消不是完整成功。是否对部分成功文件立即整理，后端应按默认“仍有文件失败则先通知未全部完成，完成重试后再整理”执行；若希望先出部分总结，需另行确认产品规则。

## 插件接入位置

- `src/recording-workflow-contract.ts`：公开批次/通知类型与 batch 校验。
- `src/client/recordings/ArkmeRecordingImportDialog.tsx`：每次导入能力探测，生成 UUID、固定 itemCount/index；不从弹窗空态触发通知/生成。
- `src/client/api.ts`、`src/recording-import-routes.ts`：本地上传传递 batch。
- `src/services/recording-service.ts`、`src/state-store.ts`：接纳和恢复 batch 信息。
- `src/services/recording-import-gateway.ts`：new-session 可选 import_batch。
- `src/services/recording-workflow-service.ts`：提议路由的 Host 适配、响应校验、跨账号校验。
- `src/client/recording-notification-store.ts`：共享通知读取、去重、分页、错误保留、前台每 60 秒校准与 focus/online 刷新；不支持时退避到至少 5 分钟。未接 IM 推送前不能承诺秒级到达。
- `src/client/ArkmeNotificationCenter.tsx`：总通知新增录音类型、汇总未读/排序、已读。
- `src/client/ArkmeRecordingNotificationDetail.tsx`：按天结果及三个查看入口。
- `src/client/ui-controller.ts`、`ArkmeRecordingSurface.tsx`：定位指定总结或时间轴版本，原版本缺失时明确提示。

后端可后续提供账号内“录音通知已变更”IM hint；它只用于促使读取，不能成为未读/成功状态的唯一真值。本期采用轮询兼容。

## 联调验收清单

- 单日多文件：全部云端成功后恰好第一条通知；两种新版本可读后才第二条；列表、未读、对话排序正确。
- 多日期、跨午夜、夏令时：更新录音实际日期；通知详情能逐日打开正确结果，不按上传日期错误归档。
- 当日已有总结：新增内容与已有内容综合生成新版，历史可访问；两批并发不重复生成、不乱覆盖。
- 断网、重启、关闭浏览器：已到云端的任务继续；未到达成员不被忽略；能力缺失、服务暂时异常不影响旧上传。
- 单个失败、解析无声、取消、额度暂停：不能出现“全部完成”；通知说明原因，可重试，恢复后无重复通知/扣费。
- read-all 与新通知并发：只读 through_sequence 之前的数据；切换账号、登出后晚到响应被丢弃。
- notification id、batch id、session id 非本账号时拒绝；权限撤销后的结果入口不能读取他人数据。
- 两个结果一个成功一个失败：展示各自状态，成功版本可看，失败结果不冒充最新成功版本。
- 后端实际部署前 supported=false；只有上述端到端通过后开启 true。

## 本次插件验证

- 16 个相关测试文件共 359 项通过，覆盖批次透传/恢复、通知合同、分页与未读、账号切换、通知详情与版本跳转、原有通知列表和上传流程。
- TypeScript 类型检查与插件打包通过。
- 独立 3101 Web 环境使用现有账号验证了总通知的「录音」分类；后端尚未接入时正常兼容，不产生虚假完成通知。
- 自动处理、通知落库、后台生成及真实新版本跳转仍须后端部署后联调。上述自动化测试使用受控数据，不能替代真实全链路验收。

## 同事需交回的信息

确认实际路由及字段是否采用以上合同、返回业务码、失联批次超时/恢复策略、默认模型与计费策略、跨天日界与录音归属规则、测试环境及可重复的多批次数据。若接口命名/分页/状态枚举调整，请同步插件适配与测试，不能仅开放 capability 后依靠前端猜字段。
