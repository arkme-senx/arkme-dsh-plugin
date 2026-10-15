# dev #843 与原地更新方案的对照

审查提交：`f8b81f0e167977c154591fd35207a51a0b87272f`，PR：<https://github.com/arkme-senx/arkme-dsh-plugin/pull/843>。

总体方向合理，但不能直接替代 UI 原地更新；整合时应使用一个发送合并 owner，而非两套保留逻辑叠加。

| 路径 | #843 | 本任务整合 |
| --- | --- | --- |
| 后台读/实时覆盖发送中消息 | 从当前列表提取 pending 项并合回；回执增加 fallback | 目标重复；统一进入 `ArkmeConversationMessageMergeOwner`，同时维护发送生命周期和版本关系 |
| 气泡原地更新 | React key 仍从临时 itemUid 切成正式 eventId，确认后新增表态包装 | 本任务继续保留稳定 renderKey、虚拟分块身份与固定表态容器 |
| 已读与未读正文 | 发送回执不能充当实际展示进度；正文落盘后只唤醒当前会话读本地缓存 | 互补，保留；本地正文通知也进入同一消息合并入口 |
| 实时尾部/删除 | 按响应覆盖范围结算尾部；明确删除立即过滤窗口和缓存 | 互补，保留；通知发送 owner 清理对应提交，防止迟到回执复活 |
| Worker 恢复 | 有界退避、失效补交、持久化写入屏障 | 保留；修复失效通知临时拥塞时误关闭健康 Worker 的 P2 |

## 已复现的问题

P2：`UnifiedChatTimelineService.drainInvalidations()` 的 catch 无条件对当前 Worker 调用 `failedStorage()`。当 Worker 尚健康（`isClosed === false`），只是 32 个请求的 admission 已满，失效命令也会触发关闭和退避，连带影响正在进行的读写。普通 `callStorage()` 路径已有健康状态检查，但外层 catch 抵消了该检查。

在未修改的 dev 源码快照中，复用 `unified-timeline-sync.test.ts` 的真实 service/cache fixture，令 `invalidate` 单次返回容量拒绝且 `isClosed=false`：断言“不应 close”失败，实际 close 调用 1 次。建议保留失效命令，待后续 owner 调用重试；只有确认死亡的对应实例才重建。该问题不等同于已证明的气泡重挂载原因。

该 P2 已修复：失效队列的 catch 仅结束本轮排空，保留未交付命令；Worker 的故障和替换仍由 `callStorage` 对实际请求实例统一处理。健康 Worker 容量拒绝或冷启动单次超时不会触发额外关闭；待后续既有 owner 调用补交失效命令后才恢复缓存访问。不增加计时器、重试 owner 或队列容量；已死亡 Worker 的原有退避与重建不变。

新增 3 条回归在修复前全部失败，修复后通过：已知/未知会话的终态失效遭遇持续拥塞时，20 个并发调用不能绕过屏障；恢复时 3 个读取共享一次失效补交，已撤回正文不重新出现；600 条失效通知积压触发的全局屏障在拥塞后仍能拒绝旧写入。与真实 Worker、SQLite 缓存及 Tools 时间线运行测试合计 43 项通过。

P2 修复后的 `pnpm typecheck` 通过。全量命令仍为 `NODE_OPTIONS=--no-experimental-webstorage pnpm test --maxWorkers=2 --testTimeout=30000 --hookTimeout=30000`，耗时 578.52 秒，1000 文件通过、5 文件失败、15 文件跳过；11,763 项通过、80 项失败、20 项跳过。其中 79 个失败名称与上一轮已复现的 dev 失败完全相同，另 1 项为 `recording-presence-writer` 的定时持久化失败重试用例（预期发送 1 次，实际 2 次）。该测试、录音 writer 及其 service 依赖与 dev 字节一致；当前分支和未修改 dev 独立复跑各 15 项通过，未在独立运行中复现。本次保留该偶发失败记录，不将全量结果描述为全绿。

本次 Host 修改是既有缓存基础设施的故障处理修复，Tools / SDK / UI 仍共用 `UnifiedChatTimelineService`，没有新增或改变公开接口、权限与业务命令。Client/Harness 源码不变。自动化拥塞注入不等同于真实账号的自然拥塞复现，也不据此声称跨平台性能提升。

另将本任务 4 条私聊/群聊的受控组件测试直接运行在 dev 源码上：消息存在性断言通过，确认后实例相同断言全部失败。说明 #843 修复“消息被读覆盖”有价值，但尚未实现完整的原地更新。整合后的同组测试需要同时验证存在性和实例身份。

## 合并处理

- 保留 #842 的删除/主题指定反馈与 #843 的消息同步、已读边界、实时尾部和缓存修复。
- 发送开始、确认、失败、实时数据、远端窗口、本地正文通知共用合并入口；删除旧的 Sidebar 内回执实现和 pending 合回分支。
- 保留原手机号缓存改动，不新增按钮、不阻塞已绑定用户发送。
- 当前合并后的 dev 与 #843 自身验证分支不同：额外含 #842。未修改的 dev 会话测试实际有 70 项失败；另 3 个套件的 9 项失败也独立复现。整合版本全量 11,761 项通过、79 项失败、20 项跳过，失败名称与 dev 完全一致，未新增失败；仍不能称全量全绿。

## 气泡时间的来源

消息气泡内右侧时间来自 [PR #840](https://github.com/arkme-senx/arkme-dsh-plugin/pull/840)，于 2026-10-15 15:47（北京时间）合入 dev：

- `63c87140a1588c13a0469520c4831418d7384f82`：从发送者标题移除时间，新增 `ArkmeMessageTimestamp` 与气泡内展示。
- `ba5970f7fc2d80a7962c9ec2f6d6be1f21704d88`：将时间压到文本末行右侧，普通文本预留 42px；另调整日期分隔。

GitHub commit→PR 关联与本地 merge 历史均指向 #840。本任务相对 dev 的 `ArkmeMessageTimestamp.tsx`、`message-timestamp.css` 无 diff，Sidebar 的时间组件接入也没有改动；它随 rebase 进入体验环境。本次仅核实来源，未调整时间展示。
