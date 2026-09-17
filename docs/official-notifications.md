# 官方通知

官方通知由 `jotmo-record` 独立领域维护，通知中心新增「官方」。公告不是聊天消息、快记、欢迎消息或表态提醒。IM 只提示数据已变化，不携带正文，不承担未读真相。

## 使用与合同

- 启动、IM 提示、重连、回到前台与可见页面约一分钟的校准都会重新读取 Record。
- 列表、摘要、详情查询无已读副作用。UI 的详情成功呈现且页面可见后才提交已读；列表预览不提交。
- 只读 Tools/SDK 不替用户确认阅读。显式标记已读使用当前 `environment:userId` 作为 `accountKey`，过期账号的命令在 Host 拒绝。Tools 可通过 plugin contract 与 user profile 获取环境/账号。
- 已读属于账号，服务端保存首次阅读时间。跨设备用定向 IM 提示重新查询。
- 全部已读由 Record 固定当时目标集后处理，不局限客户端已经加载的页面；结果未知时先重新查询，禁止自动重试全部已读。
- 草稿不可见；已发布正文不可修改；撤回后从用户列表和未读数中移除。新注册用户可查看所有仍在发布的公告。
- 官方接口失败保留当前账号最近结果并提示重试，不阻塞其他通知 owner。登出/切换账号取消旧请求并清除旧账号可见状态。
- Markdown 只呈现文字、格式、列表、表格与 HTTP(S) 链接，不运行 HTML，不加载正文图片。

## 消费面

| 能力 | Host / SDK | Tools |
| --- | --- | --- |
| 分页列表 | `official-notifications.list` / `listOfficialNotifications` | `arkme_official_notifications_list` |
| 全局摘要 | `official-notifications.summary` / `officialNotificationSummary` | 列表工具同时返回 |
| 详情 | `official-notifications.detail` / `officialNotificationDetail` | `arkme_official_notification_detail` |
| 指定/全部已读 | `official-notifications.read` / `readOfficialNotifications` | `arkme_official_notifications_read`（explicit-user-write） |

SDK 从 `@senguoyun/dsh-arkme/sdk` 导入类型和方法，先探测 `features.officialNotificationsV1`。方法支持 AbortSignal；不支持的 Host 显式报错。UI、SDK、Tools 都委托 `OfficialNotificationService`，不各自实现业务。

用户 API 都是 Record `/api/v1/official-notifications/` 下的 POST：`query`、`detail`、`summary`、`read`、`read-all`。详情 ID、游标是 Record 合同值；浏览器不接收访问 token、管理操作人或管理 revision。摘要 `total`/`unread_count` 来自所有有效公告，不从当前页推断。

## 验证

覆盖 Host 路由、SDK 能力探测/取消、账号切换、迟到查询、失败后保留状态、跨页全部已读、IM/重连路由、可见详情确认、Markdown 安全，以及 Tools 注册和写入确认边界。具体构建、全量回归及临时 DSH 验收证据见配套 meta change 的 implementation.md。
