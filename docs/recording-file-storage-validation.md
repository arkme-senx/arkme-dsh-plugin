# 文件级音频实际存储：合并前复审（2026-11-03）

## 结论与范围

本需求相关代码经过审查、修复和第二轮复验，未发现未关闭的需求内阻断项。Audio 基线为 master `5de71cf3217fd51a0bb60c822a4d13fd91c2ca83`，插件最终整合 dev `a0ecfce4c7e1fc0eadf70f0554205b02c76dcc7d`。业务提交位于 `codex/c20261102-audio-storage-display`，没有合并目标分支或部署。

不能把仓库整体验收描述为“全量全绿”：插件全量回归有 3 项既有失败，在未加入本需求的 `546c5d951` 和最新 `a0ecfce4` 两个 dev 基线上均复现，见下文。本需求可独立评估合并；要求整仓全绿的发布门禁仍须先处理这三项基线问题。

## 本轮发现与修复闭环

1. 成功结果允许 null / unavailable，且展示时逐个 HEAD 对象会因云访问失败让已保存媒体没有数值。改为读取正式媒体 owner 已原子提交的实际字节，去掉 HEAD、信号量、额外上限状态和成功结果枚举。接口成功只返回非负整数 bytes 与读取时间；失败作为请求错误，不编造零。
2. 历史 Child.size 已包含增强补充音频；旧按日统计再次叠加会多计。修正历史分支为 size + archive_size；文件统计与按日窗口完整性仍各自归属，不复用不同语义的结果。
3. 删除在先隐藏 Session、后清理 Child。读取 Child 后复查可见性，防止删除清理阶段被显示成零；真实 Mongo 用例在两次读之间执行删除验证。
4. 长列表逐批发布及逐行新建 Intl 格式器带来重复渲染成本。批次结束一次发布结果，复用固定语言格式器；正常大小两位小数，极小正数最多六位，固定 MB（沿用列表 1024² 换算），无 B/MiB。
5. 确认 SDK 调用者取消、dispose 和账号变化都拒绝迟到响应；复用已有请求生命周期，不增加另一个 owner。文件管理焦点明确指向菜单按钮。
6. 原安装测试使用模拟统计上游，不能证明整个读链。替换为真实认证 Gin 路由、真实 Mongo repository、正式 ASR 接受事务和真实 ZIP 长度，再由不可变安装包中的 UI / Tool / SDK 消费。

## 需求与场景逐项映射

以下路径以仓库根目录为起点，测试名均可用原生测试命令独立执行。

