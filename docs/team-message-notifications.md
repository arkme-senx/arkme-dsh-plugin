# Team 消息通知与个人免打扰

Team 是消息可见性、个人策略、成员 epoch 和已读游标的唯一 owner。Host 只消费首次发布事件，当前权限核验后把提醒交给系统通知设施；不创建 Chat 会话，不改 Chat badge。解除免打扰仅允许后续序号，不补弹积压消息。编辑、删除、转写、收据、初次列表与断线恢复不触发新消息提醒。

| 能力 | UI | SDK | Tools | Host owner |
| --- | --- | --- | --- | --- |
| 查询可访问会话与个人策略 | 原团队列表及更多菜单 | listTeamNotificationConversations / getTeamNotificationPolicy | arkme_team_notification_conversations / arkme_team_notification_policy | TeamAppService，当前账号的不透明引用 |
| 设置个人免打扰 | 原更多菜单的勾选项；忙碌禁点、失败读回 | setTeamNotificationPolicy | arkme_team_notification_policy_set，explicit-user-write | TeamAppService，显式 muted，无本地 toggle 写入 |
| 新消息通知与点击 | 原生通知及已授权的 Browser fallback | N/A：由当前登录账号的实时生命周期自动消费，不提供人为重放通知接口 | N/A：模型不拥有系统提醒重放权限 | 首次发布事件 → Team 当前 authority → native transport；点击再次授权 |

PC 通知的 kind 为 team.message，激活类型为 team-conversation。随本次桌面壳契约更新一起交付。移动 Flutter 仅实现移动端；本插件提供 PC 能力。所有测试使用隔离实例与模拟数据，不改常驻 DSH Profile，不向真实用户发送测试通知。

2026-10-23 验证：typecheck、build 通过；插件全量 1,152 文件 / 13,395 测试通过，16 文件 / 21 测试跳过。新增写工具接入既有真实 Session 确认链，声明 grant 同时执行确认校验。

`tests/e2e/team-notifications-installed.mjs` 使用官方 DSH 0.2.1-rc.2、官方 CLI 新建隔离 Profile 安装不可变 tgz，通过真实 Session Tools、独立 TypeScript SDK consumer、Host 和 Chrome UI 验证：读取、授权前拒写、授权后显式写入、错误类型拒绝、capability 缺失拒写、菜单保存/重开、保存失败保留已确认值、实际 SSE 新消息、重复抑制、静音过滤及静音后点击已有通知重新授权打开。业务 API 使用本地 HTTPS fixture，浏览器 Notification 为测试替身，不代表真实 OS 提示已验收。

运行入口：先以官方 CLI 将包安装到独立 `DSH_HOME` 的 web Profile，再向脚本提供 `ARKME_DSH_RUNTIME`（含已发布官方 DSH 的 Node 项目）、`ARKME_PLAYWRIGHT_ANCHOR`（含 Playwright 的 package.json）、`ARKME_E2E_TLS_KEY` 和 `NODE_EXTRA_CA_CERTS`（仅本地 fixture 证书），最后运行 `node tests/e2e/team-notifications-installed.mjs`。可用 `ARKME_E2E_CAPTURE_DIR` 保存截图。脚本禁用继承的桌面桥地址，避免向常驻桌面实例发送测试提醒。

后续 `tests/e2e/team-notifications-services.mjs` 已连接真实 Team/Record/IM/Push main 和 Mongo/MySQL/Redis/RabbitMQ，完成菜单持久化、个人静音、未读保留、同事多设备推送、解除不补弹、新消息与授权点击、页面回复访客、访客静音、编辑不提醒和撤权拒绝。启动器与环境说明位于同级 jotmo-meta 仓库的 `scripts/e2e/team_notification_services.md`。账号/搜索/厂商和 Browser Notification 仍为明确的外部边界替身。

真实 macOS/Windows/Linux 通知中心、移动端厂商到达与发布环境接线仍属于发布前环境验收。本轮桌面壳通知/激活专项 67 项和壳构建通过；Electron 下载失败与已有依赖缺失导致扩大壳测试未全绿。
