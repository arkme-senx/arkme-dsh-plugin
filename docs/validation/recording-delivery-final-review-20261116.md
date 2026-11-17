# 录音交付最终审查（2026-11-16）

范围：JW_Station、jotmo-audio、jotmo-frontend-ios、arkme-dsh-plugin 的 recorder-delivery 开发分支。审查与修复均在已有任务 worktree 内完成；没有生产部署、设备刷写或数据清空。

## 基线

- Station：origin/master `d096a70cea034af79d7002461f49241b6184acf8`。保留 `adf7129` 移入的 CDC 关闭修复及 `83f8c6b` 集成回归。
- Audio：origin/master `89e6b62d86b89860027c4fdee5f0752a3d415545`。
- iOS：origin/master `348519df8164cb6d4a1874f9f2aa401db7dd179d`。
- PC：已从 `cbddca489` rebase 到 origin/dev `d581db02c`，并保留最新发送时序能力。冲突仅在 Host/SDK 首行导入，已分别保留双方依赖；typecheck、构建与全量测试复核整合结果。

## 本轮确认并修复

| 问题、复现证据 | 根因与落点 | 修复后不变量 |
| --- | --- | --- |
| 请求 offset=900、limit=20，原代码读取 10 页以及前面所有任务的模型详情 | Gateway 为客户端过滤 source=2 而从 offset=0 扫描，并缓存整个前缀；新 Tools/SDK 查询可放大内存和读取量 | Audio task_scope 查询在 count/分页之前按既有 source 字段过滤；Gateway 直接读取请求页，只补该页进度，无前缀缓存。UI/Tools/SDK 同一 owner。列表总数在并发完成时变旧，空页也不会宣称还有下一页 |
| 正文冲突预算耗尽显示红色更新失败；总结仍 processing 时，正文稳定后也不恢复 | 手动/通知刷新 catch 把 RecordingViewUpdating 当普通失败；poll 选取独立部件时漏掉 pages.updating | 临时版本变化保留正文并显示更新中；已有刷新 owner 同时继续正文和总结，仍执行版本校验、取消及账号/日期检查 |
| iOS 终态含失败仍显示已完成；PC 可选模型详情不可用时也复现相同错误 | 服务端聚合允许 AsrDone 和 Failed 达终态，终态不代表全部成功 | 摘要以同一次最小字段读取派生 has_failed_child；iOS 显示文件处理失败；PC 从列表保留失败事实，即使可选详情请求失败也不报成功；不混用本地上传失败或设备缺件 |
| 接收完整但解码失败，audio_duration_ms 被确认为 0 且 duration_final=true | 以处理终态代替时长确认 | 缺少确认时长时保持未知；部分已确认时长可展示但不标总量确认；ASR 失败且已有 SD 确认时长仍保留；真实空 capture 仍为已知零 |

以上均先建立失败用例或基线执行证据，再修复并复验。未新增持久化状态、数据库集合、索引、产品配置或模型配方。

## 场景到代码与测试的映射

