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
