# 录音与聊天上下文：能力矩阵

本任务基于用户指定的 dev 分支，本轮最终基线为 dev 3f71352d（末轮仅新增消息标记测试夹具调整），所有业务改动位于任务 worktree。后端事实归 Chat，原始录音归 Audio，附件和共享正文归 Record，推断归 Intelligent。插件只承接当前账号的安全投影和交互。

| 能力面 | 入口与授权 | 完成证据 |
| --- | --- | --- |
| Host owner | OfflineContextService；环境及账号隔离的不透明引用、当前权限复核、持久命令登记和结果核对 | 已接入，见下方验证与限制 |
| UI | 正式聊天时间线卡片、候选列表、原文、范围及重新关联、服务端冻结预览、分享和恢复 | 已接入，见下方验证与限制 |
| SDK | 公开类型与能力发现，调用同一 Host owner，AbortSignal 和 SDK 生命周期 | 已接入，见下方验证与限制 |
| Tools | 查询与修改分开；修改使用 explicit-user-write；分享必须先展示冻结预览并取得明确指示 | 已接入，见下方验证与限制 |

私有来源身份、录音地址、内部分享 token 不向浏览器、SDK Consumer 或模型公开。模型输入/附件中的指令按内容处理。无法确认的命令持久保留，缺失后端回执不解释为未执行。原录音权限与公共分享快照权限分开。

验收要求：单元/合同测试、独立 SDK Consumer、完整 typecheck/test/build、不可变 tgz 在未修改官方 DSH 的隔离 Profile 中安装和真实 Tools/UI 操作。当前结论以文末 2026-10-19 复验为准：真实 Tools/SDK、Chrome 交互及合成 M4A 解码播放已通过；仍不等于真实录音模型效果与生产规模验收。下文保留此前失败和修复过程。


## 本轮验证记录

- 最终全量测试 12,050 通过、20 跳过；1,030 文件通过、15 跳过。typecheck、build、tgz 打包通过。Node 24，4 workers；默认并发一次发布夹具超时记录保留，未跳过失败用例。
- `OfflineContextService` 共用加密 journal：读 pending/result 无写副作用；明确 retry 使用原 route/body/requestId。UI“重试原操作”、Tools 修改权限和公开 SDK 类型均覆盖；重启、跨账号、分享原预览、回执淘汰后继续 unknown 有回归。
- 最终 tgz 装入未修改官方 DSH 0.1.5-rc.2 的隔离 Profile。真实 Agent 发现并执行 capability/pending/list Tools，读取原生后端关联成功。
- 仓外 consumer 只依赖公开 SDK，严格类型编译通过；真实 Host → Chat/Record/Audio/Intelligent/IM 链路中查询、确认、时间线、预览、分享、回执及撤回成功。
- 五服务均为原生二进制，DB/MQ 隔离；登录、搜索、外部模型和存储配置仍为合成依赖。关联由正式链路生成，源 ASR 为合成材料；这不是模型效果或实际音频播放证据。
- IAB 返回 ERR_BLOCKED_BY_CLIENT，Chrome 连接超时，实际浏览器的滚动/around/音频播放和完整交互仍未验收。组件测试不能替代该门禁，暂不能确认完整上线验收。
- 证据：`/tmp/offline-context-premerge-plugin-final-loop.log`、`/tmp/offline-context-premerge-runtime/dsh-final.log`、`/tmp/offline-context-premerge-runtime/sdk-compile-final.log`、`/tmp/offline-context-premerge-runtime/sdk-final.log`、`/tmp/offline-context-premerge-native-final.log`。

## 原设计一致性收敛（2026-10-16）

用户明确要求以同事已确认的 UI/交互为准，功能完整性不能成为重做体验的理由。对照交接时的 `OfflineContextCard` 和演示容器，本轮撤除自行增加的卡片外层展开按钮与字符序号输入：正式时间线直接加载并展示原卡片，范围仍通过“从／到”连续原文片段选择。CSS 未改。服务端冻结分享仍使用原来的标题、要点列表、原文勾选与确认弹窗。跨对话消息沿用下拉选择；共享撤回并入原有更多菜单，保留确认步骤。

必要补齐项不能伪称原设计已交付：跨对话选择、真实播放/原文读取、共享撤回、跨刷新未决请求恢复在交接文档中属于正式接入范围。本轮保留它们的最小入口与失败状态。明确“重试原操作”只出现在未知操作恢复状态；“核对状态”依旧只读，不隐藏写副作用，不改变请求 ID/原始预览。

相关回归验证直接显示卡片、恢复期间不自动写、连续片段选择与倒序阻断、签封消息引用分页、撤回确认与私人关联分离、服务端预览正文和原列表结构。真实浏览器工具本轮 `getState` 仍超时，不能由组件测试推断像素一致、实际滚动或播放通过。当前收敛不等于已满足全部上线门禁。

