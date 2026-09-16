# Harness 底部设置入口

已登录时，Arkme 最左侧头像菜单已经提供官方设置入口，因此嵌入的 Harness 侧栏不再重复显示底部“设置”。未登录、登录状态未确认时保留官方入口。

实现使用官方 `sidebar.settings` 插槽，在 Arkme 拥有的 iframe 内注册空组件。登录身份只读取父界面已有的 `data-arkme-account-id`，不新增认证请求，也不修改凭据。身份移除或模块卸载时撤销插槽贡献，恢复官方组件。其他底部操作及头像菜单打开官方设置的流程不变。

独立官方 Harness 页面和其他 iframe 不受影响。模块仅在启动图中存在官方侧栏包时加入，独立于轨迹菜单适配。官方设置页面、设置内容和侧栏主体均继续使用宿主提供的组件。

验证：`pnpm typecheck`、`pnpm build`、`pnpm exec vitest run tests/harness-sidebar-client.test.ts tests/harness-embed-route.test.ts tests/deepseek-harness-surface.test.tsx tests/persistent-shell.test.tsx`。Web 验证应同时覆盖已登录时底部入口与占位消失、头像设置仍能打开，以及未登录时原入口仍显示并可打开。
