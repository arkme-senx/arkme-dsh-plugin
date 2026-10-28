# 说话人证据：重构适配交接

## 交付范围

从官方 dev `1a9b86bc243097ff9d37d6a30634893b7fdbb20b` 新建任务分支，按当前 RecordingService、ServiceRuntime 请求协调器和录音查询模型重新落入能力。旧 PR #864 保持关闭，不合入旧转写读取实现。

业务目的是发现混入同组的声音，并让用户对明确选中的区间进行可追溯、可撤销的纠正。整体一致性、声音相似、人物身份和播放来源保持不同语义；插件不根据文本或显示名判定人物，不自行计算一致性分数。

本轮交付接口能力。`src/client/**`、页面文案、按钮及可见状态不改；已有／新人物按钮不会因此自动开放。客户端、后端和 DSH 源码不修改，无新增配置、依赖、缓存、轮询、数据库结构或迁移。

## 能力矩阵

| 能力面 | 落点 | 验证边界 |
| --- | --- | --- |
| Host owner | RecordingService；证据区间引用与正文编辑引用区分 | 权限、范围、转写来源、版本、取消、原子提交和响应校验 |
| SDK | query、preview、playback；扩展既有 apply/result/undo | 公开类型；独立目录安装 tgz 的 Consumer 编译、能力探测、取消和播放引用 |
| Tools | 只读证据、显式 build、纠错预览与提交 | 正式注册、grant、确认前拦截；复用既有确认机制，build 使用旧任务的确认文案 |
| UI | 既有 evidence/consistency/纠错/播放适配器 | 页面源码零差异，相关回归；不新增入口或改变不可用按钮 |
| Harness | 官方 DSH 0.2.1-rc.2，全新含空格路径 Profile | CLI 安装不可变 tgz、真实会话发现和执行；未替换常驻客户端 |

试听通过 SDK 和既有播放器消费不透明媒体引用。Tools 不新增播放队列或操作用户播放器；该侧没有新的产品入口。

## 公开接口

从 `@senguoyun/dsh-arkme/sdk` 导入 `createArkmeSdk`、`RecordingEvidenceQuery`、`RecordingEvidenceResult`、`RecordingEvidenceSelection`、`ArkmeRecordingSpeakerCorrectionPreview` 和 `ArkmeRecordingPlayback`。

- `recordingSpeakerEvidenceQuery({ action: 'capabilities' })`：发现后端 actions；只有 404/501 或显式 `supported:false` 视为未开放。鉴权、网络、冲突和格式错误仍是错误。
- `consistency`：`groupRefs` 1–100，详情可带 `itemRefs` 0–50；带片段时仅允许一个组。统计来自后端完整组，与当前页数量无关。
- `compare`：`itemRefs` 1–50、`referenceA` 1–3、`referenceB` 0–3。未知保持 null，不把参照自身变成高可信自证；A/B 重复定位拒绝。
- `members`：一个 `groupRefs`，`sort` 为 `time`／`deviation`，`limit` 1–100；下一页同时传原 `version` 和 `nextCursor`。成员直接返回可继续取证、试听、纠错的 `itemRef`，不补拉整天转写。
- `candidates`：当日 `referenceA` 1–3、`limit` 1–100、稳定版本／游标；当前后端只接受 A 参照，不声称支持 B 检索或跨天检索。
- `build`：一个组或 1–100 个显式片段，读取不会隐式启动。SDK Host 同源保护，Tool 要求明确写授权和确认。返回 ready/building/insufficient/failed，不把失败任务报成进行中。
- `recordingPlayback(itemRef)` 与 `mediaUrl(playbackRef)`：沿用现有媒体 owner 校验；不暴露 OSS 签名地址。

`selections` 的时间是**相对所选父片段起点的毫秒偏移**，不是 Unix 时间，也不是 Child 内坐标。例如只选某段的第 1–3 秒：

```ts
const selections = [{ itemRef, startOffsetMillis: 1000, endOffsetMillis: 3000 }]
```

Host 按该引用的真实 Child 坐标转换，要求整数、非空且不超过父区间。成员引用不带正文 revision／speakerReference，不能用于普通整组 assign；避免把邻近查询、声学组和人工精确纠错混用。

## 原子纠错与恢复

```ts
const context = await sdk.recordingSpeakerCorrectionContext(anchorRef, signal)
if (!context.supported) throw new Error('纠错能力未开放')
const command = {
  itemRef: anchorRef,
  itemRefs: selectedRefs, // 仅实际选集；可跨分页、超过十分钟，锚点不必选中
  expectedVersion: context.version,
  idempotencyKey: crypto.randomUUID(),
  detach: true,
  target: { kind: 'unknown' as const },
  // target 也可为 { kind: 'existing', speakerRef } 或 { kind: 'new', name }
  // existing/new 必须 detach: false；detach 指取消人物归属，不是‘拆出’的通用开关。
  // 可加 selections、rejectCurrent／rejectedSpeakerRef、soundSource
}
const preview = await sdk.previewRecordingSpeakerCorrection(command, signal)
// 调用方完成既有人工确认后，保持选集、目标和版本原样提交。
const result = await sdk.applyRecordingSpeakerCorrection({ ...command, intentToken: preview.intentToken }, signal)
```

