# DPK-02 模型执行接入矩阵

基于 dev 的原模型面板、录音生成卡与探索模型控制实施，不调整插件版本或 DSH 源码。

| 能力面 | 实施合同 | 验证要求 |
| --- | --- | --- |
| UI | 原录音弹窗按总结/时间轴读取及保存偏好；原失败卡区分继续本任务与创建新版本 | UI/Host 合同与实际页面验收 |
| Tools | 正式业务 Tool 提供模型查询、明确授权的选择/生成/继续；沿原 explicit-user-write grant | 未修改 DSH 会话发现、调用与失败验证 |
| SDK | 公共 recordingAnalysisV1 能力发现及账号作用域的类型化调用 | 仓外 Consumer 编译、调用和旧 Provider 拒绝 |
| Host owner | RecordingService 统一执行校验、账号检查、模型偏好、生成及续行；SDK/Tool/UI 共用 | 相同响应和失败测试 |

费用、供应商凭据、幂等和结果恢复均由现有后端积分网关拥有。生成新版本和继续旧版本使用不同命令；继续不得重新读取模型偏好或重建转写。新生成必须携带目录返回的不可变模型绑定。

验收记录（2026-11-04）：

- Tools：不可变安装包通过官方 CLI 装入独立 Profile，未修改的官方 DSH v0.2.1-rc.2 会话完成工具发现、模型查询、未确认阻止写入、后续真人消息确认后继续原版本。正式注册器覆盖 select/generate/continue；非用户消息及改变账号参数不能沿用确认。证据 `dsh-session-acceptance.json`、`plugin-confirmation-binding-third.log`。
- SDK：仓外 Consumer 仅从公开 SDK 导入，完成类型编译、HTTP 查询、原版本继续、旧 Provider 拒绝及 dispose；SDK 合同测试验证新生成完整传递绑定。证据 `sdk-consumer-final-compile.log`、`dsh-probe-delivery.log`、`recording-analysis-sdk.test.ts`。
- UI：Chrome 实际挂载本次原 `UnifiedModelPicker`，验证同名供应商独立、无报价原因及禁用确认；录音页面测试覆盖新版本/继续、总结/时间轴分离、进行中与失败恢复。证据 `model-picker-current.png`、`model-picker-unpriced.png`、`plugin-confirmation-binding-third.log`。
- Host owner：三面均进入 RecordingService.recordingAnalysis；验证账号在两层适配之间切换时拒绝写入，缺少发布绑定时不读取材料或写入，继续成功后的暂时读取失败保留已接受回执。

安装包版本保持 3.0.48，交付包 SHA256 为 `3092c35825c6b361a8e5c83ac4ca7c86781a3065f208f34d513510c494275a31`。验收使用合成 owner 和模型响应验证框架/授权/传输；实际业务及账务由独立后端测试覆盖，未连接真实账号或供应商。真实运行环境为 macOS；本次不改变原生依赖、凭据或进程实现，不声称已完成 Windows/Linux 实机验收。Profile 安装保留现有依赖声明产生的 peer warnings，具体解析结果见安装日志。
