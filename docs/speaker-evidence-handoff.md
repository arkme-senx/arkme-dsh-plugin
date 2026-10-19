# 说话人证据审查：逻辑交接

本次只交付 service、Host API、公开 SDK、Tools、合同和测试。`src/client/**`、页面布局、文案、按钮、选择方式、确认步骤、分页顺序和试听交互均未修改；原页面没有的入口不会自动出现。页面负责人可以直接消费以下能力，不需要传数据库 ID 或声纹向量。

## 业务语义

声音一致性审查的是完整当日组。`total_count` 不受当前页大小影响；缺证据显示未知／部分完成，单片段不伪装满分。一致性分数和 A/B 余弦距离不是人物身份概率，也不能根据转写文字推断声音身份。

人物归属、未知碎片、现场／播放来源和“不是某人”是不同事实。只撤销归属不等于排除人物；明确排除才建立反证。片段身份保存与其能否作为后续声音参照分别返回。未知选集中的不同来源区间拥有独立分区。

## 公开入口

通过 `@senguoyun/dsh-arkme/sdk` 导入 `createArkmeSdk`、`RecordingEvidenceQuery`、`RecordingEvidenceResult`、`RecordingEvidenceGroup` 及现有纠正类型。无需内部 service 路径。

| SDK | Host method | 作用 |
| --- | --- | --- |
| `recordingSpeakerEvidenceQuery(query, signal)` | `recordings.speaker.evidence.query` | 能力探测、完整组、A/B、成员／候选页、显式补证据 |
| `recordingSpeakerCorrectionItems(query, signal)` | `recordings.speaker.correction.items` | 返回既有账号／当日／转写来源绑定的 itemRef |
| `recordingSpeakerCorrectionContext(itemRef, signal)` | `recordings.speaker.correction.context` | 当前版本、排除人物和可撤销回执 |
| `previewRecordingSpeakerCorrection(input, signal)` | `recordings.speaker.correction.preview` | 只读选择预检与签名 intentToken |
| `applyRecordingSpeakerCorrection(input, signal)` | `recordings.speaker.correction.apply` | 原子保存显式选集和目标 |
| `recordingSpeakerCorrectionResult(query, signal)` | `recordings.speaker.correction.result` | 网络结果不明确时读取同幂等键回执 |
| `undoRecordingSpeakerCorrection(input, signal)` | `recordings.speaker.correction.undo` | 受版本和后续使用保护的撤销 |

所有 itemRef/speakerRef/undoRef 均从当前账号真实响应获取，不能自行拼接。跨账号、跨日、跨转写来源或旧版本会拒绝。传入 AbortSignal 时取消由公开 SDK 一直传到底层请求。

## 查询及保存

`RecordingEvidenceQuery.action`：

- `capabilities`：无需片段；返回后端实际支持的动作。不可根据空响应猜测支持。
- `consistency`：`groupRefs` 最多 100；`itemRefs` 为当前页最多 50。每个组返回完整分母和这些行相对该组的偏离。
- `compare`：`itemRefs` 最多 50；`referenceA`/`referenceB` 各 1–3 个明确参考。参考行自身返回 `reference_item`，不参加比较。
- `members`：一个 `groupRef`，`sort: time|deviation`，`limit` 1–100。沿用返回的 `version` 和 `nextCursor` 翻页。
- `candidates`：按 `referenceA` 检索同一天声音参照；不是通讯录人物猜测。
- `build`：明确的计算写操作，单组或最多 100 个 itemRef；不会重跑 ASR 或指定人物。`queuedCount` 只计仍活动的任务，终态失败不伪装排队。

成员／候选响应将 owner 定位重新封装为 itemRef；不向页面暴露 session_id、child_id、正式人物 ID、job ID 或 embedding。汇总与比较字段保留后端命名（如 `total_count`）；成员页采用 `totalCount/nextCursor/hasMore`。

纠正沿用 `itemRef/itemRefs/expectedVersion/idempotencyKey/detach`，增加：

