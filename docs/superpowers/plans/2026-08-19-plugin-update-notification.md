# Arkme 插件更新感知与通知系统实施计划

**目标：** 在不修改 DSH 内核的前提下，为 `@senguoyun/dsh-arkme` 增加 Host 侧版本检查、本地缓存、侧边栏行内更新入口和设置页状态。

**架构：** npm Registry 是可安装版本事实 owner；`ArkmePluginUpdateManager` 在 Host 中单飞检查并持久化设备级状态；Browser 通过现有同源 Host API 读取安全 DTO；侧边栏持有更新操作，设置页账号行只展示当前版本。

**设计：** `docs/superpowers/specs/2026-08-19-plugin-update-notification-design.md`

## 全局约束

- 实施开始前重新 fetch 并确认目标分支仍基于最新 `origin/master`；如 master 已前进，先 rebase 本 worktree 分支再写业务代码。
- 更新能力独立于 Arkme 登录、业务 SSE、`ArkmeService`、模型工具和公开 Consumer SDK。
- 不从远端接收或执行命令；升级命令只能由本地常量生成。
- Browser 不直接修改 profile 或执行命令；独立 helper 只调用 DSH CLI，并负责重启、健康检查和回滚。
- 不覆盖 Chat 未读 badge，不使用 DSH 私有 DOM 或未声明插槽。
- 所有新增定时器、AbortController 和订阅都必须随 Cordis/React 生命周期释放。

## Task 1：建立版本与发布元数据契约

**新增：**

- `src/plugin-update.ts`
- `tests/plugin-update.test.ts`

**修改：**

- `src/types.ts`
- `package.json`
- `pnpm-lock.yaml`

步骤：

1. 增加标准 semver 运行依赖及类型声明。
2. 定义 `ArkmePluginUpdateNotice`、`ArkmePluginUpdateStatus`、availability 和 level 类型。
3. 从安装包 `package.json` 读取版本；增加测试确保源码版本、npm 发布版本和 Host 投影只有一个事实来源。
4. 实现 Registry URL 构造、响应体限额、超时、包名/版本/通知元数据校验。
5. 实现 `current/available/ahead/unknown` 投影和远端元数据的安全降级。
6. 在 `package.json` 增加当前版本的 `arkme.updateNotice` 示例/正式元数据，并测试发布字段长度与 URL allowlist。

门禁：

```sh
pnpm exec vitest run tests/plugin-update.test.ts
pnpm run typecheck
```

## Task 2：实现设备级状态、TTL、退避与单飞

**新增：**

- `src/plugin-update-state.ts`
- `tests/plugin-update-state.test.ts`

**修改：**

- `src/plugin-update.ts`

步骤：

1. 实现 `plugin-update-state.json` 的严格解析、空状态恢复和原子写入。
2. 保留最后一次成功结果；失败只更新失败计数和下次重试时间。
3. 实现 12 小时成功 TTL、失败退避、60 秒手动检查限流和启动抖动。
4. 合并并发检查；所有调用方等待同一个 in-flight Promise。
5. 实现 acknowledge/snooze，且只能操作当前 Host 已知 `latestVersion`。
6. 当 installed 追上 latest 时清理旧版本 acknowledge/snooze。
7. 实现 `dispose()`，测试没有残留定时器、请求或状态写入。

门禁：

```sh
pnpm exec vitest run tests/plugin-update.test.ts tests/plugin-update-state.test.ts
pnpm run typecheck
```

## Task 3：接入插件 Host 生命周期和同源 API

**修改：**

- `src/index.ts`
- `src/host-api.ts`
- `src/types.ts`
- `src/client/api.ts`
- `cordis.patch.yml`
- `tests/host-api.test.ts`
- `tests/production-config.test.ts`

步骤：

1. 在 Config 中加入 `updateCheckEnabled`、`updateChannel`、`updateRegistryUrl`、`updateCheckIntervalHours` 及严格校验。
2. `apply()` 创建一个 update manager，并通过 Cordis effect 启动和 dispose。
3. Host API 增加 `plugin.update.status/check/acknowledge/install/install-status`，但只把它们加入内置 UI 操作类型。
4. `status` 返回缓存并按需后台刷新，`check` 等待一次受限检查，`acknowledge` 只修改本地提示状态。
5. 保持现有 loopback、same-origin、请求大小和 JSON 错误边界。
6. 证明未登录状态可以检查更新，且公开 `ArkmeSdk` 没有新增更新方法。

