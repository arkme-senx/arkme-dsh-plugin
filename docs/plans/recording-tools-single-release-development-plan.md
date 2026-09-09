# 指定时段录音报告：代码复核后的开发方案

日期：2026-09-09。状态：代码已提交并推送任务分支，已同步最新 dev 并完成本地合并前审查及浏览器联合复验，尚未合并或发布。最新命令、修复及验收边界见 Meta 同任务 change 的 premerge-review.md；首次实现记录见 verification.md。

本轮能力覆盖：Tools 必须验证官方 DSH 发现、授权、调用与旧名称拒绝；Host 复用平台 MCP 与 Audio Owner。UI 不增加页面或 Host API，保留原有录音工作台；SDK 不新增独立产品能力，保留既有共享服务合同。两者的现有行为回归均纳入测试，不为本次工具替换新增消费入口。

本次补充已生效：业务内已有日总结/时间线只属于派生参考材料，不是外部 Agent 本次分析结果；两个被替代的插件内置录音工具必须真正退役。此前关于保留旧入口兼容的方案撤回，不再作为实施依据。

本文件是本任务唯一的现行开发方案，替代前版“三项新增分析工具”及更早的扩大范围方案。交付采用一次完整开发、联合验收和发布，不做灰度，不建立新旧服务自动回退。服务部署依赖顺序不等于分阶段交付。

## 1. 审查结论与真实目标

目标仅为：用户要求根据指定日期、时段的线下沟通录音制作报告时，Agent 能找到正确录音，读取必要材料，核对原话，并交付有证据边界的报告。

前版方向正确，但不足以直接实施，需要纠正：

1. “找到同一天录音”不等于找到用户指定的那次沟通；日期、实际时区、时间重叠与内容确认缺一不可。
2. 开放平台已有规范转写查询，但单句话语超过 4,000 Unicode 字符会截断，游标跳到下一句；“继续翻页即可完整读取”在当前代码中不成立。
3. 历史摘要和时间线是录音业务内已经保存的派生参考材料，不是每条录音唯一的子对象，也不等于当前录音的实时转写，更不是外部 Agent 本次分析结论。
4. 此场景需要读取时间线材料，不要求服务端提供精确事件检索。前版额外的结构化事件查询工具并非必要；它会引入历史格式、解析口径和身份映射的额外合同。
5. 仅改 prompt 不能等同于退役。本次必须从所有启用 Profile 的注册表移除两个旧录音工具；共享底层服务与旧模型入口分别处置，既有选择器依赖的最小适配纳入同次开发。
6. 本地代码已能解释截图中的输出校验错误，但尚未核对用户 11 当时实际部署的版本、调用参数和响应；不能将代码复现写成线上闭环。

确定开发量：复用 3 个现有能力、扩展 1 个现有能力、新增 2 个原子读取能力，加上插件接入、旧入口退役及必要的既有依赖解耦、文档和测试。不新增报告生成工具。

### 材料、参考与结论的边界

- 录音元信息与规范转写是基础业务数据；ASR 本身也可能识别错误，不能称为绝对真相。
- 业务内已生成并保存的日总结、时间线，是另一维度的派生参考材料。它们可以帮助定位线索、提供概览，但可能遗漏、过时或推断错误。
- 外部 Agent 根据当前用户问题、工具取得的数据和证据缺口形成自己的分析；不能将业务总结改个标题当成本次分析，不能因 summary 已生成就宣称结论可信。
- Agent 的推理责任不意味着可无视证据；关键事实、数字、承诺和原话应核对更直接的材料，矛盾未消除时明确披露。
- 业务总结的读取是可选支路，不是完成报告的先决条件；业务总结失败不阻塞本已具备足够转写证据的分析。

## 2. 证据和基线

本任务分支均为 codex/c20260908-recording-read-schema-rca，已独立建 worktree。2026-09-09 开始本轮实现及纳入消费条件适配时 fetch，任务 HEAD 与指定远端引用均为 ahead/behind 0/0（不代表后续远端不会更新）：