- preview 为只读，返回绑定选集／目标／数据版本／证据版本及有效期的签名意图；apply 只调用一次后端原子命令，不串行 assign。
- 超时／断网后用原 `itemRef`、`action`、`idempotencyKey` 调用 `recordingSpeakerCorrectionResult`；null 不等于失败。不得自动换 key 重试。
- 撤销使用当前上下文版本与原 `undoRef`，冲突由后端裁决，不能覆盖后续人工改动。
- `learningStateAtCommit` 是提交当时状态：not_requested/ineligible/awaiting_evidence/reference_ready；undo 为 reconciled。awaiting_evidence 不能宣传成已完成学习。
- 来源 playback 与人物身份独立，排除人物为有范围的负证据；后端负责隔离污染样本、人工参照与撤回，插件只传递明确意图。
- 查询和预览在 HTTP、密钥读取后复核账号／取消／本地版本；成员定位、分页版本、游标进展、重复定位及响应基数均校验。上游额外字段和向量不穿透。

## 资源与回归

成员页一个 owner HTTP 请求，密钥一次读取，不按行补取正文或人物资料；有排除人物的纠错 context 额外一次批量目录查询，将旧 ID 映射到重构后的 canonical reference，没有逐人物请求。已不在目录中的排除人物保留原 label，optionKey 为空，不阻断读取和撤销；纠错最多 100 个选集，现有回读保持分页。Host 请求与 Tool 预览共享约 1 MiB 容量，避免 100 个不透明引用和子区间因旧 200 KB 限制被截断。

回归包括跨录音成员定位、区间偏移、unknown/existing/new 单次提交、预览不写、回执／撤销、跨账号、迟到结果、重复定位、无效分页、未知值与向量剥离、同源保护、100 段容量、工具确认和既有页面路径。所有完整测试结果在最终验收段记录；旧 PR 的历史测试不作为本轮通过证据。

## 可复验资产

- `tests/consumers/speaker-evidence-consumer.mts`：只从公开 SDK 导入，在独立项目安装本次 tgz 后，以 TypeScript NodeNext 编译并运行。
- `scripts/speaker-evidence-dsh-acceptance.mjs`：作为测试 Profile 的 Cordis 插件加载；需要公开 `@deepseek-ai/dsh-llm` 依赖和已由官方 CLI 安装的 Arkme tgz。
- 环境变量：`ARKME_EVIDENCE_TEST_ACCOUNT=3016`、`ARKME_EVIDENCE_FIXTURES`（含 public-clip-0/1/2.wav）、`ARKME_EVIDENCE_REPORT`。这些仅用于验收脚本，不是产品配置。
- 必须使用全新 DSH_HOME、独立 keychainServicePrefix、TEST 服务地址、关闭更新／远程／OpenAPI MCP，并让 Web 监听本机空闲端口。脚本拒绝已占用日期，操作仅限本次随机文件名，finally 清理与撤销；fixture-journal.json 保留中断清理范围。
- 清晰语音夹具来自 [FunASR 官方示例](https://github.com/modelscope/FunASR)，[公开中文 WAV](https://isv-data.oss-cn-hangzhou.aliyuncs.com/ics/MaaS/ASR/test_audio/asr_example_zh.wav)。用同一公开样本在三个时间位置导入，仅验证接口与跨录音定位；不构成不同真人的模型准确率验收。

## 最终验收

工作区最终产品源码的类型检查、完整构建和独立 Consumer 编译／运行通过；完整套件 `NODE_OPTIONS=--no-experimental-webstorage pnpm test --maxWorkers 2`：1283 个文件、14523 项通过，仓库既有 18 个文件／24 项跳过，没有为本任务新增跳过。`src/client/**`、根 README、package.json 和锁文件相对基线零差异。冻结版本完整门禁于 2026-10-28 19:00:29（Asia/Shanghai）启动，410.55 秒结束，结果如上；源码／测试随后未再修改。

不可变运行产物 SHA-256：`70a220b674d967721ae9a1c69f503f043aab4de8ba25a3aa2fcc1d420806b151`，插件版本仍为 3.0.35；产物记录对应产品源码，后续只补交接文字／脱敏验收摘要，不替换已验收包。

TEST 3016 使用官方 CLI 装包，独立 Profile 与外部 SDK 经真实 HTTP 验证能力发现、真实 Agent Tool 的只读拒写／确认计算及三类目标预览、A/B 自参照保护、同日候选、unknown 子区间、已有／新人物、签名预览、结果查询、幂等重放、完整组两页、试听字节流、排除人物和 playback 来源、撤销及取消。新人物和多片段已有归属分别提交／撤销，不把连续修改后的旧撤销回执当作可重放命令。旧快照受到后续修改时返回 409 是保护条件，调用方必须重新读取，不能强行覆盖。

脱敏结果见 [真实请求摘要](speaker-evidence-test-20261028.json)。80 次读取、并发 4：p50 662 ms、p95 698 ms、最大 737 ms，零请求失败；诊断复跑相同 80 次为 p95 714 ms／最大 734 ms。这个小规模插件链路测量不替代 Audio 的 2520 次负载报告，也不能证明所有规模都没有尾延迟。

真实声学任务成功后，三份 4.9 秒片段均返回有效语音 4748 ms，但质量为 `insufficient / uncertain_speech_quality`；该结论由 TEST 的精确证据文档和成功任务共同确认。插件按约定保留 null 距离，不能把接口成功当成得到了有效相似度。真实非空距离、可用证据进入学习及模型误报／漏报仍需要合格标注样本验收；本轮不修改后端质量门槛或伪造观察。

本轮导入录音均经 API 清理，新人物即时撤销。早期串联撤销探针留下的一个自建临时人物，在核对创建回执、两个自建来源均已删除、无有效引用与声纹向量后，TEST 事务内按精确 ID／owner／版本软删除，保留本地恢复快照；未清理任何存量人物。

生产发布、常驻客户端替换、Windows/Linux 真机验收不在本轮执行范围。后端既有冷读尾延迟、滚动发布与索引工具分发问题仍见 Audio !151；未执行 DDL、未分发迁移命令。页面按钮和可见状态完全保留，接口交付不表示页面入口已开放。