门禁：

```sh
pnpm exec vitest run tests/host-api.test.ts tests/production-config.test.ts tests/sdk.test.ts
pnpm run typecheck
```

## Task 4：实现 Browser 更新 store 与紧凑 UI

**新增：**

- `src/client/plugin-update-store.ts`
- `tests/client-plugin-update.test.tsx`

**修改：**

- `src/client/index.tsx`
- `src/client/ArkmeFooterAction.tsx`
- `src/client/ArkmeFooterDropdown.tsx`
- `src/client/ArkmeSettingsRow.tsx`
- `tests/arkme-footer-action.test.tsx`
- `tests/client-adapter.test.ts`

步骤：

1. 实现 Browser 单例 store：首次挂载读取状态，页面重新可见时刷新，长间隔轮询只访问本机 Host。
2. 在 client `apply()` 生命周期中启动/停止 store，确保热重载和重复挂载不会叠加轮询。
3. `ArkmeFooterAction` 增加不覆盖未读 badge 的独立更新点，以及宽侧边栏行内“更新”按钮。
4. 更新按钮作为 Arkme 主入口的 sibling action，点击不切换会话面板；Arkme 目录内部不展示更新卡片。
5. 将 `ArkmeSettingsRow` 收口为单行，标题显示 `Arkme v<installedVersion>`，仅保留登录状态与退出登录。
6. 所有远端文案只作为 React 文本节点，链接通过本地 allowlist 后使用 `noopener,noreferrer` 打开。
7. 为复制成功、检查失败和 stale 状态提供组件内反馈，不调用全局 toast。

门禁：

```sh
pnpm exec vitest run tests/client-plugin-update.test.tsx tests/arkme-footer-action.test.tsx tests/client-adapter.test.ts
pnpm run typecheck
```

## Task 5：发布流程、文档与完整验证

**修改：**

- `README.md`
- `package.json`
- `tests/arkme-identity.test.ts`（仅当新文档或链接触发现有身份守卫时做最小适配）

**可选新增：**

- `scripts/verify-update-metadata.mjs`
- `tests/update-metadata.test.ts`

步骤：

1. 文档写明更新检查配置、离线行为、复制命令、重启要求和本地开发关闭方式。
2. 增加发布元数据校验：schema、长度、URL allowlist、目标 dist-tag 版本单调递增。
3. 完整运行 typecheck、test、资源校验和 build。
4. 打包后检查 tarball 中 `package.json`、Host bundle、client bundle 和声明文件包含正确契约。
5. 使用隔离 DSH profile 做旧版本发现新版本的端到端测试。
6. 在 macOS 与 Windows 各验证：侧边栏更新点、未读共存、行内更新按钮、设置页、断网缓存、升级后重启清除。

完整门禁：

```sh
pnpm run typecheck
pnpm test
pnpm run verify:call-assets
pnpm run build
pnpm pack --dry-run
```

## 交付顺序

1. 先以 `next` dist-tag 发布包含更新检查能力的版本，并让测试 profile 跟随 `next`。
2. 发布一个更高的 `next` 版本，证明上一版本能够真实发现并展示更新。
3. 完成 macOS/Windows profile 验收后再晋升到 `latest`。
4. 首个稳定版本开放“立即更新并重启”，同时保留复制命令作为失败兜底；后续 DSH 官方更新 API 可替换 helper。

## 完成证据

- 分支相对最新 master 的源码 diff 和 commit。
- npm Registry dist-tag、版本和 integrity 的发布后回读。
- Host/客户端测试结果及完整 build 结果。
- 旧版本发现新版本的截图或录屏。
- macOS 与 Windows 分别执行升级、重启并回到 `current` 的运行记录。
- 记录应用内安装、自动重启、健康检查及失败回滚的真实运行证据。

## Task 6：独立 updater 与自动恢复

- 新增 `plugin-update-install-state.ts` 和 `plugin-updater-helper.ts`。
- 只允许 profile 中的 Registry semver 依赖进入自动更新；阻断 `link:`、`file:`、Git 和 URL spec。
- helper 使用当前 DSH `bin.js` 和原启动参数，更新后验证 loopback Host 返回目标版本。
- 新版本健康检查失败时安装旧版本、重启并写入 `rolled-back` 状态。
- Browser 轮询安装状态，在 DSH 恢复且目标版本成功后自动刷新。
