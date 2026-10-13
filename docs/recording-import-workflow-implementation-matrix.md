# 录音批次能力验收矩阵

日期：2026-10-13。任务分支 `codex/c20261013-recording-import-analysis`，插件版本保持 3.0.5。未提交、未推送、未部署。

| 能力面 | 实现入口 | 验收 |
| --- | --- | --- |
| Host owner | RecordingWorkflowService + RecordingService | 账号隔离、固定批次重放、UUIDv7 创建、DST 日界、精确版本、原始日界手动生成 |
| UI | 通知详情、录音总结/时间轴 | 原时区日界随查询/轮询保留；精确 ID 独立于本地日历；缺失结果不回退旧成功版本；空日历不遮挡有效历史结果 |
| SDK | recordingWorkflowCapabilities / recordingNotifications / readRecordingNotifications / recordingNotificationVersion | 类型与运行测试，仓外带空格目录 Consumer 从 tgz 安装包导入 |
| Tools | arkme_recording_notifications / arkme_recording_notifications_read | 正式注册、参数与写授权合同，共用 Host owner；官方未修改 DSH 中运行 |
| Audio | 批次接纳、通知事务、日生成协调、summary worker | 九个相关 package race 测试；真实隔离 Mongo/Redis/RabbitMQ；独占认领和重复投递不调用模型 |

业务结果由 Host 服务解释；浏览器和模型不持有 Audio 凭据。缺少后端能力时沿用旧上传，不增加灰度配置。

## 可重复的本地验证

使用 Node 24。插件执行 `pnpm typecheck`、`pnpm exec vitest run --maxWorkers=2`、`pnpm build`。仓外 Consumer：

```sh
node scripts/verify-recording-workflow-consumer.mjs /path/to/isolated/profile
```

该 profile 必须先通过官方 `dsh plugin --profile ... add -w artifact.tgz` 安装不可变产物。不得软链接源码或覆盖已安装 lib。E2E 使用本仓 `vitest.recording-workflow-e2e.config.mts` 与 `tests/e2e/recording-workflow.e2e.mjs`，要求环境变量 `ARKME_DSH_CHECKOUT`、`ARKME_PACKED_PROFILE`、`ARKME_E2E_TLS_KEY`、`NODE_EXTRA_CA_CERTS`，以及 `DSH_SNAPSHOT=replay`。证书和本地 HTTPS fixture 只用于隔离测试，不接真实账号/模型。

DSH 基线：官方 0.1.5-rc.2，提交 `fb2c4b9e698e30edb738bca4cf0618587db7d203`；源码未修改。外部 profile 模块回退由官方公开 `healProfilesModuleFallback` 准备。真实浏览器时区为 Tokyo，通知原时区为 New York；SDK、真实会话 Tool、通知详情与版本跳转依次验证。

## 验证边界

后端部署拓扑、真实模型付费调用、真实文件上传和生产规模容量尚未验证。本地服务端领域/事务测试与插件受控 HTTP 场景不能冒充生产端到端验收。自动队列隔离了手动 FIFO，仍共享模型、Mongo 与进程资源。发布前核实事务/索引成本及整套 API、cron、worker 的部署。

全量测试曾遇到原有 `app-migration` 与 `recording-presence-writer` 的墙钟时序失败，分别单独复验通过；未修改这些既有测试来掩盖失败。最终一次全量结果见交付记录。

## 最终交付记录

- 全量：946 个文件、11100 项通过，13 个文件/18 项既有跳过；没有新增跳过。最后跨 Host/浏览器时区修复后，相关 89 项再次通过。
- TypeScript 类型检查、完整构建与不可变 tgz 打包通过；版本保持 3.0.5。
- 仓外 SDK Consumer 编译和运行通过。
- 官方 DSH 安装后的真实会话 Tool + SDK + Chrome 页面场景通过（1 场景，Tokyo 浏览器打开 New York 原日期精确版本）。已检查截图。
- Audio 九个 package race 通过；事务下沉 datastore 和快照归位 repository 后相关 package 再次 race 通过，API/cron/summary 编译测试通过。backend_guard 与 OpenSpec strict 通过。
- 保留证据：`/Users/jotdev/senqisi/worktrees/c20261013-recording-import-analysis/validation`。最终 tgz SHA256：`54ec13dc776909c3d51a1a5fa16dc9d6fd950d99db07807831799918d4df8b04`。
- DSH 仓库保持 clean；插件 package.json、锁文件、根 README 未改；原用户 checkout 未改。

隔离依赖为本机 Docker Mongo 7 replica set、Redis 7、RabbitMQ 3.13；未使用生产凭据或调用真实模型。本结果表示本地实现与上述验证完成，不表示已部署测试服或生产。
