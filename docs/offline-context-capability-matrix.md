# 录音与聊天上下文：能力矩阵

本任务基于用户指定的 dev 基线 5daf7a0a，所有业务改动位于任务 worktree。后端事实归 Chat，原始录音归 Audio，附件和共享正文归 Record，推断归 Intelligent。插件只承接当前账号的安全投影和交互。

| 能力面 | 入口与授权 | 完成证据 |
| --- | --- | --- |
| Host owner | OfflineContextService；环境及账号隔离的不透明引用、当前权限复核、持久命令登记和结果核对 | 已接入，见下方验证与限制 |
| UI | 正式聊天时间线卡片、候选列表、原文、范围及重新关联、服务端冻结预览、分享和恢复 | 已接入，见下方验证与限制 |
| SDK | 公开类型与能力发现，调用同一 Host owner，AbortSignal 和 SDK 生命周期 | 已接入，见下方验证与限制 |
| Tools | 查询与修改分开；修改使用 explicit-user-write；分享必须先展示冻结预览并取得明确指示 | 已接入，见下方验证与限制 |

私有来源身份、录音地址、内部分享 token 不向浏览器、SDK Consumer 或模型公开。模型输入/附件中的指令按内容处理。无法确认的命令持久保留，缺失后端回执不解释为未执行。原录音权限与公共分享快照权限分开。

验收要求：单元/合同测试、独立 SDK Consumer、完整 typecheck/test/build、不可变 tgz 在未修改官方 DSH 的隔离 Profile 中安装和真实 Tools/UI 操作。真实 Tools/SDK 运行态已验证；真实浏览器 UI 尚未通过，不代表完整交付。


## 本轮验证记录

- 全量测试 11,960 通过、20 跳过；最新 UI 相关 433 项与消息选择器 3 项通过。typecheck、build、tgz 打包通过。
- 正式 `ArkmeLocalDatabase` 命令 journal 转发已覆盖。跨账号取消、冻结预览、Unicode 范围、未知写入结果、当前源复核、失效后清除详情均有针对性实现与测试。
- 最终 tgz 已装入未修改的官方 DSH 0.1.5-rc.2 隔离 Profile；真实 Agent 会话执行 `arkme_offline_context_read` 的 capability/pending 成功。
- 仓外 consumer 仅依赖公开 SDK，从当前安装包类型编译并调用真实 Host；未提供 Origin 时 403，正常调用成功。
- 后端 fixture 为纯合成 loopback 服务，没有真实账号操作。这是插件运行合同验证，不是五后端完整端到端验收。
- IAB 访问隔离端口被 `ERR_BLOCKED_BY_CLIENT` 阻止，Chrome 会话连接超时，正式浏览器 UI 的滚动/around/播放验收仍未完成。
- 证据：`/tmp/offline-context-plugin-tests-final.log`、`/tmp/offline-context-ui-final.log`、`/tmp/offline-context-dsh-runtime-final.log`、`/tmp/offline-context-sdk-consumer-final.log`。
