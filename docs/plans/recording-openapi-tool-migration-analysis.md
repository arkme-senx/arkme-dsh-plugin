# 录音工具迁移开放平台：代码核查与落地建议

> 本文保留为 2026-09-08 的分析记录。用户已明确要求一次性完整落地、不分阶段、不灰度；开发范围及选型以 [录音工具一次性落地开发方案](recording-tools-single-release-development-plan.md) 为准，本文的分批/可选迁移建议不再作为实施要求。

日期：2026-09-08。状态：分析提案，未实施业务代码、未提交、未发布。

## 结论与范围

应补齐开放平台的业务原子能力，最终删除插件中重复的录音模型工具。不是把旧工具原样搬到 OpenAPI，也不是简单放宽输出 Schema。开放平台负责公开契约和认证，Audio 等领域服务负责事实和业务规则；插件保留 MCP 生命周期及必要的 UI/SDK 适配。

第一目标是替代 `arkme_recording_days_list`、`arkme_recording_read`，并关闭后者向 AI 视频工具提供底层选择器的依赖。`arkme_related_recordings_read` 与 `arkme_ai_video` 也纳入最终替代清单，但不能因为名字相关就认为现有个人录音查询已覆盖它们。本文不将其他插件业务工具、整套录音 UI 或摘要生成能力自动纳入本次实施范围。

替代标准是用户业务任务可完成，不是旧工具每一个字段都必须复刻。比如旧 days 工具在 prompt 中承担日期发现，现有 query 已能完成；它额外带出的未查看计数不能仅因“原来有”就成为新 MCP 的必需能力。需要区分真正的能力缺口和可退休的历史接口形状。

## 最新基线

各仓任务分支均为 `codex/c20260908-recording-read-schema-rca`。本轮 fetch 后，干净且没有自有提交的插件、Audio 任务 worktree 已执行 fast-forward；未操作原始业务 checkout。

| 仓库 | 远端基线 | 本轮检查前 | 当前 HEAD |
| --- | --- | --- | --- |
| arkme-dsh-plugin | origin/dev | 落后 10，领先 0 | 6d87f1b643d460ce1c361b6800d7c9dcc4b5d643 |
| jotmo-audio | origin/master | 落后 1，领先 0 | 069ad0dac00c2b4dd6a62c8686339294997526ff |
| jotmo-openapi | origin/master | 已一致 | 588168534af25677ef54a4e0c9489d59e2a3259c |
| jotmo-meta | origin/master | 新建最新任务 worktree | f28fa725db7787d85b231895b27f39d2523835fd |

核查时各任务分支相对对应基线均为 0/0。插件新增提交主要涉及侧边栏本地缓存及导入反馈；Audio 最新提交优化录音游标索引扫描；二者没有完成本次工具迁移。源码已合并不等于生产已部署，更不等于用户 11 的实际 DSH 会话已发现并获权调用相应工具。

## 原问题为何仍在

- 插件 `src/tools/business/recordings/index.ts:81` 的逐句投影输出 `session_id`、`child_id`、`asr_item_index`、`transcript_source`。
- 同文件 `:267` 的 transcript 输出 Schema 设置 `additionalProperties: false`，却未声明这四项；`:347` 又以 oneOf 包装三类结果。因此非空逐句结果不匹配任何分支，空结果可能正常。
- 当前 `tests/recording-agent-tools.test.ts` 直接执行工具并断言对象，没有经 DSH 注册后的输出验证。甚至有测试要求这些底层选择器存在。测试通过不代表生产调用契约成立。
- `src/tools/prompts/business.ts:29` 仍指示模型优先调用旧工具。`src/tools/registry/registrar.ts:189` 仍注册本地工具；开启 MCP 不会自动去重或替代。

应区分三个层次：直接故障是 DTO 与 Schema 不一致；架构问题是插件重复承载业务读取、来源选择和底层参数传递；防回归缺口是缺少经真实工具边界执行的输出合同测试。迁移要同时关闭三项。

底层数组位置和 ASR 提供方选择不应成为通用逐字稿读者的必需知识。但公开业务 UID 不等于不当泄露：OpenAPI `internal/publicid/types.go` 已明确把 `recording_uid` 等定义为稳定业务标识。应保留既有公开 UID 和权限合同，不为隐藏所有 ObjectID 新造一套引用体系。

## 当前覆盖矩阵

