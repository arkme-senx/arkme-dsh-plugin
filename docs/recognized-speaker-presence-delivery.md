# 已识别说话人全历史统计

本次延续用户指定的 dev 基线与任务 worktree。UI 布局、标记、搜索、筛选和导航保留；临时七天扫描替换为 Audio 全历史 owner。统计表示 system ASR 中已确认人物的出现，不能与声纹调用账本或授权目录混用。

| 能力面 | 接入方式 | 完成证据 |
| --- | --- | --- |
| UI | 既有已识别说话人列表与人物原始声音详情 | 原始布局实机验收；列表/详情统一全历史，版本变化刷新、非 fresh 数字隐藏、账号切换、卸载取消测试通过 |
| Tools | arkme_speaker_presence，只读列表/详情，不透明 Speaker 引用 | 正式 catalog/schema/grant 注册；官方未修改 DSH 0.1.5-rc.2 的真实 agent session 发现并调用成功 |
| SDK | recordingSpeakerCandidates/Presence/Members，speakerPresence capability，AbortSignal | 隔离安装 tgz 的仓外 Consumer，strict/NodeNext 编译执行；不支持 capability 与取消场景通过 |
| Host owner | RecordingService | UI/Tool/SDK 共用权限、账号绑定引用、字段校验与后端；服务测试和真实本地 Audio 联调通过 |

无新增配置项、版本号修改或旧服务七天回退。不改变既有 OpenAPI 转写读取的 owner；新 Tool 只暴露本目录统计，不提供第二套转写/日历读取接口。

## 验证

- Node 24.19.0；typecheck、build 通过。
- 全量：806 个文件通过、11 个跳过；9,460 条测试通过、15 条跳过；随后补充分页竞争用例，相关 UI 10 条通过。
- `tests/consumers/speaker-presence-consumer.mts` 仅导入公开 SDK。Consumer 在仓外、含空格目录，以 strict/exactOptionalPropertyTypes/NodeNext 编译并执行。
- `tests/e2e/speaker-presence.e2e.mjs` 经正式 CLI 安装的 tgz，使用官方 DSH 的公开 boot fallback 和原测试 Scaffold。统计转发真实本地 Audio/Mongo，鉴权及其他无关上游为隔离桩；列表和详情都返回 2 天、原始声音 12；正式取消接口使统计减为 1 天，再经原候选 UI 确认标记恢复 2 天；正式 Audio 软删除后隐藏统计，恢复后重新显示 2 天。
- E2E 需要 `ARKME_DSH_CHECKOUT`、`ARKME_PACKED_PROFILE`、仅允许 127.0.0.1 的 `ARKME_AUDIO_E2E_ORIGIN`、测试 TLS key/cert 与固定种子账号。它不在默认单元测试中访问真实服务。
- DSH 源码、用户 Profile、常驻 DSH、插件版本、根 README 未修改。tgz 的旧 peer 自动安装在当前 registry 不完整，隔离安装关闭自动补齐 peer，并通过官方 `healProfilesModuleFallback` 接入运行时已有依赖；没有手写运行时软链或产品 fallback。

## 运行边界

后端先更新全部源写入进程及清理 cron，再发布本批插件。后端未就绪会显式失败，不返回近七天数据冒充全历史。统计版本校验为读取观察到的完整版本，不承诺数据库事务快照。

Audio 热读仍为 O(Child + 摘要桶)，本地五次采样约 8,760 分片 130–206ms、52,560 分片 0.99–1.36s、525,600 分片 11.31–19.89s。不是 P95；高密度性能是发布前需按实际负载确认的边界，未宣称所有账号秒级。固定后端读取预算 25 秒，无新增配置开关。

本次开发与修复已提交到任务开发分支并推送；未合并、创建 PR 或部署。正式发布前仍需实际环境容量验收。

## 合并前复审（2026-09-28）

- 已同步 dev 的 AI points 改动，冲突只涉及独立 SDK import/export，双方导出均保留。
- 修复手动刷新未中止旧统计轮询的竞争，以及旧分页请求结束后误释放新请求的忙碌状态；原 UI 和交互入口不变。
- 真实写链路发现 Audio 取消例外字段 `qu` 未读取、候选确认只改轨道却未重新标记取消片段；两项在 Audio owner 修复，前端不伪造统计来补偿写入错误。
- E2E 种子由 Audio `tools/fixtures/speaker_presence_e2e.js` 提供，只可用于任务隔离 Mongo 测试库。页面测试需匹配本批 Audio 版本。
- 验收范围为 macOS Chrome、官方未修改 DSH 0.1.5-rc.2、正式安装的不可变 tgz；不据此声称 Windows/Linux 或生产环境已经验收。
