# 录音每日识别安排与来源回跳：后端交接

## 交付边界

录音页的每日统计中增加「识别安排 N 项」，点击查看当天录音识别的安排及当前状态；安排卡片显示来源录音日期，点击回到该日期的来源总结版本。

本次完成插件前端、Host/Provider 读取适配、缺能力降级与合同测试。**下面的远端接口是待后端确认的建议合同，不是已开发、已部署的后端。** 没有修改后端或 Flutter/Arkme 客户端，没有重跑历史识别或改写用户安排。流程沿用：前端准备 → 本文交接 → 同事确认字段并开发、部署 → 返回样例 → 真实账号联调验收。如已有等价接口，请提供合同，由前端适配。

## 已核对的现状与缺口

2026-10-13 拉取并只读检查 `jotmo-intelligent`：`origin/master=6553d26ee5f57529fe55841355b70fbf17e4cdd9`，`origin/develop=7b66262239f85654fb4706e1832757eae9481bc5`。

- `gin/compound/arrangement_reminders.go` 的 `AudioSummaryArrangementTriggerInput` 已收到 `SummaryID / DateStamp / TzOffset / FromStamp / ToStamp`，识别路径仍然存在。
- 同文件 `createAudioSummaryArrangementItem` 写入 `SourceType=AudioSummaryExtract`，但目前可导航的录音日期、总结 ID、范围未随安排保存和返回。`extra.source_items[].create_at` 是 `EventAt`；安排 `create_at` 是入库时间，二者均不能当成源录音日期。
- `internal/arrangements/enums.go`：`source_type=5` 是录音日总结识别，`6` 是通话语句识别，本功能不能混算。
- `gin/api/types.go` 的安排列表没有录音来源日期过滤/汇总合同。现有 due 日期过滤是「安排发生时间」，不能复用于「从哪天录音识别」。
- `internal/arrangements/reminders.go` 的 `AudioSummaryArrangementUID` 含截断哈希，不是可逆的来源 ID。前端不以 UID、标题、原文相似度猜测来源。
- 现有流程从每日总结提取安排，没有可靠的具体转写片段身份。因此本次回到**来源总结**，不能承诺精准定位到某句话。

## 统计口径

1. 当前账号拥有的、来源为该录音日的安排。安排几天后才创建或计划在未来执行，也归属原录音日。
2. 包含已识别、跟进中、已完成的存量安排；每个安排 UID 只计一次，已删除的不计。状态与安排板块读取同一份业务事实，不复制生成第二份安排。
3. 同一天多个总结版本可能各自提取安排。返回已有唯一安排身份；是否跨版本业务去重由后端负责，不能在前端按相同标题合并。
4. `ready` 才代表该日关联和识别覆盖完整；`ready + total=0` 才能显示确定的「0 项」。识别中、未处理历史、无法回填或能力缺失不能返回伪零。
5. 不触发识别、重新总结、状态变更或数据回填。列表和数量均为只读。

## 建议来源字段：列表、详情、变更响应统一返回

在现有 Arrangement 对象保留原字段并增加 `recording_source`：

```json
{
  "uid": "existing-arrangement-uid",
  "title": "已有安排标题",
  "status": 2,
  "source_type": 5,
  "recording_source": {
    "kind": "daily-summary",
    "date_stamp": 1791475200000,
    "tz_offset": 28800000,
    "summary_id": "original-audio-summary-id"
  }
}
```

- 上例是 UTC+8 的 2026-10-09 零点。时间戳和 `tz_offset` 均为毫秒；东区为正，沿用现有录音 API。`date_stamp + tz_offset` 应落在 UTC 日零点。
- `summary_id` 对应现有录音总结版本返回的 `id/summary_id`，不是模型名称或版本序号；不能因为重新总结而改成最新版本。
- 若只有可靠日期、没有总结版本，可省略 `summary_id`，前端回到该日总结，不宣称精准定位版本。
- 若来源无法确认，保留 `source_type=5`，省略 `recording_source`。前端显示「来自录音 · 来源暂不可定位」，保留原有安排的查看和处理能力。
- 非录音来源不返回此字段。后端校验所有者及源总结访问权限，不能仅凭客户端日期/ID绕过权限。
- 插件只向浏览器投影允许字段及账号绑定的 `arrangementRef`，安排原始 UID 仍留在 Provider。

## 建议按来源日读取接口

`POST /api/v1/arrangements/recording-day`，通过既有 intelligent 服务鉴权和业务成功 envelope。使用独立路径是为了避免旧 `/list` 静默忽略未知日期过滤，导致全量安排被误计为当天安排。

请求：

```json
{
  "date_stamp": 1791475200000,
  "tz_offset": 28800000,
  "limit": 20,
  "offset": 0
}
```

成功 envelope 的 `data`：

```json
{
  "contract_version": 1,
  "date_stamp": 1791475200000,
  "tz_offset": 28800000,
  "state": "ready",
  "total": 1,
  "snapshot_version": "opaque-snapshot-token",
  "list": [
    {
      "uid": "existing-arrangement-uid",
      "title": "已有安排标题",
      "status": 2,
      "source_type": 5,
      "recording_source": {
        "kind": "daily-summary",
        "date_stamp": 1791475200000,
        "tz_offset": 28800000,
        "summary_id": "original-audio-summary-id"
      }
    }
  ]
}
```