| 仓库 | 指定基线 | HEAD |
| --- | --- | --- |
| arkme-dsh-plugin | origin/dev | 4b70c9cc412b711b7688a9f3c7978f90d8f068e3 |
| jotmo-audio | origin/master | 069ad0dac00c2b4dd6a62c8686339294997526ff |
| jotmo-openapi | origin/master | 588168534af25677ef54a4e0c9489d59e2a3259c |
| jotmo-meta | origin/master | f28fa725db7787d85b231895b27f39d2523835fd |
| jotmo-intelligent（仅现有消费条件适配） | origin/master | 76eb40dbffcc2d530f0171185a3a5de4fc464803 |

这是任务 worktree 的最新性，不代表用户原业务 checkout 已被更新；原 checkout 的分支和脏改动未被调整。

下表记录改动前故障证据，旧工具源码现已删除，测试和提示词已替换，不代表当前实现仍保留这些问题。

| 证据文件（基线各仓库内路径） | 已确认事实 |
| --- | --- |
| 插件 src/tools/business/recordings/index.ts | transcriptModelItem 返回四个定位字段，TRANSCRIPT_OUTPUT_SCHEMA 未声明它们且禁止额外字段；外层是 oneOf |
| 插件 tests/recording-agent-tools.test.ts | 当前测试直接调用 execute；非空转写测试还明确要求保留这些定位字段，没有覆盖实际 Host 输出校验 |
| 插件 src/recording-presentation.ts | 时间线同时支持历史 JSON 和 Markdown，且无时间标题时会做展示兜底 |
| 插件 src/tools/prompts/business.ts | 仍引导模型使用内置 days/read，并优先 daily_summary/timeline |
| 插件 src/openapi-mcp/mcp-runtime.ts | 已用官方 MCP Client；当前 ready 只证明挂载了任意 Arkme 工具 |
| OpenAPI internal/recordingcap、internal/capabilitycatalog/recording.go | 已有四个录音能力，均走 Capability + REST/MCP 双 Binding |
| Audio internal/audio/recording_read.go、recording_transcript_page.go | 已有独立规范转写读取；分页截断单句后推进下一句 |
| Audio internal/summary/models.go | AudioSummary 持有多版本派生文档；Answer() 会将解密失败吞成空文本 |
| Audio internal/summary/repository.go | 已有账号限定、半开时间重叠、稳定游标的分析结果查询基础，但现有投影仍带正文 |
| Audio gin/api/audio_agent_evidence_internal.go | 内部 Agent 接口含场景 scope、证据聚合和截断策略，不能直接转发成公开合同 |
| Audio gin/api/audio_related_recordings_timeline.go、summary.go | 时间线展示解析与冻结证据是不同概念；历史无冻结证据不等于生成失败 |
| OpenAPI docs/architecture/service-boundaries.md、docs/mcp/agent.md | Owner 单一、可信 Actor、公开游标、协议双绑定、按数据依赖组合而非固定流程 |
| Meta audio-summary-history-retention 及 recording-read-consistency | 日总结保留多版本；时间线允许删除；转写不继承列表筛选；读侧不得另造事实源 |

## 3. 问题分层：不能只补字段

### 3.1 直接故障

非空 transcript 输出含 session_id、child_id、asr_item_index、transcript_source，但 strict Schema 不接受；daily_summary/timeline 分支又不匹配 content=transcript，最终 oneOf 匹配数为 0。空 items 不触发子项校验，所以“空数据通过”不能证明合同正确。前轮已使用官方 DSH 校验逻辑复现该机制。

截图中的 limit 越界是另一项输入问题，不是同一个输出故障。需要让机器输入约束与执行校验一致，不能靠模型读完错误后猜数值。

### 3.2 架构和完整性问题

四个字段不都是秘密，也不是所有 UID 都必须隐藏。recording_uid 是平台已有的业务标识，可以公开；child_id、ASR 数组索引和来源层属于实现定位，不应成为新开放平台报告合同。旧入口确有消费者依赖它们，不能无条件删掉。

本次需同时修复：