| 场景与预期 | 实际代码落点 | 验证证据 |
|---|---|---|
| 当前日期文件行获取大小 | arkme-dsh-plugin `ArkmeRecordingFiles.tsx:315` → `recording-file-storage.tsx:20` | recording-day-files-ui：仅当前日期、超过20个分批 |
| UI、Tool、SDK 同一权限和结果 owner | arkme-dsh-plugin `host-api.ts:1744` / `sdk/index.ts:762` / `tools/business/recordings/file-storage.ts:6` → `recording-service.ts:360` | recording-file-storage.test；真实 DSH Agent / 仓外 SDK / Chrome |
| 不透明引用防伪造、跨账号复核 | arkme-dsh-plugin `recording-service.ts:1901`、`openRecordingRef`；`recording-file-storage-service.ts:18` | foreign/duplicate refs、账号中途变化与取消 |
| HTTP 身份只能来自认证 token | Audio `gin/api/router.go:54`、`audio_recording_file_storage.go:18` | HandlerUsesAuthenticatedIdentityAndSafeResponse；真实 JWT API |
| 参数为空、重复、超过20、非法ID、超大body | Audio `recording_file_storage.go:43`，handler MaxBytesReader | ValidatesBatchesOwnersAndCancellation；HandlerRejectsMalformedAndOversizedInput |
| 长录音/上传可见；声纹及其他用途不可见 | Audio `recording_file_storage_repository.go:14` 的 source 白名单 | MongoVisibilityAndRequestOrder；其他 source 不在白名单 |
| 其他用户、已删除、快记回收站、混合非法批次不泄露 | 同一 repository 的 owner/status/record_delete_state 过滤 | MongoVisibilityAndRequestOrder |
| 新包实际大小，包含容器开销 | Audio `recording_transcription_mutation.go:150`；`recording_file_storage.go:80` | CrossRepositoryServer 创建真实184字节ZIP，正式 ApplyTranscription 后读取184 |
| 多个 Child 合计完整文件，不按日期或时长分摊 | Audio repository 只按 session_id 读取所有 Child | TotalsEveryChildAndPreservesObjectVersions；跨日UI原有交互 |
| 相同对象去重、不同版本分别计数 | Audio `recordingAcceptedAudioBytes` 完整 Ref map | CountsAcceptedPacksAndDeduplicatesObjects；TotalsEveryChildAndPreservesObjectVersions |
| 正式基础与增强补充都计入 | Audio `enhanced_transcript_mutation.go:232` 原子媒体提交及 size 累计 | MongoTracksEnhancedCommitAndReplay：新包、历史均120→200 |
| 增强重放不重复累计 | 既有 mergeEnhancedPlayback owner；读取不参与写入 | MongoTracksEnhancedCommitAndReplay 两次同结果仍200 |
| 基础尚未接受、仅补充媒体 | 无 primary 时 Child.size 已包括 supplemental | HistoricalAndPendingFacts 的 supplemental-only |
| 历史逐句/主档/补充音频不重复 | 文件 reader 历史分支；`recording_storage_metrics.go:62` | HistoricalAndPendingFacts；真实Mongo历史增强与重放；按日相关测试 |
| 静音/尚无正式媒体为真实零 | 无包、无历史实际字节 → 0 | 正式静音 ASR 接受后 E2E 返回0；领域 pending/no-child 用例 |
| 缺失历史实际事实、负数、越界不伪造零 | reader 数值、归属和安全整数检查 | RejectsInvalidFactsRatherThanInventingZero |
| 原件/PCM/时长/配额不参与统计 | repository 投影只有size/archive_size/count/ref/source；领域不读取其他字段 | MongoOwnsMetadataAndNeverWritesOrReadsPrivateBodies；E2E 115239321原件不影响184 |
| 策略对比占用不参与正式媒体 | reader 只查session/child，不查 recording_strategy_result | Mongo独立对比99999999及E2E999999999，结果不变 |
| 删除清理并发不能产生假零 | Audio repository `:58` 可见性复查 | DoesNotPublishZeroDuringDeletionCleanup 在Child读前实际删除 |
| 正常接受更多媒体后刷新显示新大小 | 原子Child事实，UI signature含状态/updateAt及refreshRevision | Mongo增强读后增加；UI刷新定向测试 |
| 网络失败不影响列表、菜单、删除 | UI storage.error 与重试独立于文件管理 | recording-day-files-ui 失败后仍可操作，重试恢复同一行 |
| 切日/账号/失活/刷新取消迟到响应 | hook AbortController + accountKey remount；Host账号前后复核 | late storage observation；SDK cancellation/dispose |
| 删除连续文件保持焦点、滚动、剩余行与页偏移 | 文件管理现有owner；焦点定位 aria-haspopup=menu | 30项文件列表交互，包括501文件失败页删除重试 |
| MB单位、极小值和英文 | 固定格式器、既有Harness locale owner | recording-file-storage-format 两项测试及真实页面 |
| 读取成本、隐私与写入隔离 | repository 窄投影 + 批量session_id查询；无云IO或写调用 | 真实Mongo IXSCAN；CommandMonitor无insert/update/delete/createIndexes；无正文/词时间戳 |
| 不引入迁移/配置/状态机 | 仅新增只读API、repository和消费适配器 | 相对目标分支无模型/字段生成/索引/配置/lockfile/版本/根README改动 |

## 验证结果

