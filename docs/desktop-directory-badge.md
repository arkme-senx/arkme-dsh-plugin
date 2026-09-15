# 侧边栏未读与桌面角标

侧边栏会话行与应用内「对话」总数共用 `arkmeChatDirectory.getConversationSnapshot()`。
桌面端支持 `window.arkmeDesktopNotifications.applyDirectoryBadge(count): Promise<boolean>` 时，
顶层 `ArkmePersistentClientRuntime` 将同一快照的 `badgeCount` 推送到桌面角标。

- `count` 是显示计数，不是已读命令，不改变服务端游标。私聊、群聊、Bot、隐藏和免打扰规则仍由插件统一计算。
- 只发送计数，不传凭据、消息正文、账号或会话标识。客户端只接受当前 Harness 主窗口主框架的调用，并验证非负安全整数及既有 999999 上限。
- 一次只保留一个在途调用和最新待同步计数。失败后在目录变动或窗口获得焦点时重试；取消订阅会停止后续发送。
- 桌面端收到目录计数后，本次 Harness 生命周期内的 Host 汇总不能覆盖目录计数。页面重载或崩溃期间角标清零，等待新页面提供列表快照。
- 不支持该可选方法的旧客户端保持原有 Host 角标行为。三处一致性需要插件和客户端一起交付；只更新插件不能修复旧客户端的系统角标。

验证入口：插件 `directory-badge-runtime.test.ts`、`chat-preview-navigation.test.tsx`；客户端 `native-badge.test.ts`、`preload-bridge.test.ts`。
跨进程消息传递存在短暂传播时间；本合同消除独立汇总长期残留或旧汇总覆盖新列表的幽灵计数，不承诺操作系统与 React 在同一时钟瞬间绘制。