现有 MCP 名称在 DSH 里使用 `mcp__arkme__` 前缀。下表的“拟补”均不是已经存在的能力。

| 用户能力 / 旧工具 | 最新开放平台能力 | 替代结论与缺口 |
| --- | --- | --- |
| 按时间定位录音 | `query_recordings` | 可复用；支持时间重叠、升降序和分页，不搜索转写关键词 |
| 按已确认人物定位录音 | `resolve_recording_speakers` + `query_recordings` | 可复用；账号人物可直接使用已确认 user_ref，不能仅凭同名自动合并 |
| 已知录音的元信息/状态 | `batch_get_recordings` | 可复用；已知 UID 直接读正文时不必强制先调用它 |
| `recording_read(content=transcript)` | `query_recording_transcript` | 已覆盖规范逐句读取，但需明确来源迁移及长句无损读取；不再输出旧选择器 |
| `recording_days_list` 的录音日期发现 | `query_recordings` | 能定位录音，不等价于完整日历统计 |
| 同工具的按日时长、未查看计数 | 无完整等价项 | 若产品仍需模型读取这些统计，再补领域活动查询；不是日期发现的迁移前提，不能按某一页录音简单求和 |
| `recording_read(content=summary)` 的已保存摘要、多版本与状态 | 无 | 拟补已保存分析版本查询、摘要正文读取 |
| `recording_read(content=timeline)` 的录音 AI 事件时间线 | 无 | 拟补已保存版本查询、结构化事件分页；快记的 `query_record_timeline` 不是该能力 |
| `arkme_ai_video` 的录音片段创作、任务读取 | 无 | 需要公开片段引用以及视频创建/查询能力；必须关闭旧逐字稿选择器依赖 |
| `arkme_related_recordings_read` 的私聊相关/他人分享片段 | 个人录音查询不等价 | 需保留私聊关系、分享权限与片段摘要语义，单列迁移；不能用 speaker 条件代替共享可见性 |

录音原子能力及公开 DTO 证据：OpenAPI `internal/capabilitycatalog/recording.go`、`internal/recordingcap/models.go`。相关录音差异证据：插件 `src/services/related-recording-service.ts` 的私聊 source 校验、资格检查、共享片段数据；其请求实际进入 Chat 相关录音接口。

## 原子化边界与最小增量

原子化以“一次可复用的业务读取或业务动作”为单位，不以数据库表、内部处理步骤或前端页面为单位。定位、读正文、读既有分析、创建任务应解耦；不要再提供一个 `content/action` 无所不包的工具，也不要为“最新”“今天”“总结报告”分别造工作流工具。

建议保留现有四项录音能力，必需增量聚焦已有摘要与时间线；日历统计按真实消费需求选择。名称仅为提案，实施时遵循 catalog 命名合同：

1. `query_recording_analysis_versions`：按种类、日期/覆盖范围、生成状态查询已保存摘要或时间线的版本元信息。返回公开版本标识、种类、覆盖区间、时区、生成时间、状态；不返回正文或供应商路由。可用排序和 limit 表达最新，无须新增 latest 工具。
2. `read_recording_summary`：已知摘要版本即可分页读正文，使用固定结果形状；不隐式发起生成。
3. `query_recording_timeline_events`：已知时间线版本即可分页读结构化事件，保留标题、时间范围、描述、参与人等用户可见语义；不输出原始 evidence、提示词、内部模型路由和错误堆栈。
4. 可选 `query_recording_activity`：确有按日统计消费需求时，接受有界日期范围、显式时区，返回逐日业务时长。未查看计数是否对模型开放按产品语义决定。复用 Audio 既有统计规则，不返回内部未查看 session ID 列表。不能用这一项阻挡已经具备等价能力的日期发现迁移。

同一份版本元信息可以共用领域读取。summary 和 timeline 正文形状确实不同，分为两个公开读取能力能保持 Schema 明确；不必复制成两个独立事实模型。需要保留版本选择和正文续页，但无须把当前所有 UI 操作一起开放。

Audio 的 `AudioSummary` 已覆盖一天总结、时间线、联系人片段等派生结果，包含 `DateStamp/TzOffset/FromStamp/ToStamp`。一天分析可能跨多个录音，不能强行设计为每个 recording_uid 下的一份 summary。复用 `internal/summary` 的事实与查询，在 Owner 侧投影业务 DTO，不将 `gin/api/summary.go` 的 legacy 大响应直接透传到 OpenAPI。

