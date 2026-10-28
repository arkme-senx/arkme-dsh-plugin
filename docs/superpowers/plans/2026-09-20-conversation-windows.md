# 会话独立窗口实施计划

**目标：** 已确认低保真原型：双击私聊、群聊、我发给自己条目，打开可独立移动的系统窗口；同一会话去重，主窗口继续使用。排除 Arko 和 Harness。

**架构：** 桌面主进程管理受控会话窗口，复用登录 session、隔离账号和窗口身份。插件独立入口挂载既有 ArkmeSurface，每个页面保持独立 UI 状态。草稿和提交锁通过受控主进程桥同步；消息通过原实时链路和变更通知刷新。主窗口保留通知、角标、通话全局 owner。

**基线：** 插件 origin/dev c6b7073；客户端 origin/master 7e282ee。分支 zp-codex/conversation-windows；不提交、推送、发布。

## Task 1: 桌面窗口和桥
- [x] 添加 conversation-windows.test.ts，验证类型限制、同会话并发去重、不同会话、账号切换失效、关闭释放、草稿事件和发送互斥。
- [x] 实现 conversation-windows.ts、conversation-window-ipc.ts 与 preload 专用 bridge，挂接 main.ts 生命周期。
- [x] 运行新增测试和长文窗口回归、客户端 typecheck。

## Task 2: 插件入口及状态同步
- [x] 添加桥和草稿同步测试，先执行失败验证。
- [x] 实现 conversation-window.ts、conversation-window-sync.ts、ArkmeConversationWindow.tsx；index.tsx 独立入口与主窗口桥绑定。
- [x] 左侧三类会话行加入双击，复用发送逻辑并串行化跨窗口提交。独立页关闭不删除草稿；回主窗口只定位原会话。
- [x] 验证自聊聚合身份、私群聊源身份、焦点已读、账号失效、窗口内跳转与旧壳降级。

## Task 3: 集成与验收
- [x] 运行相关测试、两仓 typecheck/build。
- [x] 真实 Electron smoke 验证创建、去重、隔离、聚焦、关闭和重新打开。
- [x] 完成独立代码审查、修复重要问题、记录验收证据与限制。

## Review Focus
跨窗口同时发送不得重复；后台窗口不得抢已读；登出后旧窗口不得继续写；草稿不因其他会话更新被清空；主窗口导航不改变独立窗口目标。

验收范围与真实账号联调边界见 `.workstreams/conversation-windows/acceptance.md`。