- 旧模型入口的 Schema/实际输出不一致：本次通过退役该入口消除生产调用面，保留负向 fixture 解释原故障，不以修完旧入口后继续暴露作为交付。
- 新报告读取继续依赖插件展示投影的问题，改用 Audio 规范读侧。
- 当前公开转写无法续读被截断句尾的问题。
- 把生成完成、正文可读、分页读完、音频覆盖完整混为一谈的问题。

## 4. 最终能力清单

以下名称和路径已经在任务分支实现；尚未上线。

| 能力 | 动作 | REST POST 路径 | 职责 |
| --- | --- | --- | --- |
| query_recordings | 复用 | /api/v1/recordings/query | 按显式时段、可选已确认人物定位录音；不是正文搜索 |
| batch_get_recordings | 复用 | /api/v1/recordings/batch-get | 已知 UID 时按需读当前概览和状态，不设为正文前置条件 |
| resolve_recording_speakers | 复用 | /api/v1/recordings/speakers/resolve | 仅在用户按录音标记人查找且需要消歧时使用 |
| query_recording_transcript | 扩展 | /api/v1/recordings/transcript/query | 保留既有默认；新增显式时间窗与可无损续读模式 |
| query_recording_summaries | 新增 | /api/v1/recordings/summaries/query | 查询业务内已有日总结/时间线的版本元信息，只读参考材料目录 |
| read_recording_summary | 新增 | /api/v1/recordings/summaries/read | 已知 summary_uid，读取业务内已保存版本的正文，不执行新的分析 |

新增两个 Capability ID 分别为 recording.summary.query.v1、recording.summary.read.v1，EffectRead，继续归入 recording 领域及现有 Audio Owner 集成。summary_uid 对应既有 AudioSummary 的一个已保存版本，不创造通用分析文档、version 实体、latest API 或版本缓存。

公开中文名称分别为“查询已有录音总结/时间线”和“读取已有录音总结/时间线”。采用 summary 是对齐现有 AudioSummary 业务对象，kind 明确区分 daily_summary 与 timeline；不是将时间线当作日总结。避免 analysis/report/insight 等会让调用方误以为取得当前问题分析结论的名称。

不新增日期日历、关键词全文检索、报告生成、分析生成/重试、结构化事件检索等能力。现有 query_record_timeline 属于快记，不可冒充录音时间线。通话摘要属于另一个 Owner，也不能作为录音摘要替代接口。

## 5. 公开合同

### 5.1 query_recording_transcript：有界、可续读，不改变旧默认

输入：

- recording_uid、limit、page_cursor 保留。
- 新增可选 start_at、end_at：Unix 毫秒，半开时间窗；省略时仍读整条录音，单边条件可用；负值或上下界倒置拒绝。这些条件必须显式传入，不继承录音查询的人物/时间条件。
- 新增 text_mode：bounded 或 full，省略等同 bounded。
- bounded 保持原有每页最多 1–200 句、默认 100、单句最多 4,000 字符及现有游标推进语义。
- full 的 limit 表示本页最多返回的话语文本片段数，仍为 1–200、默认 100。每片最多 4,000 字符、整页正文最多 20,000 字符；达到任一预算即续页。是读取模式兼容扩展，不是灰度。

输出仍用现有单一对象和 utterances 数组，不再引入按模式切换的 oneOf。full 模式的每项额外提供：

- utterance_index：当前规范快照、筛选结果中的零基话语序号；同句话语的续片相同。不是底层 ASR 数组下标，不可用作业务写入选择器。
- text_start_offset、text_end_offset、text_total_length：同一句完整规范文本中的 Unicode code point 坐标，[start,end)。
- start_offset_ms、end_offset_ms 始终是整句话语相对录音的真实时间范围；不能按字符比例编造片段时间。
- speaker_index 仍只指向本页 speakers；跨页拼接不能直接复用这个索引。
- 原 truncated 继续表示当前项没有容纳整句话语；full 模式用坐标和下一页补齐，不将它改写为“后文不可获取”。
- full 片段不得 TrimSpace 或重排换行；纯空白续片也要保留。OpenAPI 当前针对完整话语的非空白校验需按此模式调整，否则长文本拼接仍会丢字。