## 完整性与可组合性必须先补齐

- 插件 `recording-service.ts:1049` 固定读取 system 分区；Audio 的 `recording_transcript_decode.go` 会按可读性选择规范来源，并保留必要人工身份事实。迁移应明确采用 Audio 的规范来源，不能为追求旧结果字面一致又复制一套来源算法。
- Audio `recording_transcript_page.go` 每句话最多返回 4,000 rune，然后游标推进到下一句话；OpenAPI 用 `truncated` 如实标记。当前属于有界读取合同，不是 Schema 错误，但尚不足以承诺完整逐字核对。应增加可续读的正文片段合同，或按公开话语引用提供无损续读；保留预算，并验证拼接无丢失/无重复。公开 v1 的改变需兼容评估，不能默默修改游标含义。
- `query_recordings` 的时间和人物筛选只负责选录音；正文目前始终是整条上下文。若要高效回答“中午到下午”，可在转写读取里增加显式时间窗，游标绑定筛选。不得自动继承上一步人物条件而删去对话其他人的话语。这是效率增量，不是现有正文端点完全不可用。
- 当前每页正文仍需构建并验证规范快照。最新列表游标优化不等于正文已经变为存储级流式读取，需以真实长录音验证延迟、内存和响应预算。
- `ready/partial/processing/failed/unavailable` 与正文截断是不同维度；模型不能把 ready 当作全部音频时段已经转写，也不能把空页当作没有后续内容。

## AI 视频与相关录音的收尾条件

四个旧选择器不是无用字段：插件 `src/services/ai-video-service.ts` 使用它们调用 Intelligent 的 preflight 和 jobs/create。这条依赖不关闭就删除逐字稿入口，会造成创作功能回退。

建议在 Audio 的规范片段上提供可公开传递的 `utterance_ref`/`segment_ref`，复用开放平台既有引用安全机制。它描述“用户选中的这一段”，而非 ASR 数组位置。公开引用与校验由 OpenAPI/Audio 的职责边界协作完成，引用须绑定当前账号、录音及规范版本；执行动作时重新校验可见性和版本，并由 Audio 解析媒体定位。不能把插件本机密钥生成的 UI itemRef 原样定为开放平台合同，也不能让模型用正文或同名说话人猜内部 selector。

视频侧建议按创建、按 ID 读取、筛选列表拆分公开能力；preflight 和 proof 是创建动作内部步骤，不必强迫模型拼接。创建保留明确写授权、稳定幂等键、可重试边界和当前账号权限。不得因为读取录音或摘要就自动启动视频任务。

这些调用目前进入 Intelligent，最终接口与媒体对齐实现需要在该 owner 最新任务 worktree 中细化。本轮已核对插件调用面，不声称完成 Intelligent 内部或生产行为验证。Chat 相关/共享录音同样需要单独核对 owner ACL 后扩展，不能归并进个人录音 owner 查询。

若分批交付，第一批可以迁移大部分只读能力，但必须如实标记“尚未完成旧录音工具全量退役”。完整删除 `arkme_recording_read` 前，视频的片段输入替代必须就绪；最终相关工具全量退役还要求 Chat 相关录音和视频 MCP 能力完成。

## 按仓落地与发布顺序

| 工作包 | 代码落点 | 完成条件 |
| --- | --- | --- |
| 1. 固化业务合同 | 最新 meta 的对应能力 specs/新 change | 明确版本、时间、正文完整性、身份权限、跨工具引用及退出旧工具的条件；不重做已合并个人录音查询项目 |
| 2. Audio Owner 增量 | `internal/audio`、`internal/summary`、现有内部 Owner 入口 | 已保存分析读取、规范转写续读与片段解析复用现有事实；统计按需求选择；无重复集合，无读取触发生成 |
| 3. OpenAPI 公共能力 | `internal/recordingcap` 或内聚的录音分析模块、catalog、REST/MCP binding | 同一个 Capability 同时服务 REST 和 MCP；只接受可信认证上下文；公共 DTO 不透传底层大对象 |
| 4. 依赖闭环 | Audio/OpenAPI 与 Intelligent；相关录音另对接 Chat | 视频用公开片段引用；共享录音保留独立 ACL；完成后才具备相关旧工具完整退役条件 |
| 5. 插件切换和删除 | MCP runtime/controller、工具 catalog/registrar、business prompt、测试、必要 UI/SDK 适配 | 模型只看见目标平台工具；删除旧定义及强制路由；同账号的会话与凭据隔离仍成立 |

