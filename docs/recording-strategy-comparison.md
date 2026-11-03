# 首次处理策略与独立对比

## 合同

- PC 新文件导入、麦克风录音不再读取或传递策略；Audio 统一固定 `v2026-10`。旧客户端参数继续接收，但不再决定新正式任务算法；已接纳任务的恢复与重试保留原身份。详见 [PC 录音处理版本](recording-version-display.md)。
- 首次选定方案的结果保持正式身份；另一方案只进入独立结果集合，不能替换正文、身份绑定、总结或后续 AI 数据。
- 音频文件操作菜单 → 策略对比，双列查看、分页和播放。说话人编号各自局部，同号不表示同一个人。
- 原件资格由服务端上传确认时间起算 48 小时，并检查实际存储存在。前端不凭录音日期猜测；过期隐藏新处理按钮，保留已有结果。正式失败不无限轮询，重试仍进入原上传任务。
- 豆包增强的既有“对比”不复用本入口。

## 桌面旧版上传协议兼容

- v1 桌面原生上传仅接受既有请求头。新任务不读取账号设置、不发送策略头、不登记策略；仅恢复旧已提交队列时，保留原 `recordings.import.strategies.register` 登记，保证重试身份。
- 插件接收文件时优先采用该任务已保存的策略。排队、页面恢复、Host 重启和重试不重新选择策略；同一编号改变策略会被拒绝。登记保存失败时不发送音频。
- 浏览器上传和 SDK 的旧显式参数继续兼容接收；独立策略对比仍使用显式策略，正式结果身份不变。

## 能力矩阵

| 消费面 | 入口及 owner | 验证 |
| --- | --- | --- |
| UI | 当前版本只读标记；`RecordingStrategyComparison`；同源 Host 路由 | 实际打包安装的官方 DSH 浏览器：打开两列、启动另一策略、播放、关闭、原件过期后保留结果；仓内覆盖处理中、失败、重试与空源件 |
| Tools | `arkme_recording_strategies` 读；`arkme_recording_strategy_start` 写 | 正式 Agent preset/tool 注册；写工具接既有会话确认，确认前无请求，确认后调用成功；对比输出是不可置信的业务数据 |
| SDK | `recordingStrategies`、`importRecordingFile.strategy`；`recordingStrategiesV1` 能力 | 仓外 Consumer 从安装的 tgz 编译及调用，覆盖旧 Host 拒绝；实际 SDK 读取隔离 Audio wire fixture |
| Host | `RecordingStrategyService`；读写路由分开 | 会话/源件/条目/游标均为当前账号作用域的不透明引用；跨账号、参数混用、请求后换账号拒绝；不暴露桶、凭据和正式身份修改引用 |

## 验收运行条件

插件任务起点 `5be2847e6a7f59084d46ede044775c1ab4009998`；继续既有 `codex/c20260910-allday-audio-implementation`。参考并运行未修改的官方 DSH 0.1.5-rc.2，ref `fb2c4b9e698e30edb738bca4cf0618587db7d203`。通过官方 CLI 将不可变 tgz 安装到新的临时 `DSH_HOME`，不修改 DSH 源码或用户常驻 Profile。

- `pnpm typecheck`、`pnpm build`、完整 `vitest run --maxWorkers=2`。
- `tests/e2e/recording-strategies.e2e.mjs` + `vitest.recording-strategies-e2e.config.mts`：使用隔离 HTTPS Audio wire fixture、真实 Host/SDK/Agent/Chrome 和实际 Opus 播放，**不是云端模型链路 E2E**。
- `scripts/verify-recording-sdk-consumer.mjs`：仅从安装包解析公开 SDK，测试目录含空格。
- Audio 另以本机真实 Mongo 事务验证模型结果入库、恢复、清理和正式结果隔离；SD/ASR 另跑真实音频、模型和 Opus 包回归。

本轮实际桌面运行环境是 macOS；没有据此宣称 Windows/Linux 实际运行已经验收。本轮未触碰常驻插件、测试服或生产。