full 模式允许同句话语跨页；私有游标记录规范快照版本、筛选后话语位置和字符偏移。OpenAPI 包装并绑定 Actor、Capability、recording_uid、模式和时间窗；limit 不绑定。默认 bounded 的绑定规范化保持旧序列化，旧游标继续有效。

话语按真实时间重叠选入，不做字级裁剪；返回跨界原句并保留真实范围。筛选后无话语只表示该窗无可读条目，不能据此证明静音。transcript_state 保持现有整条录音状态，不伪装成窗口覆盖状态。

源正文或说话人事实改变时拒绝旧游标，调用方从首重新读取；沿用当前 invalid-input 分类，不悄悄换源续页。游标结束仅证明当前可读快照读完；尚未封口、processing 或 partial 的录音仍不能称为完整录音证据。

### 5.2 query_recording_summaries：发现业务内已保存的总结/时间线版本

输入：

- kinds：可选非重复数组，daily_summary、timeline；缺省两者，不能传空数组。
- start_at、end_at：可选 Unix 毫秒半开范围，按文档原生覆盖范围重叠选择，不按生成时间过滤；校验规则同录音查询。
- generation_states：可选非重复数组，processing、completed、failed；缺省全部。
- order：asc/desc，缺省 desc，按覆盖 start_at、created_at、summary_uid 同方向稳定排序。它不表示“修改时间最新”，也不自动丢弃旧版本。
- limit：1–50、默认 20；page_cursor 沿用公开分页格式。

每项元信息：

- summary_uid：已保存 AudioSummary 的业务 UID，采用独立公开类型；每次精确读取都重新按 Actor 校验。
- kind、generation_state；content_origin 固定为 business_recording_summary，声明来源是既有录音业务内容，而非本次外部 Agent 的生成结果。该字段是业务来源信息，不是可信度评分。
- start_at、end_at：文档生成时登记的覆盖范围，不保证这段范围都有转写或属于本次会议。
- day_start_at：原文档自然日零点的 Unix 毫秒；用于解释日文档，不将它当作任意时区的日期字符串。
- created_at、updated_at：真实创建/更新时间；不得把 updated_at 伪装成生成完成时间。
- 可选 model_display_name：已有用户可见模型展示名；不透传内部模型 route/provider/prompt/token/原始报错。

返回 items、has_more、next_page_cursor。没有匹配版本是成功空列表，不推断录音不存在。元信息中的 completed 只证明持久化生成状态，不证明正文已解码验证；列表不为验证正文而解密整页。

列表是实时 keyset 查询，不承诺冻结快照；翻页期间新版本和生成状态可以改变。需要观察已知 pending 版本时直接按 UID 重新读取；需要重新确认“最新版本”时重新发起查询，不沿用旧列表游标推断最新。

查询仅覆盖 TimeLine(kind=1) 和 OneDay(kind=2)，不顺便开放联系人片段或 DailySemanticEvents(kind=4)。相同覆盖范围的历史版本分别返回，不聚合为一个“当前版本”。

### 5.3 read_recording_summary：读取业务内已有总结/时间线正文

输入：summary_uid 必填；limit 为每页正文 Unicode code point 数，1–20,000、默认 10,000；page_cursor 可选。不传 kind，真实类型由对象决定，不能改 UID 的类型。

输出：summary_uid、found、可读时的 summary 元信息、content_state、format、text、text_start_offset、text_end_offset、text_total_length、has_more、next_page_cursor。状态和格式仅在 found=true 时返回；不可读结果 text 为空、坐标为 0、has_more=false。