本轮复验：相关 5 文件 / 27 项通过；正式 `pnpm test --maxWorkers=4` 全量 1,030 文件 / 12,052 项通过，15 文件 / 20 项跳过；typecheck 通过。日志 `/tmp/offline-context-ui-preservation-focused.log`、`/tmp/offline-context-ui-preservation-full-pnpm.log`、`/tmp/offline-context-ui-preservation-types.log`。首次误用 npm 导致 5 项 pnpm 生命周期/打包测试失败，保留日志并用仓库正确命令完整重跑；没有修改测试断言来掩盖失败。

构建、tgz 打包及未修改官方 DSH 0.1.5-rc.2 隔离 Profile 安装通过；包内公开入口存在，已撤掉的字符序号控件不在最终 client bundle。日志 `/tmp/offline-context-ui-preservation-build.log`、`/tmp/offline-context-ui-preservation-pack.log`、`/tmp/offline-context-ui-preservation-install.log`。安装成功不计作实际浏览器交互通过。


## 第二轮复核补充（2026-10-16）

已挂载卡片写入返回 unknown 后，立即展示既有待确认/原操作重试入口，避免必须重进页面；原 requestId、Host journal 和只读核对语义不变，无新 UI 布局或生产接口。回归先失败后修复通过。

新增 `tests/offline-context-native-chain.test.tsx`，用真实卡片组件 → 公开 SDK → 官方 DSH Host → 原生五服务完成确认关联、冻结预览、确认分享、更多菜单撤回；断言否定语义、预览无副作用、分享/撤回后的原生状态和私人证据。测试通过（`/tmp/offline-context-review2-component-native-final.log`）。需显式传入 `ARKME_OFFLINE_CONTEXT_NATIVE_HOST`（隔离 loopback HTTP Host）和 `ARKME_OFFLINE_CONTEXT_NATIVE_CHAT`（新建合成会话名称，只有一个 suggested 条目）。不对真实账号执行；合成依赖不作为模型质量证据。

本轮正式全量 12,053 项通过 / 21 跳过（1,030 文件通过 / 16 跳过），原生链路测试已单独运行通过。日志 `/tmp/offline-context-review2-plugin-full.log`。上述组件操作运行于 React renderer，浏览器获取环境再次超时；实际页面、音频播放和完整上线门禁继续待验收，不以组件或 SDK 测试替代。


追加断网复核：Host 已登记但浏览器未收到响应时，现有“核对状态”只读查询 result 和 pending journal，再显示原请求恢复入口。失败复现与修复日志 `/tmp/offline-context-review2-transport-before.log`、`/tmp/offline-context-review2-transport-after.log`；无自动写、无新 requestId，不将无回执当作未执行。

## 2026-10-19 摘要分点修复

本轮是既有展示适配修复，不新增 Host 查询、命令或持久化能力。Chat 的换行摘要由现有 Host 投影恢复为卡片的要点数组；正式冻结预览同样逐点展示，原始冻结正文、签封引用、分享命令不变。单条、多条、空行/CRLF、Unicode 以及预览无写入和确认命令原引用均有回归。

| 能力面 | 本轮范围 |
| --- | --- |
| UI | 保持原卡片/分享预览的逐条列表及原有交互，无 CSS 修改 |
| Host owner | 现有响应的摘要展示投影；权限、版本、journal 与冻结正文保持原合同 |
| SDK / Tools | 继续消费现有 owner 和公开类型；无新增接口或操作，原生连接回归沿用现有验收 |

本轮门禁：局部 38 项、全量 12,668 项通过 / 21 项跳过，类型检查、构建和打包通过。产物通过官方 CLI 安装至独立 Profile 后，实际浏览器确认候选/确认卡片及冻结分享预览均保持两条独立要点；原生五服务 18 组验收通过。模型输出为合成，不声明真实模型质量；浏览器截图 `/tmp/offline-isolation-runtime/summary-preview.png`。


## 2026-10-19 完整链路复验与 M4A 根因修复

Audio 正式回听接口对既有 `.m4a` 切片返回 `audio/mp4`，Host 原白名单只接受 flac/mpeg/wav，导致 API 成功但实际回听被拒绝。先补回归复现，再仅增加 `audio/mp4`；保留 HTTPS、OSS 域名、签名、时间范围与账号围栏。没有修改 UI 组件、布局、按钮或交互流程，没有新增依赖和产品配置。

- `tests/services/media-service.test.ts` 新增 4 种合法音频格式和 6 种非法来源/边界回归；修复前仅 M4A 场景失败。
- Node 24 全量 12,678 项通过 / 21 跳过，1,079 文件通过 / 16 跳过；typecheck、build、tgz 和官方 CLI 安装通过。
- `tests/e2e/offline-context-native.e2e.mjs` 在未修改的官方 DSH 0.1.1-rc.2 与实际 Chrome 中完成：候选、回听、确认、原文、原样保存范围、冻结分享、撤回。Host 返回不透明 media ref，实际 M4A 解码得到时长并播放推进。音频字节为合成 AAC，精确对象存储适配器仅用于本地隔离环境，不等于真实 OSS/录音验收。
- 原生跨服务验收 20 组通过；真实 MySQL 计费发布/结算与自动事件去重通过；模型供应商为合成替身。
- 测试支持可选 `ARKME_OFFLINE_DSH_URL`，仅接受调用方管理的本地 HTTP 官方 CLI，先校验当前合成账号；未传入时仍使用既有 scaffold。固定测试配置，不新增运行时产品配置。源码 scaffold 缺少 loader 依赖的首次失败已保留，官方 CLI 路径通过，没有修改 DSH 仓库。
- 证据目录：`/tmp/offline-release-loop-20261019/`（`browser-cli-e2e.log`、`browser-share.png`、`sdk.log`、`acceptance-final.log`）；全量日志 `/tmp/offline-release-loop-plugin-full.log`。

