# 消息发送恢复

业务 owner 继续使用 `FileTransfers` 的账号隔离、原子持久化和发送队列。发给自己、默认分类和主题里的普通文字、Markdown、已上传附件与本地附件共用这一个 owner；普通群聊原有的纯文字和 AI 润色链路保留。页面复用已有任务展示，不再增加发送重试定时器。

## 能力覆盖

| 消费面 | 入口与约束 | 验证 |
| --- | --- | --- |
| UI | `files.send` 接受空 `fileRefs` 的非空消息；消息旁展示发送状态；点状态图标或右键打开原消息菜单，选择重试或清除本地记录 | 队列、页面交互与隔离页面验收 |
| Tools | `arkme_files_send`、`arkme_files_list`、`arkme_file_task`；发送和重试保留 explicit-user-write grant；不向模型暴露位置快照 | Host/Tool 合同与正式 DSH 工具调用 |
| SDK | `fileCapabilities().textMessagesVersion === 1` 后，以 `sendFiles({fileRefs: [], ...})` 提交；已有任务读取、重试、核对和取消订阅入口 | 独立 Consumer 和 SDK/Host 合同 |
| Host | 冻结目标、正文、账号、record/relation UID 和发送时间；本地受理后再发送；回执和核对都更新原任务 | 网络失败、未知结果、重启、并发、账号切换测试 |
| Client/Harness | 复用现有 Host 路由和文件状态目录，不新增原生桥或改变 Release Set | 官方 DSH 0.2.1-rc.2 安装制品；macOS Electron 开发宿主使用全新 App Data 运行同一制品 |

## 恢复语义

- 参考 Telegram 的稳定 random_id、本地未发送队列和发送状态，使用 Arkme 自身的 Record/Chat 幂等协议，不复制其源码。
- 新任务先落盘，再发送。自动恢复使用有限次数的指数退避；同一 Host 只维护一个恢复定时器，同一任务只允许一个执行者。手动重试重置恢复预算，沿用冻结的请求。
- 远端结果未知时先查原任务的精确回执。只有 owner 明确证明原发送未受理时，才能用原 UID 重发；最近一页未出现消息不构成该证明。无法确认则保留待确认状态。
- 权限、身份、内容校验等确定拒绝不自动重试。退出或切换账号取消旧账号活动；重新登录后恢复原账号队列。页面重建不创建新的发送 owner。
- 本地队列受理、服务端受理和全部附件完成分开呈现；清除本机记录不撤回可能已发送的远端消息。
- 活跃任务最多 100 条，已完成的纯文字回执最多保留 100 条；失败内容不因容量淘汰而丢失。自动恢复最多 6 次，退避 2、4、8、16、32、60 秒，遵守服务端更长的 Retry-After。

参考：Telegram Android `7be672ead283d022812d75c729d3a04dd4c2a2c6` 的 `SendMessagesHelper.retrySendMessage/processUnsentMessages`；[messages.sendMessage](https://core.telegram.org/method/messages.sendMessage)。

基线：插件 `cfb58f0c7c551a85f810985b0f9955b8a4eb7a04`；相关队列与消息合并测试 101 项通过。客户端参考 `95bda6a53a21c37188800d822650b02d65e894bb`；仅插件持有业务改动。

本次验证：683 项相关测试、类型检查、构建和打包通过。浏览器及 macOS Electron 均用本地 HTTPS 模拟服务实测：未写入断线时共两次创建请求且请求一致；写入后回执丢失时仅一次创建请求；点击“核对并重试”沿用原任务及原请求。生产安装包与 Windows/Linux 实际运行未验收。

Host 受理前，页面只保存当前提交的原参数。结果不明时，用户可以从原气泡用同一 UID 再提交；找到对应 Host 任务即清理这份暂存。文字回执确认后只保留任务与消息标识、时间和内容摘要，不从回执补回时间线正文。前台轮询只获取正在处理的任务及其状态变化，旧协议附件上传使用独立的队列。

文字发送状态保存在独立的 text-sends.json。升级时先保存已迁移的文字状态，再从旧文件状态移除文字任务。失去 Host 回执的页面暂存只显示状态，恢复操作先按原 UID 核对。新消息已送达但时间线尚未更新时显示无正文占位，最多合并发起三次延迟刷新。