- content_state 为 ready、processing、failed、unavailable。processing/failed 根据生成状态映射；completed 但无正文为 unavailable；成功解码才是 ready。
- format 为 markdown、json、text；未知历史格式按不解释的 text 返回，不猜测 Schema。
- 正文保持同一版本的保存内容，不二次调用模型、不清洗改写、不混入另一版本。
- JSON 正文可能跨页，单页片段不是完整 JSON；接收者按坐标拼完后才能按原格式解析。Markdown 也不保证在自然段处分割。
- 游标绑定 Actor、Capability、summary_uid 和私有内容版本摘要；每页重新校验权限、类型、状态与内容版本。版本删除后 found=false；内容变更后拒绝旧游标，不能跨版本拼接。
- 不接受 body_offset 作为可随意跳页的外部存储坐标；客户端只回传现有不透明游标。
- 解密、解压、存储或 Owner 传输失败走现有 owner-unavailable 错误，不返回 ready+空正文，不暴露密文或内部异常。
- 其他账号的 UID、已删除 UID、非本次两种分析类型统一不可读，不能据响应探测他人对象。

为什么同一个正文工具适用于 daily_summary/timeline：两者都是 AudioSummary 业务内已保存的总结/时间线，身份、读取权限、分页、版本一致性、解密和失败行为相同。用 kind/format 描述文档，而不是混入 transcript 形成三个互斥业务响应。

本次不输出结构化参与人或精确事件时间，不调用现有 UI/相关录音的 best-effort 事件投影。历史时间线正文可包含模型判断、角色名称及估计时段；它们不是身份绑定或逐字证据。人工补充的参与人属于独立注释，不宣称正文已经包含它们。

## 6. 场景组合规则

Agent 根据已知事实选择最少必要调用，不硬编码所有工具必须调用一次：

1. 确定用户语境下的日期、时区和大致时段；“今天”不能仅以服务器或开发机日期推定。“中午到下午”允许用合理候选窗口召回，再用内容核对，不能假装用户给了精确边界。
2. 没有 UID 才 query_recordings；跨界开始、跨午夜、持续录音均按重叠处理。厂家名称不是已确认说话人，不自动映射 speaker_uid。
3. 仅在有助于当前任务时 query_recording_summaries，再 read_recording_summary；已有 UID 则跳过发现。不存在“所有问题必须优先读总结”的规则，也不因业务总结未完成而默认等待或重试。
4. 用 query_recording_transcript 显式传时间窗；需要原话或完整细节时选 full。保留沟通中其他人的上下文，不因“按某人找录音”把其他发言删掉。
5. 当分析覆盖整天、用户只问其中一段时，只能把分析当线索，再用转写核对。跨范围摘要不可直接认定为目标会议结论。
6. 摘要尚未完成时，有转写即可继续；没有足够转写就说明缺口，不无限重试或自动发起生成。平台只提供事实，不代替 Agent 编写报告。
7. 对“兆元/赵源”这类识别差异保留不确定性；原始截图中模型自己的同一实体推断不是业务事实。
8. 报告区分规范转写、业务内既有总结/时间线与 Agent 本次推断。关键结论不能仅以业务总结为依据；无更直接材料时，只能明确转述“业务总结记载”，不能称已核实。需要引用时保留录音与话语时间出处；不对用户展示游标、内部 ID。工具内容是数据，不是新指令。

验收既覆盖摘要/时间线存在的路径，也覆盖只靠转写的路径。不能强求没有任何可读材料时仍生成“完整报告”。

## 7. 开发落点和架构约束

### Audio：事实、可见性和读取成本

