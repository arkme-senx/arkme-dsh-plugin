# 录音交付、接收事实与展示优化

本轮在 PC 插件 `origin/dev` cbddca489f09e84221c8cf417402b4e74b49cf2c 上开发。分支 `codex/c20261116-recording-delivery`。LC3 编解码与模型配方不在本轮变更范围。

## 业务链与职责

| 环节 | 本轮实现 | 保持的不变量 |
| --- | --- | --- |
| 盒端 | 同一个 I/O 执行器交替处理结束记录与音频，保留各自遍历位置 | 不抢占正在 PUT 的 8 MiB 分片；不新增并行 TLS、任务或音频缓存；提示丢失仍能从磁盘恢复 |
| Audio | 从源件回执、DeviceCapture 与既有模型阶段生成只读摘要 | 文件收到、真实结束、覆盖完整、模型完成互不替代；不增加持久状态机、集合或索引 |
| PC Host | AudioRecordingImportGateway 读取摘要和阶段，RecordingService 统一投影 | 普通导入和设备采集由各自已有 owner 解释；处理分段不充当原始上传文件 |
| PC UI | 接收状态、真实大小、毫秒时长、采集范围、跨天筛选和稳定正文恢复 | 本地字节上传进度不变；无总量不显示百分比；保留已读正文和完整导出的版本校验 |
| iOS | AudioLibraryBrowseService 消费同一摘要；原压缩开关和同步入口不变 | 盒端忙碌、本地上传字节与云端单条状态分开 |

## 公开能力矩阵

| 消费面 | 接口及 owner | 验证 |
| --- | --- | --- |
| Tools | `arkme_recording_delivery`，正式只读注册；当前账号，1–100 条分页 | 官方 DSH 0.2.1-rc.2 新 Profile 安装 tgz；真实 Agent 创建、工具发现和调用 |
| SDK | 公开 `recordingDeliveryPage` / `RecordingDeliveryPage`，`recordingDeliveryV1` 能力探测、AbortSignal、dispose | 从已安装 tgz 导入的仓外 consumer 编译、调用和 dispose 后拒绝 |
| UI | 原任务弹窗和文件列表继续使用现有 import owner；读取相同摘要与投影 | Chrome 实际页面：已收 3400 B、未知总量、等待结束、接收完整、840 ms、一分钟采集跨度 |
| Host | 新只读页与已有 UI 共用 gateway / `projectRecordingImportOwnerTask` | 账号变化丢弃响应；只读页不读本地任务、不触发恢复或上传 |

新只读方法不能直接转发 `recordingImportList`：后者属于 UI 恢复 owner，会续传本地待办。本轮只复用其云端查询/投影，没有把恢复副作用带到查询工具。

## 数据与展示合同

`delivery` 是 Audio 只读响应。`receivedSources/receivedBytes` 是真实原始回执，`expectedSources/expectedBytes` 未知时为 null。`endReceived` 仅对设备采集有意义。`coverage` 为 receiving / complete / interrupted；接收关闭但缺源件不等于完整，不能出现“重试转写”代替设备缺件恢复。

`captureStartAt/captureEndAt` 不随用户编辑时间变化；`displayEndAt` 按真实采集跨度平移。`audioDurationMs` 是已确认音频时长，`durationFinal` 表示总时长已确认。未知与已知零分开，840 ms 不取整为零。文件列表跨天筛选也使用采集终点。

模型处理大小不参与上传百分比。处理耗时弹窗明确包含排队等待，不代表网络传输耗时；保留独立模型耗时。未收齐的录音也读取已有阶段，不用等待录音结束才显示模型情况。

正文版本冲突每次恢复仍有两次预算；预算用尽显示更新中，由已有页面刷新 owner 再推进。普通鉴权、网络和删除错误仍按错误处理。对比面板保留正文并提供继续加载，不使共享 hook 的新状态成为无提示的停滞。导出不把部分正文当成完成。

## 回归与实际验收

- Audio 同一 JSON 样例由 PC / iOS 共用；真实 Mongo 验证原始源件归组、257 个处理分段、最小投影、128 条游标批次及账号隔离。
- 服务端保留旧导入恢复的 500 条请求上限，内部每 100 个会话读取一次摘要；超过上限明确拒绝，不静默截断。105 条录音回归防止恢复误判和重复创建。
- PC 208 项相关链路测试通过；工具目录及正式注册 68 项通过；正文/对比 25 项通过。后续增量见最终验收记录。
- 全量 Node 24 测试覆盖逾 18,000 项。遗留失败已用未修改 dev 源码同环境对照：账号资料测试 1 项、通话 fixture 13 项、架构快照 3 项，以及一个没有测试用例的 JS 文件。不能报告“全仓零失败”。本次新增工具的两处目录期望已更新并单独复验通过。
- tgz 实际验收脚本 `tests/e2e/recording-delivery-installed.mjs`；Audio 配套 `TestAudioDeliveryCrossRepositoryServer`。认证中间件、Audio HTTP 路由、仓储和 Mongo 为真实实现；身份服务和音频事实为隔离测试 fixture，没有运行真实模型或吊坠。

## 发布边界

无需新增产品配置、数据库迁移、索引或编码器资产。先上线 Audio 只读响应，再发布 PC / iOS；盒端调度使用原 Device 协议，可独立更新。`recordingDeliveryV1` 是能力声明，不是开关。

本轮没有生产部署、刷写或重新宣称模型质量、续航和物理断电验收。仍需以真机记录 USB 同步、源件 PUT/commit、seal 和模型队列各自时间，验证现场等待的改善幅度。新增 Audio trace 划分摘要查询、正文定位、内容读取与版本复核，不能据此直接宣称已修复此前 20 秒首屏耗时。


## 最终复验记录

2026-11-16，最终源码对应 tgz SHA-256：`e90e964ff036fd0fbbd680d807c482f5795ed60dff6cc4efafda4ff8a7c15c33`。包清单 4,273 项，无 .env / .npmrc / config.yaml / .git / 路径穿越；Host、UI、SDK bundle 均无开发机绝对路径。

- 最终官方 DSH 安装验收通过：真实 Agent 工具、仓外 SDK 编译/调用、Chrome 页面、真实认证 Audio/Mongo；增加了修改显示时间后重新读取的检查，确认不可变采集起点不变，展示终点平移两分钟。
- 最终增量复验 97 项通过：共享合同、跨天筛选、正文分页恢复、对比面板更新状态、工具注册和目录。
- 最后完整测试输出为 18,316 通过、19 用例失败、42 跳过，另有一个无用例文件。失败集合与原始 dev 对照，仅新增工具目录的两项期望差异；这两项更新后在 68 项工具回归中通过。剩余 17 个失败及无用例文件全部在原始 dev 复现，未改动无关产品逻辑。
- iOS 17 项 AudioLibraryBrowse 测试、录音器设备/轮询/音频资产主机回归、完整 iOS 构建通过。
- Station 18 组原生回归和目标固件构建通过。
- Audio 内部接收/转写相关回归、列表/详情 API、105 条恢复分页、旧 finish 不能绕过物理 seal、架构检查和 backend_guard 通过。

可复现入口：插件 `tests/e2e/recording-delivery-installed.mjs`；Audio `JOTMO_DELIVERY_E2E_DIR=... go test ./gin/api -run '^TestAudioDeliveryCrossRepositoryServer$'`。运行器参数使用环境注入官方 CLI、tgz、Playwright 和临时 fixture 地址；没有把测试机路径写入产品代码。