`list` 中补齐既有 Arrangement 常规字段，例如描述、创建原文、到期时间、提醒状态等；为简洁，示例未展开。`limit` 最大 50。第二页提交相同日期、时区、`snapshot_version` 和上页返回条数累计的 `offset`。计数、排序、列表必须属于同一快照；快照过期/变化返回 409，前端提示刷新第一页。建议按来源时间、UID稳定排序；不要因修改状态导致分页跨页丢失。

| state | 语义 | 前端显示 |
| --- | --- | --- |
| ready | 当日可关联的历史覆盖与识别结果完整 | N 项；0 时显示当天尚未识别出安排 |
| processing | 仍有识别任务未完成 | 已识别 N 项 / 处理中，不宣称最终总数 |
| partial | 关联历史或覆盖不完整 | 已识别 N 项 / 暂不可用，侧栏说明历史来源不完整 |
| unavailable | 暂不能提供可靠来源关联 | 暂不可用；不显示 0 |

`unavailable` 返回相同的合同版本、日期、时区及 `total: null, list: []`，不需要快照。未部署返回 HTTP 404/405/501 时也降级为暂不可用；401/403、限流、网络失败或错误合同按失败处理，允许重试。

前端适配会验证版本、回显日期/时区、总数、快照以及每条来源日期，拒绝夹带其他日期或缺少可靠来源的列表。某条来源无法定位时，应从确定日期列表中排除，并将整体历史覆盖标为 partial；不要把该条随意放入创建日。

## 后端实现与历史数据建议

- 在提取时保存原始来源结构。可扩展 Extra 或关联表，具体存储方案由后端决定。应至少留存所有者、原总结 ID、日界线/时区，以及已有的源范围，便于以后更精细导航。
- 对历史记录先确认是否仍有源总结、提取任务日志等可验证证据。截断哈希不能单独证明归属；如尝试恢复映射，需唯一性和原始输入校验，歧义记录保持未知。
- 已修改的安排、总结重生成、多设备数据合并可能使简单重算失效；不要为了回填生成新的安排，也不要覆盖用户后续修改或删除记录。
- 日期和时区按来源日事实保存。用户跨时区后，前端仍显示来源日的日历日期；若旧日 API 在当前时区无法返回原总结，显示版本不可用提示，不伪装为另一版来源。可进一步协商原时区/总结 ID直读能力。
- 如将来需要精确转写回跳，应由提取过程保存可靠 segment 身份（sessionId、childId、itemIndex、transcriptSource/version、startAtMillis）并单独约定权限与失效规则。当前不通过标题或原文模糊匹配伪造精确位置。

## 前端实现位置与验收

- `src/client/recordings/RecordingDayArrangements.tsx`：每日统计入口、右侧列表、分页、刷新、处理中和能力缺失状态。打开侧栏重读状态；返回录音页也重新读取。可前往既有安排板块处理，无新增写操作。
- `src/client/ArkmeArrangementContent.tsx`、`ArkmeArrangementRecordingSource.tsx`：安排看板、日历及录音列表共用来源展示。
- `src/client/ui-controller.ts`、`ArkmeRecordingSurface.tsx`：跳转日期并选中来源总结版本；同日重复打开也会定位；不自动播放录音。版本不存在时明确提示并展示该日可用内容。
- `src/services/arrangement-service.ts`：Provider 适配、合同验证、账户归属引用；`src/host-api.ts`、`src/sdk/index.ts`：`arrangements.recording-day` 读取接口。
- `tests/services/recording-arrangements.test.ts`、`tests/recording-arrangements-ui.test.tsx`、`tests/recording-arrangement-navigation.test.tsx`：使用合成夹具验证合同与交互，不等于生产联调通过。

后端部署后须用真实账号核对：源日期与创建日/安排日不同；0 项/多项/多页；跟进与完成状态同步；同一天多个总结版本；旧数据缺来源；源总结已删除/处理中；切换账号、日期及跨时区；禁止越权；同一源重复打开；请求失败和分页快照变化。确认后再宣布双向链路可用。

当前本地测试页使用 `3101` 独立 Web 环境，共用已有测试登录态；不修改已安装客户端内容。真实账号能否返回确定数量，以新接口部署后的实际响应为准。

### 本地验证记录（2026-10-13）

3101 已更新到本次代码。有录音的 2026-10-09 能打开每日「识别安排」侧栏，保留正确日期。通过独立预览的已登录 Provider 调用新操作，返回 HTTP 502 / `arkme-response-invalid`（远端没有返回可解析的业务响应），因此真实数量和真实来源链路尚未验收。前端显示暂不可用和读取失败重试，没有把该结果当成 0 项。不能仅由此响应推断远端网关的具体配置；需后端同事确认新路径部署/路由及返回合同。

同一真实账号的安排看板已展示 24 张可识别为录音来源、但缺少可靠回跳字段的旧卡片，显示「来自录音 · 来源暂不可定位」。无来源卡片保持原样。最终本地验证：15 个相关测试文件、302 项测试通过，TypeScript 检查、插件 bundle 和 diff 格式检查通过。没有提交、推送或部署后端。