- Audio 根包完整架构/事务门禁通过。
- Audio 相关真实 Mongo / API / compound 测试通过：文件统计、正式 ASR、增强、历史统计、独立对比、输入清理。
- Audio 相关三包 `-race` 通过；`go vet` 通过；backend_guard 相对 master：0 failures / 0 warnings。
- 插件全量：1357文件通过、20文件跳过、3文件失败；15360项通过、27项跳过、3项失败（见基线复现）。
- 最终整合新截图入口并调整显示精度后，7个定向文件、124项测试全部通过，包含新增上游截图入口及需求全部消费面。没有因为基线失败跳过本次测试。
- 完整 TypeScript noEmit 检查通过；最终 `pnpm run build`（含完整声明类型检查、各端入口与内核Worker验证）通过。
- OpenSpec change 严格验证通过。
- 最终不可变安装包完成真实 Audio/Mongo → Host → Agent Tool / 仓外SDK / Chrome 全链路，正式ZIP184、静音0、历史120，三消费面一致。

## 全量既有失败的隔离证据

原始 dev `546c5d951` 和最终整合的 dev `a0ecfce4`，均用 `git archive` 导出原始 tracked 源码，在独立临时目录使用同一组锁定依赖复现。最新基线这三个文件合计66项通过、3项失败，与任务分支失败位置一致；本需求没有修改这些组件或测试。

| 文件 | 失败位置/现象 |
|---|---|
| tests/message-preparing-integration.test.tsx:189 | 源码静态断言期望6次focusEditedComposer，实际7次 |
| tests/related-quick-notes-drawer.test.tsx:1419 | @阿森候选中未找到精确“AI智能体”文字 |
| tests/retained-call-production.test.tsx:32 | 工具模式切换后找不到mock的data-call-probe |

这证明它们不是本次存储功能引入的回归，不证明对应线上功能一定正常。没有将需求外的聊天、候选文案或通话生命周期修改混入本任务，也没有将测试失败改为跳过。整仓全绿发布门禁仍需处理或由对应owner独立确认。

## 上线影响与边界

不改变上传、转写、播放、增强、对比、计费或删除的写生命周期。新API只读，旧接口响应含义保持。按日统计只修正已确认的历史补充包重复计数。不新增集合、持久字段、索引、配置、迁移、回填、灰度或后台任务。正常部署Audio与插件；回滚应用代码无需动用户数据。

实际字节以正式媒体接受时原子发布的真实长度为事实，展示不承担云桶盘点。外部身份、GPU计算使用确定性本地fixture；未访问生产云对象或线上用户数据。跨机器实机范围为macOS/Chrome，包含空格路径的全新Profile；不声称已做Windows/Linux实机验收。

## 最终不可变包与安装验收

插件业务代码提交 `846c4eabba35013e77d4573e4f27a6e926b71e11`；Audio `ae29894ddb8b8b6d1173405f4ca129cce4bee2fb`。

- 包：`senguoyun-dsh-arkme-3.0.43.tgz`，SHA-256 `13b222719a695fb1678f7906c05d17d2f68f5d7ac5e2b3662aa2e049b89ef3ac`。包版本来自上游dev整合，本需求没有修改版本或lockfile。
- 官方未修改 DSH `0.2.1-rc.2`，Node24，全新包含空格目录的DSH_HOME/Profile，官方CLI安装tgz。
- 真实Agent Tool一次读取三个文件，解析实际返回JSON断言 `[184, 0, 120]`；仓外公开SDK类型编译/实际调用得到相同数组；dispose后调用被拒绝且无上游IO。
- Chrome实际页面三行分别显示 `云端 0.000175 MB`、`云端 0.00 MB`、`云端 0.000114 MB`；普通原文件大小显示 `109.90 MB`。未出现B/MiB单位或“云端暂不可用”。
- 文件列表和统计都转发真实JWT认证Audio API，正式接受事务与Mongo读链真实执行；184是实际生成ZIP的完整长度，独立对比999999999和上传源件115239321均不计入。
- 安装结束主动退出本次测试账号并关闭本次Host和Chrome。证据为 `acceptance.json`、`tool-result.json`、`recording-file-storage.png` 与本地API/Host安装日志；全部使用隔离测试身份。