测试服只读核查确认当前已发布目录 release 19 有 qwen-flash，但没有 qwen3.8-flash；未发现该模型历史 offering。真实数据候选存在，独立标注集未找到。没有改动测试服配置、开关或账号，没有把测试服与本地隔离链路混为一谈。


末轮同步 dev 3f71352d（只更新消息标记测试夹具）后，4 workers 重跑出现 4 个既有发布脚本测试的默认 5 秒超时；未发生断言失败。代码、断言和超时设置不变，1 worker 定向 26 项通过，随后 2 workers 完整重跑 **12,678 通过 / 21 跳过、零失败**（1,079 文件通过 / 16 跳过）。保留失败日志 `/tmp/offline-release-loop-plugin-final-base.log`、定向日志 `...-final-focused.log` 和最终全量日志 `...-final-low-concurrency.log`。本次基线合并没有改变已验证 tgz 的生产源码。

## 2026-10-19 原交互恢复与历史范围准入

本轮替换先前自行增加的顶部入口和候选弹窗，复用交接预览的内联待确认条、原卡片及消息侧“线下已讨论 ↗”。原文/回听使用现有确认对话框布局。共享小组件的 CSS 内联随组件注入，避免独立插件打包后裸样式。

| 能力面 | 实现与验证 |
| --- | --- |
| Host | 现有 list 增加 messageRefs，限制 100 个、账号/环境/会话校验、筛选范围绑定游标；Chat 复用现有来源索引 |
| Tools | 现有 arkme_offline_context_read 的 message_refs 接入同一 Host；官方 DSH 0.1.5-rc.2 真实 Agent 会话查询通过 |
| SDK | 独立仓外 consumer 仅 import 公开 /sdk，严格类型编译及真实 Host → Chat 消息筛选查询通过 |
| UI | 原待确认条展开/确认、消息侧标记和跳转、卡片实际浏览器验证；无顶部自造入口 |

不可变 tgz 在独立 Profile 中验收，不修改官方 DSH。UI/Host 局部 162 项通过，1 个原生环境用例在该局部命令跳过，真实原生链路另测。全量首轮 12,695 项通过，1 个 Arko 消息标记 UI 等待失败；原断言单独复跑 5 项通过，正式 pnpm 完整复验 12,696 项通过、21 跳过，零失败（1,081 文件通过、16 跳过）；见 Meta verification.md。

证据：/tmp/offline-idempotence-ui-tests-final.log、/tmp/offline-ui-final-full-tests.log、/tmp/offline-ui-final-mark-retest.log、/tmp/offline-ui-runtime/dsh-idempotence.log、/tmp/offline-message-sdk-compile.log、/tmp/offline-message-sdk-run.log、/tmp/offline-ui-runtime/ui-admission-final.png。截图含合成用户与合成录音文本；不作为真实模型效果或线上数据验收。用户 3081 实例未改。


## 2026-10-19 合并前复核：长对话定位

确认并修复两处同根问题：虚拟列表仅为消息行保留导航锚点，未挂载的线下卡片无法定位；缓存路径平滑滚动尚未结束就释放锚点，导致滚动停在中间。现在将 contextRef 映射到既有虚拟列表行，按现有 around 路径先同步定位再消费目标。不增加 UI 入口、弹窗、状态机或依赖。

- 单测先用旧行为复现失败，再验证修复；相关 429 项通过。
- 正式 pnpm 全量 12,698 项通过、21 跳过（1,081 文件通过、16 跳过），typecheck、build、tgz 打包与官方 CLI 隔离安装通过。
- 最终产物在实际浏览器中覆盖 180 条消息长窗口：卡片未挂载时点击消息标记定位；卡片和消息互在未加载分页时双向 around 导航；原待确认条、确认、原文及冻结分享预览与确认。
- 原生 Chat 验证同群其他成员不能读取私人关联，分享后只能读取分享消息，timeline 不泄露 offline_context 私有项。Tools 和仓外 SDK 已通过正式 Host 查询；导航修复没有新增 Host 能力。
- 本轮回听夹具返回 offline-premerge 测试桶，被正式域名白名单拒绝，错误在原卡片呈现；不计为成功播放，不放宽白名单。此前 M4A 合成播放证据见上节，不能替代本轮真实录音验收。

日志：`/tmp/offline-review-navigation-red.log`、`/tmp/offline-review-navigation-final.log`、`/tmp/offline-review-plugin-full-final.log`；最终产物 `/tmp/offline-review-final.tgz`，截图 `/tmp/offline-ui-runtime/ui-final-long-navigation.png`。均为隔离合成账号和数据，未修改用户 3081 实例。