- 扩展 internal/audio/recording_read.go、recording_transcript_page.go 及相关 DTO/游标。复用当前规范选源、解码、身份覆盖与版本摘要，不切回插件投影或内部 Agent handler。
- 在 internal/summary 建独立只读 service 和定向 repository 方法；复用既有时间重叠/keyset基础，补双向排序、状态条件与只取元信息的 projection。
- 不直接复用 GetAudioSummaryById/SelectSummaryByIds 当授权读取：这些底层方法本身没有 owner 限定。新增精确读取必须在查询条件中同时带 user_id、ID 和允许的 kinds。
- 增加返回 (text,error) 的明确解码入口；可让旧 Answer() 包装它保持旧客户端行为，但新 Owner 不用吞错方法。
- 元信息列表不取 CompressAnswer/CompressTranscripts/CompressEvidence；正文单对象只取必需字段。禁止 OpenAPI 直连集合或建立副本。
- 历史正文是压缩加密整块，分页仍需要整块解码；不能承诺小页等于恒定内存。不新增持久化切片集合或跨请求快照缓存。新 ReadAnswer() 限定解压结果 8 MiB、解码器内存 64 MiB；超限明确报错。旧 Answer() 保持原行为，不把新预算套到存量业务。
- 检查现有索引，对新查询用真实 Mongo Explain 验证 owner/kind/范围/keyset与排序；需要的非唯一索引纳入现有启动建索引入口，不另造回填工程，不删除旧索引。
- 在 gin/api/audio_openapi_owner.go 对应体系新增 summaries/query、summaries/read 内部路由，沿用 /api/internal/v1/audio/openapi/recordings 前缀、内部服务凭据和可信用户上下文。
- 不把整个 audio_agent_evidence_internal 聚合接口作为 Owner API；只复用领域函数与仓储规则。
- 不修改现有日总结保留、时间线删除、生成和人工标记状态机；读请求不能触发生成、标记已查看或重试。

### OpenAPI：唯一公开合同

- internal/recordingcap：公开 DTO、输入/输出约束、Owner DTO/Interface、executor、游标绑定；两个新读能力继续走 TypedDefinition。
- internal/integration/audioowner/client.go：适配定向内部读 API；复用 ownerhttp 的认证、超时、大小限制和错误映射。
- internal/capabilitycatalog/recording.go：同一 Capability 的 REST/MCP 双绑定和枚举说明；公开表单、输出、机器合同从既有生成链更新。
- 日志只记录调用结果、耗时、页大小、内容变化/解码失败类别；不得记录正文、API Key、用户 Token、私有游标或内部异常明文。
- 外部 API Key 仅认证 Actor；内部调用使用服务间凭据，业务 JSON 不允许 user_id 覆盖身份。对象权限仍由 Audio 逐次裁决。
- 录音 UID、分析 UID 是业务标识；数值用户身份继续现有 user_ref；公开游标继续现有 Actor/Capability/结果集认证，不发明新 Ref 框架。
- 沿用 invalid-input、owner-unavailable 等平台错误映射；损坏正文不转成空结果，processing 不作为传输错误。REST 与 MCP 对同一输入有相同领域结果。

### 插件：使用现有官方 MCP，不新建录音 HTTP 客户端

- 从 src/tools/business/index.ts 的目录组合及全部 Profile 移除两个旧录音模块，删除其模型执行定义；更新 src/tools/prompts/business.ts、相关说明与示例，只引用实际 MCP 能力。共享业务 service 是否保留按真实调用者裁决，不能连带误删。
- 保留现有 ManagedMcpController 的账号/设备绑定、凭据管理、执行隔离和生命周期，不另建录音专用 Key 或手写 MCP 协议。
- 在现有 schemas()/tools/change 公开机制上判断本场景需要的具体能力及 full 参数支持；不要把“任意工具挂载成功”写成“录音能力齐备”。
- 该检查是能力发现，不是另一个权限系统，不要求把录音缺失升级为整个 MCP 连接不可用；Tools 仍走官方发现与 grant。
- 连接缺失/版本不支持时给出明确说明，不创建自动调用旧后端的 adapter 回退。不同材料可用时仍可依据证据完成报告，不一律阻塞。

### 两个旧模型入口必须退役

本次必须删除 arkme_recording_days_list、arkme_recording_read 的模型注册与执行入口，而不是标记 deprecated 后仍然可调用：

- business、hybrid 及其他启用 Profile 均不得发现这两个名称；不设置别名、开关恢复、隐藏自动路由或 MCP 失败时的旧链路回退。
- 新会话、恢复的旧会话都按当前工具目录工作；旧消息里的名称只属于历史文本。强行调旧名称时在分发层拒绝，旧业务读取调用次数必须为零。
- 同步移除提示词、例子、目录测试中的旧调用指引；删除只为这些工具存在的 wrapper/ports/游标代码。共享服务、UI、SDK 中仍有调用者的部分保留。
- 历史日志的呈现与重放不应触发业务执行；在目标官方 DSH 版本上验证升级/重载后旧注册已释放，不修改用户常驻实例做验证。
- 已运行的旧插件不会因新版发布自动消失。上线验收需确认实际安装版本和插件重载；用户 11 未升级前不能宣称其旧实例已排除故障。若需要强制旧客户端停止访问，那是额外客户端版本准入策略，不能误封共用 APP API。
- 不通过“先修 Schema 再把旧工具继续挂着”的方式代替退役；新平台合同仍要做完整的 strict Schema 验证，不能放宽所有字段绕过校验。