| 场景 | 代码责任 | 检查/回归 |
| --- | --- | --- |
| 两颗吊坠、重枚举、绑定/时钟变化、完成后的重复轮询 | Station main.c / sync_manager.c 的发现代次和同步完成上下文 | sync_lifecycle、context_delivery、recorder_recovery |
| USB callback 尚未退休、拔出、部分关闭失败、再次关闭、resume | CDC driver 原 USB client task 排空回调；应用延迟清理 owner | cdc_close 8,100 组合、cdc_close_concurrent 200 轮、cdc_start/control/memory_ownership |
| 结束晚到、提示丢失或溢出、失败重试、长源件积压 | cloud_upload.c reconcile_end_step 与独立持久遍历游标 | end_delivery 四场景；512 分片不重算哈希、不重复 prepare；失败占满时间片后音频仍推进 |
| 网络中断、部分 PUT、提交/回执持久化、恢复与账号环境切换 | 原上传检查点/回执协议；同一 I/O executor | cloud_upload、stream_pipeline、scan/resume_checkpoint、capture_store、delivery_priority |
| I/O 排队、暂停、离线、执行结束、状态过期、累计字节 | delivery_status.c / case_status.c；iOS CaseTelemetry / CaseCloudViews | delivery_status / status_dispatch；跨仓真实 JSON 夹具；30 秒过期不继续冒充同步中 |
| 结束先到、最后源件后到、显式缺件、解绑、零源件 | 原 DeviceCapture.Complete/IntakeClosed/CoverageState；新查询仅读取事实 | RecordingCapture / RecordingDelivery；不修改接收协议或完成判定 owner |
| 普通导入、设备采集、模型 prepared 分段 | UploadSourceID 归组；Session.Source 与 IngestOrigin 含义分开 | RecordingDeliveryReceiptsExcludePreparedParts；TaskSourcePagingAndFailureFact；共享 JSON 合同 |
| 257 分段且含大量正文、500 条旧恢复查询、深页请求 | SelectRecordingListSummaries，100 会话/128 cursor batch；Gateway 直接分页 | 真实 Mongo 投影断言、LegacyRecoveryPage、distant page；不读取正文/声纹/音频，不缓存历史前缀 |
| 接收与模型并行、全部失败/部分失败、无语音、未知/零/亚秒时长 | RecordingListSummary / ProjectRecordingDelivery；各客户端投影 | Go 失败解码和失败 ASR；Swift settled failure、840 ms；PC receipt/progress tests |
| 改显示时间、跨日、有间隔采集 | captureStart/End 不变，displayEnd 平移；客户端按采集跨度筛选 | 共享合同、跨天测试、已安装 SDK 修改时间再读取 |
| 正文版本变化、持续总结、网络失败、导出、切换账号/日期 | 共享 transcript hook + 原页面刷新 owner；导出仍需完整版本 | background-refresh、transcript-pages-ui、comparison-view；不吞鉴权/网络错误，不导出部分正文 |
| UI、Tools、SDK 查询一致且没有恢复副作用 | RecordingService + 同一只读 gateway；公开 SDK capability | 正式工具注册、Host tests、仓外 SDK 类型检查、官方 DSH 安装包联调 |

## 内存与架构判断

盒端保持单 I/O owner、既有固定栈和上传缓冲；结束记录与音频只在既有调度边界交替，没有并发 TLS。CDC 在回调退休后释放资源，失败保留所有权再重试。不可把“发出取消”视作“可以释放”。

服务端为每批最多 100 个会话保存数字摘要，Child 使用 128 条游标批次，模型分段数和正文长度不会变成应用层完整数组。PC 删除了累计历史扫描缓存；一次只持有请求页和对应处理详情。iOS 保存只读值类型，不新增音频缓冲或后台 owner。

已有 receipt、capture、模型任务仍各自负责业务事实。新 DTO 不反向驱动上传、模型重试或完成判断；普通本地文件上传仍使用自己的真实字节进度。

## 发布边界

先部署 Audio 查询扩展，再更新 PC/iOS；Station 沿用现有 Device/分片协议。无新增配置、迁移或索引。代码/主机故障测试不代替实机供电抖动、拔插、网络速度与长期栈/堆高水位验收。本轮不重新宣称模型质量或 17 小时续航已验证。

## 验证记录与限制

- 盒端 25 组主机回归通过；ESP32-S3 / ESP-IDF 6.0.3 目标构建通过。本候选 `.bss` 95,968 B、`.data` 22,729 B、映像 1,647,898 B；不是实机堆/栈峰值。
- Audio 根包架构门禁、internal/audio 全部测试通过；本需求 API/真实 Mongo 回归及 backend_guard 通过（0 failures / 0 warnings）。全 gin/api 有 6 项失败，在未修改 master 同环境逐项原样复现：3 项依赖不同隔离数据库命名，3 项依赖旧认证/authority 测试前提。本轮未改这些产品逻辑，不声称全 API 包通过。
- iOS AudioLibraryBrowse 18 项、录音器/资产/账号隔离主机回归、完整 iOS 构建通过。完整 Swift 测试执行 5,034 项：22 跳过，10 个用例/12 处断言失败；同一组用例在未修改 master 原样复现，位于 CanonicalComposer 与 MobileRootSessionCacheInvalidationOriginalTests，与录音交付模块分开记录。
- PC 新增/受影响回归 252 项通过；typecheck 通过。全仓测试和最终安装包结果在下方补录。
- 第一轮 PC 全量 18,377 项通过；分页收紧后一轮 18,378 项均通过，但进程捕获一次 Tiptap 在 jsdom 卸载后的 `document is not defined`，不能把该次进程计为通过。未修改 dev 的对应编辑器测试独立重复 8 次未复现；保留该异常记录，不以猜测认定根因已经修复。

对应日志保存于本机 `/tmp/recording-final-*`。Audio/iOS 基线对照使用 `git archive` 的只读源码副本和隔离本地依赖，未切换任何业务 checkout。

