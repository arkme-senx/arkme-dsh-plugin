# World 接入能力矩阵

现有声音和分享建议 UI/Tools/SDK 均保留入口，后端按既有合同接入。本轮举报在既有更多菜单和六分类弹窗上扩展。

| 能力 | UI | Tools | SDK | Host owner |
| --- | --- | --- | --- | --- |
| 举报当前公开稿 | WorldReportDialog：原六类、500 Unicode 字、明确提交 | arkme_world_report；既有真实用户对话确认门禁及 explicit-user-write grant | worldReport；worldReportsV1 探测，AbortSignal、dispose，与账号绑定 | WorldService.worldReport |
| 核对未确认举报 | 原弹窗恢复被冻结载荷，“核对上次提交”重试原请求 | 同 Tool 的 pending/submit，继续使用原请求 | 同方法 action pending/submit/acknowledge | 同 owner + 原 StateStore 原子写入、原请求及收据保留到调用方确认接收 |
| 声音摘录 | 原选段、预览、发布和管理界面 | 原 sound-read / sound-write | 原 worldSoundExcerpts | 原 WorldSoundService |
| 私密分享建议 | 原建议分析、选模、取消、隐藏、发布入口 | 原 suggestions-read / suggestions-write | 原 worldSuggestions | 原 WorldSuggestionsService |

举报所有新写入只调用 World 统一公开稿入口，服务端 Record 冻结 principal 与版本并复用原队列。无旧非幂等写入降级。恢复数据属于本 Profile/account，私密资产 key 不进入浏览器、Tool 或 SDK。

验证记录：举报 Host/UI/真实对话确认及相关契约回归通过；新增 SDK dispose 用例通过。正式 Host 包装层曾漏转发恢复存储，已在首次真实 DSH 验收中发现并修复，采用正式 LocalDatabase 包装后的五文件 91 项回归通过，重新构建通过。

修复包保持版本 3.0.51，SHA256 为 `60a0dd9f07859397bc840564f62f485702d49cf1b04452c1464d3bcc5ee38700`。已在未修改的官方 DSH 0.2.1-rc.2 和全新 Profile 中，通过真实 Agent 对话确认并调用举报 Tool；实际 World 页面保留六类原因，在失败响应后关闭、重开、恢复同一请求并成功受理；独立安装的公开 SDK 调用同一 Host 成功。仓外 `.mts` Consumer 的类型、能力探测、原请求恢复、acknowledge、取消及 dispose 检查通过。该 DSH 场景后端为隔离 HTTP 夹具，不能替代真实服务联调；Record/World 的持久化、并发与权限由另行的真实 Mongo 测试验证。插件全量 1517 文件宽扫已通过：1491 文件通过、26 跳过；16761 用例通过、36 跳过。真实跨服务端到端仍需独立收口。

轻量复核补充：Host 收到成功不代表 UI 已收到成功。已确认收据仍保留在原请求旁，调用方观察成功后 acknowledge 才清理；这防止 UI 断开、重启后产生新的举报身份。acknowledge 无上游写入，且不能清理结果未确认的请求。

新增公开 SDK consumer：tests/consumers/world-report-consumer.mts；恢复资源后通过 scripts/verify-world-report-consumer.mjs 在不可变 tgz 的独立 Profile 执行，不能在源码目录直接冒充仓外验收。
