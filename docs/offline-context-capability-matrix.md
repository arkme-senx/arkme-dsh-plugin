# 录音与聊天上下文：能力矩阵

本任务基于用户指定的 dev 分支，合并前已吸收最新基线 4b1ba7ba，所有业务改动位于任务 worktree。后端事实归 Chat，原始录音归 Audio，附件和共享正文归 Record，推断归 Intelligent。插件只承接当前账号的安全投影和交互。

| 能力面 | 入口与授权 | 完成证据 |
| --- | --- | --- |
| Host owner | OfflineContextService；环境及账号隔离的不透明引用、当前权限复核、持久命令登记和结果核对 | 已接入，见下方验证与限制 |
| UI | 正式聊天时间线卡片、候选列表、原文、范围及重新关联、服务端冻结预览、分享和恢复 | 已接入，见下方验证与限制 |
| SDK | 公开类型与能力发现，调用同一 Host owner，AbortSignal 和 SDK 生命周期 | 已接入，见下方验证与限制 |
| Tools | 查询与修改分开；修改使用 explicit-user-write；分享必须先展示冻结预览并取得明确指示 | 已接入，见下方验证与限制 |

私有来源身份、录音地址、内部分享 token 不向浏览器、SDK Consumer 或模型公开。模型输入/附件中的指令按内容处理。无法确认的命令持久保留，缺失后端回执不解释为未执行。原录音权限与公共分享快照权限分开。

验收要求：单元/合同测试、独立 SDK Consumer、完整 typecheck/test/build、不可变 tgz 在未修改官方 DSH 的隔离 Profile 中安装和真实 Tools/UI 操作。真实 Tools/SDK 运行态已验证；真实浏览器 UI 尚未通过，不代表完整交付。


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