```ts
const input = {
  itemRef: anchor.itemRef, // 锚点可以不在选集中
  itemRefs: selected.map(item => item.itemRef),
  expectedVersion: context.version,
  idempotencyKey: crypto.randomUUID(),
  detach: false,
  target: { kind: 'new' as const, name: '用户指定的名字' },
  soundSource: 'in_person' as const,
  // 可选：Child 内毫秒，不是页面绝对时间；必须位于父行范围内。
  selections: [{ itemRef: selected[0].itemRef, startAt: 1000, endAt: 4000 }],
}
const preview = await sdk.previewRecordingSpeakerCorrection(input, signal)
const result = await sdk.applyRecordingSpeakerCorrection(
  { ...input, intentToken: preview.intentToken }, signal,
)
```

`target` 也可为 `{kind:'unknown'}` 或 `{kind:'existing',speakerRef}`。重放保留原幂等键与原选择；改变选择重新生成键和预检。preview 不新增确认 UI，不能扩大用户已确认的操作。`learningStateAtCommit` 分别为 `not_requested/ineligible/awaiting_evidence/reference_ready`；撤销回执为 `reconciled`。不得把 `awaiting_evidence` 解释为保存失败。

409 要刷新定位、版本和选择，不能接着拼旧游标；410 表示片段不可用；422 表示范围超预算。网络结果不明确先查询 result；无回执不代表请求失败。上下文和恢复仍走原来的逻辑。

## Agent Tools

`arkme_recording_speaker_evidence` 为只读入口，拒绝 build。`arkme_recording_speaker_evidence_build` 单独注册为写操作，既有 runtime 确认机制会实际拦截未确认调用；不能靠 Tool 元数据声明代替执行层确认。参数 `request_json` 使用上述公开查询合同。原有纠正 Tool 接受新增目标、子区间和 intentToken。

## 验证

- 完整插件套件：1021 文件、12016 项通过；20 项明确跳过。Node 25 使用 `NODE_OPTIONS=--no-experimental-webstorage` 运行既有测试环境。
- 包构建、类型检查通过；独立 TypeScript consumer 从正式安装的 tgz 导入公开 SDK，编译并运行通过。
- `tests/e2e/speaker-evidence.e2e.mjs` 在官方 DSH fb2c4b9 的隔离 profile、专用测试账号登录下通过：SDK 完整组、两页成员、Tool 发现、只读拒写、真实确认拦截、AbortSignal。
- E2E 设置 `ARKME_DSH_CHECKOUT`、`ARKME_PACKED_PROFILE`、`ARKME_EVIDENCE_TEST_ACCOUNT`（专用测试账号）；已准备专用三行录音时可设 `ARKME_EVIDENCE_TEST_DAY` 增加真实读链验证。profile 必须由官方 CLI 安装不可变 tgz；不使用用户常驻客户端。

后端纠正／撤销及负载结果由对应后端交付记录提供。未发布插件 npm 包，也未替换用户常驻客户端；页面实际消费这些新能力仍由页面负责人在本交接合同下接入。

## 2026-10-19 接口交付边界

本次仅交付后端、Host、Tools 与公开 SDK 能力。用户明确要求所有可见状态、文案、布局和交互保持原样；既有“已有／新人物”按钮禁用状态与等待后端支持文案不修改。因此接口可用不代表页面入口已开放。

合入最新 dev 后保留页面现有 `recordings.speaker.evidence` 与 `recordings.speaker.consistency` 合同；完整证据查询使用独立 `recordings.speaker.evidence.query`，SDK 对应 `recordingSpeakerEvidenceQuery`。Tool 名称保持不变。两种请求结构不混用，也不按参数猜测版本。新增查询与既有读取共用账号/纠正版本失效检查，并传递取消信号。

验证：类型检查通过；全量测试 12,602 项通过、20 项跳过，发现的两处方法清单/Tool mock 旧名称已修复并经 73 项定向复验；另有 7 项接口隔离/SDK/Tool 合同测试通过。相对最新 dev，`src/client/**`、根 README、版本及 lockfile 零改动。
