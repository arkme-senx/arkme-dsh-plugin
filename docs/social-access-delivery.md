# 登录态社交资格交付记录

账号服务是唯一裁决方。登录和手机号写链未修改；独立匿名 World API 保留。UI 隐藏未获准的社交入口和内容，Tools / Host / SDK 执行端复核；个人记录、主题、DSH 会话和可信个人 Bot 保留。

| 能力面 | 集中接入与结果 |
| --- | --- |
| Host | SocialAccessService 使用账号作用域、2 秒请求期限和在途合并；不持久化服务侧许可。 |
| Tools | `arkme_social_access` 正式 catalog；业务调用复用 owner，旧引用和确认后执行仍受控。 |
| SDK | 公开 `socialAccess()`、capability discovery 与安全结果；不支持能力的 Provider 不派发业务。 |
| UI | 单一内存快照；冷启动未知隐藏，前台和根页固定刷新；导航、菜单、正文、来源、分享目标、通知和通话运行时保持一致。 |
| 通话 | 未获准时不挂载 receiver、不轮询 outgoing intent；资格变化后清理运行时。供应商凭证和 SDK 直连不在本次范围。 |

验证完成：最新 dev 合入后 `pnpm exec vitest run --maxWorkers=2` 为 733 文件通过、9 跳过；8690 用例通过、13 跳过。构建通过。初始功能 tgz 在路径含空格的独立官方 DSH 安装并运行，未修改 DSH 源码或用户默认 Profile。

真实 DSH Agent session 已执行 false → true → 服务故障 → false 场景。外部独立 Consumer 仅导入公开 SDK，编译与真实 Host 调用通过。浏览器实际操作验证了联系人/世界/通话、作者联系与群入口在受限时隐藏，Quick Add 只保留 DSH 会话和 Bot；“发给自己”仍可打开编辑器。允许后社交入口恢复，故障后重新隐藏。React DOM 测试同时验证了通话轮询随资格启停。

验收产物为 `senguoyun-dsh-arkme-0.1.76.tgz`，SHA-256 与原日志定位由跨仓交付记录保存。未修改版本号或发布 npm。

测试使用隔离的账号/社交服务 fixture，不替代真实部署服务与供应商通话验收；fixture 关闭 DSH remote.session，因此没有把内嵌模型页实际聊天算作已验证。跨仓详细证据由同任务 jotmo-meta 的 `c20260922-phone-social-access` change 保存。

合并前复审的首轮全量出现三个时限/动画断言失败；对应单文件重跑 50 项通过，两个 worker 的全量重跑完全通过。历史官方 DSH 运行包与最新基线构建的证据分开记录；未发布新版本。