### 既有依赖解耦属于同一次开发

已证实的依赖是“旧转写输出的选择器被另一既有工具接受”，不是所有调用者都通过旧 Tool 名称调用服务。不能据此断言 UI/SDK 不能继续运行，也不能忽略 Agent 原有数据衔接路径。

处理约束：

1. 为这个生产者到消费者的真实场景建立先失败的契约测试，记录用户实际选中对象、规范来源、账号、版本与消费端最终拿到的片段。
2. 在原消费端及其已有 Owner 边界做最小取数/输入适配，使它不再通过旧录音工具获取分片 ID、ASR 索引和来源层；内部定位由业务服务裁决，不让模型猜测。
3. 不把 full 模式的 utterance_index 当旧 ASR 数组索引；不将无法证明相同的规范话语强行映射为旧来源，也不静默扩大选区。
4. 已实现 recording_uid + 完整原句 text/start_offset_ms/end_offset_ms。Audio 按唯一规范事实匹配现有素材投影并返回 Host 私有选择器；不新增通用转写字段。Child.StartAt 本身是相对偏移，已用原转写/增强转写真实 Mongo 测试验证，不能再减录音起点。
5. 这项最小适配与新平台读取、旧入口删除同批完成，不安排后续阶段，也不新增相邻领域的产品能力。需要改动实际消费 Owner 时按证据纳入最小范围，不能预先用“绝不改其他仓库”阻止依赖闭环。
6. 依赖场景未验证通过时，本次替代不允许发布；不能恢复旧工具作为验收兜底，也不能未经确认直接砍掉其他现有业务能力。

定位到消费之间存在并发更新窗口：Audio 同时返回内部 expected_fact_hash，固定录音 UID、原文及相对时间。插件必须透传；Intelligent 仅保留这个条件并绑定既有幂等/proof；Audio 每次素材读取在同次取数中重新比较，防止同一索引已变成另一句。没有新增 token 存储、锁、状态机或模型字段。原无条件 APP 选择及幂等键保持不变。测试覆盖原转写、增强 V3、非相同索引、跨账号和定位后正文变化。该最小闭环已纳入本次实现，而非后续阶段。

Tools 是强制验收面；UI/SDK 未被本次新增产品入口需求覆盖的部分只验证共享依赖不回归，不无故制造新页面或 SDK API。

### 文档与规格

- jotmo-meta：更新当前录音读取一致性合同，明确默认不变、显式时间窗、full 无损续页；补两项已有业务总结读取的范围、权限、状态与场景 AC。
- OpenAPI：同步生成的 REST OpenAPI、MCP 完整参考、枚举、示例和文档路由测试。Agent 指南补标识流转、JSON 分片、原始/派生证据边界，不复制第三份 Schema。
- 插件：更新相关使用说明和场景测试；不修改根 README、版本号及版本同步字段。
- 常规业务实现范围为 Audio、OpenAPI、插件与 Meta。仅为两个旧工具真正退役而必须进行的现有消费端适配，按实际 Owner 定位纳入同次开发；不进行整个相邻领域的迁移。

## 8. 联合验收清单