先部署兼容的领域服务增量，再发布 OpenAPI 能力，最后发布插件切换。不能先删客户端入口再等待服务上线。旧 API 保持既有客户端兼容；回滚顺序反向，范围限定为新能力暴露与插件版本，不需回写或重建录音事实。

插件已有 `ManagedOpenApiMcpController` 和官方 MCP Client，不应再开发一套录音专用凭据/传输。`mcp-runtime.ts` 当前只以“挂载了任意 Arkme 工具”判定可用，不保证某组录音替代能力齐全。切换必须检查具体能力集合、支持契约及 DSH 实际可见/获权状态，而不只是 `ready`。

不建议永久双轨或仅在 prompt 里说“优先用新工具”。若灰度需要兼容开关，应针对完整能力组互斥注册，有明确下线条件；平台失败不能偷偷切回语义不同、且仍有 Schema 故障的旧入口。最终删除兼容注册和旧 prompt，不保留两套业务实现。

已有会话的旧工具名、旧游标和本机引用不可当作新公开协议继续解释。需明确重新发现/重新查询提示；发布前测试会话恢复与能力缺失路径。撤权、登出、账号切换仍应立即阻断旧会话执行。

## Tools / SDK / UI 覆盖

| 消费面 | 本次决策 |
| --- | --- |
| 模型 Tools | 必须迁移到平台 MCP，并通过未修改官方 DSH 的真实发现、获权、执行和输出验证 |
| SDK | 核对既有消费者；若暴露相同录音读能力，使用公开 typed adapter、版本探测和账号作用域，不依赖插件私有 Tool 或模型输出 |
| UI | 不随模型工具删除而误删 RecordingService；现有日历、播放、说话人编辑等场景独立保留。需统一读取时由 Host 调用同一公开 REST Capability，而非浏览器持有 Key |
| Host / 领域 Owner | Host 保留生命周期与凭据，业务事实与规范解析回到 Audio；REST/MCP 不实现两套业务规则 |

插件已有 `HttpOpenApiCapabilityGateway` 供 Team 使用，说明 UI/SDK 可通过受控 REST adapter 复用平台；当前还不是完整录音 client，不能声称录音 UI 已接入。模型 Tools 迁移不自动要求新增页面，也不自动删除所有 legacy 客户端端点。

## 验收与本轮证据边界

实施门禁至少覆盖：

- 非空/空转写、超过 4,000 字长句、多页、5 小时录音、正文预算、部分就绪、静音、缺失/损坏事实与明确错误。
- 跨日/时区、重叠时间窗口、多条录音、页大小变更、内容版本变化和过期游标；话语 speaker_index 仅限本页。
- 摘要未生成/生成中/失败、多版本、指定旧版本、长正文；时间线使用对应版本快照，不能混入另一版身份事实。
- 无权限、跨账号 UID/ref/cursor、分享撤回、MCP 未加载/缺具体工具、grant 拒绝、账号切换与旧会话恢复。
- 视频片段引用与实际媒体一致，读取不创建任务；创建重试不重复扣费或创建重复任务。
- 同一批样本走领域 Owner、公开 REST、真实 MCP、未修改 DSH 会话，逐层验证输出 Schema 和语义。只通过内部 execute() 不算 Tool 验收。
- 发布前以授权的用户 11 场景做只读回放，确认实际插件版本、工具列表/grant、生产 API 返回与 trace；不记录完整录音文本、密钥或内部选择器到诊断日志。

本轮最新源码基线已运行：插件 `recording-agent-tools`、`openapi-mcp-runtime`、`openapi-mcp-controller`、`openapi-mcp-manifest-source` 四个测试文件，68 项通过；OpenAPI `internal/recordingcap`、`internal/mcp`、`internal/capabilitycatalog` 三组通过（Go 缓存命中）。这些结果验证现有相关基线，不代表本提案已实现。

前序定位已在 DSH 输出校验中复现非空转写 Schema 失配；本轮确认最新代码仍有同一不一致。此前 Audio 测试因本地配置缺失未完成，本轮未声明补齐环境或重跑通过。尚无用户 11 的生产请求回放、实际新插件 MCP 验收或生产部署证据。此次唯一新增文件为本文档。
