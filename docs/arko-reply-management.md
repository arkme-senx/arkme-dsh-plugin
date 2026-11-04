# Arko 回复管理

既有“回复设置 / 全部回复”页面接入同一个 `ArkoReplyManagementService` Host owner。界面沿用两项自动设置、七类指令编辑与原消息定位；保存后跨设备生效，恢复默认仍需点击保存，冲突和失败保留编辑输入。读取历史不触发模型。

| 消费面 | 入口 | 权限、失败及验证 |
| --- | --- | --- |
| UI | `ArkoReplyManager` | 云端 revision CAS；账号切换中止；保存反馈位于固定底部；真实浏览器验证成功、冲突、失败、重置和原消息定位 |
| Tools | `arkme_arko_reply_prompts`、`arkme_arko_replies`、`arkme_set_arko_reply_prompt` | 元数据/单类完整正文读取、每页十条内容预览；写入沿用正式会话确认；官方 DSH 的真实会话验证发现、读取及无确认零写入 |
| SDK | `arkoReplyPrompts`、`saveArkoReplyPrompt`、`resetArkoReplyPrompt`、`arkoRepliesPage` | 公开类型、`arkoReplyManagementV1` 能力探测、账户作用域和 AbortSignal；仓外 Consumer 只导入已安装 tgz 的公开 SDK |
| Host | `services/arko-reply-management-service.ts` | UI/SDK/Tool 共用账户校验、上游调用、错误语义与签名路由封装；不把上游 Token 或裸路由授予浏览器 |

七类为 `record_auto`、`record_mention`、`direct_receive`、`direct_sent`、`direct_mention`、`group_mention`、`group_auto`。只替换回应指令正文，上限6000 Unicode 字符。授权、上下文、路由、输出 schema 与安全约束由后端固定。默认正文与实际生成路径共享；生成前冻结 revision，修复与 fallback 不重读新配置。

全域列表来自服务端既有结果与正式 AI 延展，按源消息时间分页，每页重新验证当前源版本和权限。普通评论、Agent 输出、直接 Arko 聊天不混入。使用服务端不透明游标；临时校验失败保留原游标重试，读列表不依赖本地已加载时间线或额外观察注册表。

个人快记可同时包含自动想法和主动回应。原始 `sourceVersion` 与经 Record 证明的 `currentSourceVersion` 分离；只有当前版本或仅附件变化的证明才显示，签名回复写入仍要求精确当前版本。流同时校验源版本、stream ID 和 UTF-8 字节位置；无版本旧通知只触发权威重读。

运行验收：构建并打包后，在全新隔离 Profile 通过官方 `dsh plugin --profile <name> add <artifact.tgz> --ignore-scripts` 安装。将 `scripts/arko-replies-dsh-acceptance.mjs` 作为 Profile probe 插件注册并设置 output；它只替换合成 owner，不联系真实账号。设置 `ARKME_PACKED_PROFILE` 后执行 `scripts/verify-arko-replies-sdk-consumer.mjs` 验证仓外类型编译、调用、能力不支持和取消。

此次没有 package version、lockfile、DSH 源码或常驻 Profile 改动。官方运行证据基于 macOS / DSH v0.2.1-rc.2；不据此声称 Windows/Linux 或线上真实账户已验收。