| 维度 | 必须通过的样本/结果 |
| --- | --- |
| 原始故障与退役 | 保留旧非空响应失配的复现 fixture；正式目录无旧工具，强行旧名调用拒绝且 Owner 调用为零；新转写非空响应经真实 DSH strict Schema 校验通过 |
| 输入合同 | 0、负数、超限、小数、非法枚举、倒置时间、错误游标；机器 Schema 与运行校验一致 |
| full 无损 | 中文、英文、emoji、组合字符；4,000 边界、超长单句、整页预算；按坐标拼接与规范原文逐 code point 相等 |
| 兼容 | 旧 bounded 请求/输出/游标继续成立；不同 mode/time/actor/UID 游标混用拒绝；同结果集变更 limit 可用 |
| 时间/身份 | 同日多场会谈、录音开始早于窗口、跨午夜、相邻边界、多人上下文、同名人物、不确定厂名 |
| 状态 | 无录音、未封口、processing、partial、failed、unavailable、可读空窗；不能以 has_more=false 代替完整性 |
| 分析版本 | 同范围多版本、新 pending+旧 completed、版本删除、非法 kind、跨账号；不自动选错或混拼 |
| 正文 | Markdown、历史 JSON、未知格式、长文跨页、空正文、坏密文/解压失败；错误不伪装成空成功 |
| 只读 | 所有公开读取均不触发生成/重试/已查看写入；元信息查询不读大正文 |
| 数据边界 | 分析覆盖全日而请求半日时必须转写核对；历史时间线只作派生材料，不伪造精确时间/身份 |
| 成本 | 元信息真实 Mongo Explain、有界响应、长文解码峰值、超时取消、Owner 响应大小；不以页小宣称存储成本恒定 |
| 双协议 | 同一业务 fixture 走 Owner、Registry、REST、MCP tools/list+tools/call，结果与失败语义一致 |
| DSH | 未修改官方 DSH、隔离 Profile、打包 tgz 安装，真实发现/授权/调用/输出校验，不仅直接 execute |
| 生命周期 | MCP 初始缺失、工具目录变化、账号切换、注销、重连；不使用旧账号凭据或污染其他工具 |
| 原场景 | 有、无业务总结均能按材料充分性工作；需要逐字核对时 full 获取证据；会话轨迹证实报告采用平台工具 |
| 参考材料定位 | 总结与转写矛盾、总结覆盖整天而只问半日、转写可能识别错误、仅有总结无转写；Agent 不机械采信、不把自己的结论当已有业务结果 |
| 依赖闭环 | 原有选择到消费的场景不再需要旧工具，精确对象/来源/权限/版本一致；没有新增底层字段泄漏或悄悄损失原有能力 |

本次不声称已检查全插件所有工具均不存在同类问题。门禁覆盖本次录音相关入口及平台对应能力；其他领域若复用相同测试盲点，只记录风险，不随意扩大开发。

## 9. 一次发布安排与完成标准

这是同一发布包内的依赖顺序，不是阶段交付：

- 完成 Audio、OpenAPI、插件、文档和测试的全部改动，再联合验收。
- 先部署兼容旧请求的 Audio，再部署 OpenAPI 与包含条件透传的 Intelligent，验证双协议目录和实际读取后发布插件。不存在只有新插件但 Owner 不支持的合法发布状态。
- 不回填分析正文、不改旧 UID、不迁移或删除业务数据、不引入灰度开关。
- 回滚方案必须保留旧工具禁用状态；不能回滚到仍注册问题工具的原始插件版本。发布前准备保留退役状态的可回滚构建，必要时让新录音能力明确不可用，再按依赖顺序回退 OpenAPI/Audio；保留非破坏性索引。可用性下降须如实说明，不以重新启用旧入口恢复表面可用。
- 用户 11 线上闭环需经已授权的只读证据入口核对实际版本、时间窗和调用结果；日志仅保留脱敏定位信息。未拿到现场响应前，报告“代码级根因及方案已核对，线上个例待复验”。
- 已完成实现、任务分支提交/推送及合并前审查；本轮补齐复用录音查询/说话人解析的机器 limit 上限，并在聊天页面验证 9 次真实读调用。主干合并、部署和发布未执行。

完整验收证据集中保存在 Meta 的 openspec/changes/c20260909-recording-tool-retirement/verification.md。基线曾缺测试配置，本轮已建立独立 loopback Mongo/Redis/RabbitMQ；不得把早期环境失败当成当前失败，也不得把通过本地测试当成线上用户 11 已完成升级。
