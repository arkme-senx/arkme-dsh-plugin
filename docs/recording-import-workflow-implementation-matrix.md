# 录音批次能力验收矩阵

日期：2026-10-13。任务分支 `codex/c20261013-recording-import-analysis`，插件版本保持 3.0.5。已提交并推送任务开发分支，未合并、未部署。

| 能力面 | 实现入口 | 验收 |
| --- | --- | --- |
| Host owner | RecordingWorkflowService + RecordingService | 账号隔离、固定批次重放、UUIDv7 创建、DST 日界、精确版本、原始日界手动生成 |
| UI | 通知详情、录音总结/时间轴 | 原时区日界随查询/轮询保留；精确 ID 独立于本地日历；缺失结果不回退旧成功版本；空日历不遮挡有效历史结果 |
| SDK | recordingWorkflowCapabilities / recordingNotifications / readRecordingNotifications / recordingNotificationVersion | 类型与运行测试，仓外带空格目录 Consumer 从 tgz 安装包导入 |
| Tools | arkme_recording_import_notifications / arkme_recording_import_notifications_read | 正式注册、参数与写授权合同，共用 Host owner；官方未修改 DSH 中运行 |
| Audio | 批次接纳、通知事务、日生成协调、summary worker | 九个相关 package race 测试；真实隔离 Mongo/Redis/RabbitMQ；独占认领和重复投递不调用模型 |

业务结果由 Host 服务解释；浏览器和模型不持有 Audio 凭据。缺少后端能力时沿用旧上传，不增加灰度配置。

## 可重复的本地验证

使用 Node 24。插件执行 `pnpm typecheck`、`pnpm exec vitest run --maxWorkers=2`、`pnpm build`。仓外 Consumer：

```sh
node scripts/verify-recording-workflow-consumer.mjs /path/to/isolated/profile
```

该 profile 必须先通过官方 `dsh plugin --profile ... add -w artifact.tgz` 安装不可变产物。不得软链接源码或覆盖已安装 lib。E2E 使用本仓 `vitest.recording-workflow-e2e.config.mts` 与 `tests/e2e/recording-workflow.e2e.mjs`，要求环境变量 `ARKME_DSH_CHECKOUT`、`ARKME_PACKED_PROFILE`、`ARKME_E2E_TLS_KEY`、`NODE_EXTRA_CA_CERTS`，以及 `DSH_SNAPSHOT=replay`。证书和本地 HTTPS fixture 只用于隔离测试，不接真实账号/模型。

DSH 基线：官方 0.1.5-rc.2，提交 `fb2c4b9e698e30edb738bca4cf0618587db7d203`；源码未修改。外部 profile 模块回退由官方公开 `healProfilesModuleFallback` 准备。真实浏览器时区为 Tokyo，通知原时区为 New York；SDK、真实会话 Tool、通知详情与版本跳转依次验证。

## 真实本地 Audio 链路

在配置了隔离 loopback Mongo replica set（数据库 `recording_import_test`）、Redis、RabbitMQ 的 Audio checkout 下运行：

```sh
JOTMO_AUDIO_CHECKOUT=/path/to/task/jotmo-audio node scripts/verify-recording-import-owner.mjs
```

Runner 使用 `process.execPath` 启动 Vitest、argv 启动 Go，创建带空格临时目录，输出独立证据路径；JWT 文件为 0600，不打印凭据。失败保留日志，结束停止所启动的服务，Audio 清理本次账号数据。Go fixture 拒绝非隔离 loopback 配置。编排 catalog 尚无本仓 target，已按仓库原生入口补齐。

实际链路：React 导入界面选择有效 PCM WAV → 浏览器与 Host 真实媒体探测 → Host 同源上传流及持久任务 → Gateway → 真实 Gin/JWT、Mongo 事务批次绑定 → 上传确认及封口 → Rabbit SD/ASR 任务 → Audio owner 处理、加密转写/对象提升/计费调用/说话人聚合 → 真实协调器 → 持久第一通知 → Rabbit summary worker 两次生成 → 持久第二通知 → SDK 查询/已读 → 通知详情跳转指定版本正文。额外断言未鉴权访问拒绝、模型调用前第一通知已持久化、最终恰好两条通知。