最终源码在 Node 24 下执行 `pnpm test --maxWorkers=4`：1,604 个文件通过、32 个文件跳过；18,380 个用例通过、42 个跳过，退出码 0，无未捕获异常。耗时 220.67 秒。没有修改无关编辑器测试来压掉前一轮异常；保留前述不稳定记录，最终运行结果单独列明。


最终安装包 SHA-256：`5edacc507fca5528c6d947909bf2907253f0d7314301370ad49f81f0e81a7511`。4,279 个包条目通过路径/敏感配置检查，Host/UI/SDK bundle 未包含开发机绝对路径。由正式 CLI 安装到全新隔离 Profile，官方未修改 DSH 0.2.1-rc.2：真实 Agent 工具发现与调用、仓外公开 SDK 编译/调用/dispose、Chrome 列表展示及修改时间后读取、真实认证 Audio HTTP/Mongo 全部通过。

追加故障场景也通过：真实 Mongo 中的第三条录音接收完整且解码失败，单独令可选模型详情接口不可用；公开 SDK 仍返回 failed、audioDurationMs=null、durationFinal=false。没有以种子数据声称实际运行了声学模型。

两轮缺陷修复后重新沿 owner、调用者、取消与恢复路径复核，本轮已确认的问题均已闭环，未发现剩余的本需求代码阻断项。代码可进入合并/发布验收；物理链路与长稳边界仍以上述记录为准。审查修复保存在当前开发分支，未发布到远端服务或设备。

## 2026-11-17 时长复审与体验收口

外部审查指出的两项问题经代码和失败回归确认成立：Audio 仍以模型终态决定总时长是否确认；iOS/PC 文件列表未使用最终时长标志，与导入窗口含义不一致。完整接收且物理时长已知的录音无需等待 ASR，缺件录音不能因现有分段处理结束就显示最终总时长。

Audio 的最终时长现在依赖完整覆盖、原始回执数量与预期一致、所有分段物理时长已知。已有 SD 根源件/派生分段在同一事务提交，不新增状态、扫描或缓存。解码失败仍未知，ASR 失败不抹掉已知媒体事实，已知空录音仍为零。

根据用户体验反馈，没有采用“已确认部分”或“时长待确认”。PC 导入窗口和音频文件列表共用 `recordingAudioDurationLabel`，总时长只有数字或 `—`；iOS 同样仅显示完整总时长。`—` 不要求人工确认，也不声称系统正在计算。原状态栏继续表达同步、处理或失败。部分测量值仍在只读合同保留，Tools/SDK 不丢信息。

能力矩阵沿用原 Host owner：本轮只修正 Audio 已有字段语义与 UI 格式，无新增 Host/Tool/SDK 路由。共享 JSON 在 Audio/iOS/PC 完全一致。两种模型状态分别覆盖未结束、缺件、缺件收口、解绑、读投影数量不一致、部分时长未知、普通导入、SD 派生分段和已知零；真实列表/详情 API 结果一致。

- Audio 根包、internal/audio 全量、`TestAudioDelivery*` 与 backend_guard 通过。
- iOS AudioLibraryBrowse 19 项及完整 iOS 目标构建通过。
- PC 323 项相关回归、typecheck、build 通过；全量 18,383 项通过、42 跳过，退出码 0。测试中仍有既有 MaxListenersExceededWarning，未将其当作本轮新增业务缺陷或已修复项。
- 本轮不修改固件、上传协议或模型配方；没有生产部署或手机安装。

本轮安装包 SHA-256：`655e67b8b42b7a80057e75cf9c879a9311fedbcbaf20fc45b6ba9afaf1dea5b4`。4,281 个条目及 Host/UI/SDK bundle 路径、敏感配置检查通过。官方未修改 DSH 0.2.1-rc.2 全新 Profile、真实 Agent Tool、已安装 SDK 编译/调用/dispose、真实 Audio HTTP/Mongo 与 Chrome 两个文件入口验收通过：同一录音未收齐时显示 `—`，收齐且测量完整但 ASR 未完成时显示 840 ms，失败解码保持未知。编辑开始时间、失败详情缺失的原用例也通过。

中间执行记录：首次临时 Audio 测试进程在会话中断期间达到 Go 默认 10 分钟超时，不能计作产品失败或验收通过；精确清理该进程的三条本地 fixture 后，以显式 20 分钟测试超时重跑。第二次新增 UI 断言误选了文件名列，修正选择器后最终安装验收通过；未修改产品逻辑绕过断言。最后已停止临时服务并清理本轮种子数据。