替身边界：JSDOM/XHR 提供浏览器传输适配；STS、OSS、Backend 计费、GPU 和 LLM 为本地确定性供应商。Audio API、领域处理、存储、队列、summary worker 与插件业务服务没有用模拟响应替代。此测试与官方 DSH 浏览器安装测试分别验证服务端业务闭环与正式宿主集成。

## 最终审核回归（2026-10-13）

- 插件全量：947 文件、11124 项通过；14 文件/19 项跳过。其中新增 1 项为上述 opt-in 跨仓测试，已单独实际运行通过；其余为既有跳过。
- 类型检查、完整构建、不可变 tgz 打包通过，版本保持 3.0.5；仓外 SDK Consumer 编译与运行通过。
- 未修改的官方 DSH 0.1.5-rc.2 `fb2c4b9e698e30edb738bca4cf0618587db7d203`，全新 profile 从 tgz 安装通过；SDK、真实会话 Tool 与 Chrome Tokyo 打开 New York 精确版本场景通过，截图已检查。
- Audio 九个相关 package race 通过；真实导入跨仓 Go fixture 另以 race 运行通过。backend_guard 分支检查与 OpenSpec strict 通过。
- 本轮关闭：混合空日期错误全成功、通知重试时间轴 DST 证据窗口错误、超时收口读取旧状态、历史 child 绝对时间重复叠加、Unix epoch 日界拒绝。
- 产物 SHA256：`98d4d0b829b9bc54e5249797ae6188eb3cfae85f1fc8f8d1a9a3f47311eaf26a`。日志、截图与 tgz 保存在任务交付的 `validation` 目录，绝对证据路径由运行结果给出，不固化开发者目录。
- 插件基线已同步最新 `dev@56b6b8b2`；DSH tracked 保持 clean，根 README、版本和锁文件未改，原用户 checkout 未改。

## 第二轮完整复核

- 基线同步为 `dev@284273d5`；对应 Audio 已同步 `master@86aaf77`，meta 为 `master@55190ed9`。
- 单条已读使用通知的 `id/sequence`；客户端回写也只更新观察到的版本。复用已有序号，避免通知恢复后新结果被旧点击读掉。API、Host、SDK、Tool 和 UI 合同同步，不新增配置或存储结构。
- Audio 12 个相关 package race 通过，包含新基线历史存储补报与计费回归；插件 948 文件、11150 项通过，14 文件/19 项原有 opt-in/skip 保留。两个跨仓 opt-in 场景独立执行通过。
- 跨仓正常场景实际点击总结与时间轴，并调用单条精确已读及全部已读；非法时间轴场景验证部分成功及正确按钮。组件测试覆盖已读期间同 ID 更新后最终刷新失败，更新结果保持未读。
- typecheck、backend_guard 与 OpenSpec strict 通过；最终不可变包、官方宿主和仓外 Consumer 的精确证据见任务交付 `validation/premerge2-manifest.json`。

## 验证边界与发布条件（继续有效）

本地测试不等于生产容量和真实供应商验收。尚未执行目标环境副本集事务/索引构建耗时与容量测量、真实模型付费调用、真实云对象上传、测试服和生产部署。自动队列隔离手动 FIFO，但共享模型、Mongo 和进程资源；发布前必须核对预算并完整部署 API、cron、summary worker；插件合同版本由代码自动协商。没有新增业务灰度开关，没有做历史回填。结果支持本地代码合并审查结论，不构成“线上绝无影响”的保证。


## 协议收口与最新 dev 合入

- UI、SDK、Tools 继续共用 RecordingWorkflowService。Audio HTTP 合同明确 contract_version=1；UI/SDK/Tools 调用者无需手填版本，由 Host 统一发送与验证。
- 无版本/不同版本不会启用批次，鉴权错误和服务故障仍保留错误。已固定批次经 import-batches/new-session 原子接纳；路由消失不回退普通创建。
- 通知集合收窄为 recording_import_notification，与固定成员/调度锚点 recording_import_batch 区分；没有通用消息平台或第三个集合。
- 合入 dev 8fea8859，保留上游日历/Markdown/底部操作区。冲突解决保留精确通知版本及原日界；关联 UI 86 项、导航 12 项、Host/网关/导入对话框 169 项通过。后端 12 包 race 和跨仓实际上传/后台执行通过。

最新 dev 合入后全量回归：951 个文件、11183 项通过，14 个文件/19 项既有跳过；类型检查通过。跨仓成功与非法时间轴两条链路均通过；最终安装包证据另见 meta 合并前审查记录。
