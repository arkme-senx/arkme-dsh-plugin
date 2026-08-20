# Arkme 插件更新感知与通知系统设计

## 背景与基线

本设计基于 2026-08-19 获取的 `arkme-senx/arkme-dsh-plugin` 最新 `origin/master`：

- implementation baseline commit：`ad28558d1abf742a281d6fcce146a2d7dd903a70`
- npm 包：`@senguoyun/dsh-arkme`
- 当前发布版本：`0.1.3`
- DSH 基线：`@deepseek-ai/dsh@0.1.0-rc.7`

当前插件已经通过 DSH 官方 `sidebar.footer.action` 和 `settings.general.item` 扩展位进入客户端，并通过同源 `/arkme-self/api` Host API 为 Browser UI 提供能力，但没有插件版本、检查更新或更新通知状态。

DSH 的 `plugin` 命令本质上是在目标 profile 目录中转发 `pnpm` 参数，并在成功后重新整理插件 bundle。因此升级必须沿用 DSH CLI，而不应由正在运行的插件直接修改 profile 的 `package.json`、lockfile 或 `node_modules`。

## 目标

- 新版本发布后，即使用户没有进入设置页，也能从常驻 Arkme 入口感知有更新。
- 正常更新不过度打扰；重要或安全更新能够提升视觉优先级并持续可见。
- 检查更新不依赖登录状态，不携带 Arkme 账号、Token、设备 ID 或业务数据。
- 网络失败、Registry 不可用或响应异常时继续使用最后一次成功结果，不把“检查失败”误报为“已是最新版”。
- 多个浏览器标签页只触发一份 Host 侧检查，避免重复请求和并发写状态。
- Registry 安装支持应用内一键更新、自动重启、健康检查和失败回滚。
- 本地 `link:`/`file:` 开发安装也显示应用内更新；更新只切换 Profile 依赖，不修改开发 checkout，并保留可复制的官方升级命令作为兜底。

## 非目标

- 不修改 DSH 内核或依赖私有 DOM、非官方 toast/notification 插槽。
- 不静默下载、安装或重启 DSH。
- 不让 Registry 返回内容决定本机要执行的命令。
- 不把插件更新伪装成 Arkme 消息未读，也不占用 Chat SSE 数据链路。
- 不做跨设备的“已读/稍后提醒”同步；更新提示状态属于当前 DSH 安装实例。
- 不支持版本降级。错误版本应发布更高版本的前向修复，而不是诱导客户端回退。

## 核心决策

### 1. npm Registry 是版本事实 owner

插件实际通过 npm 分发，因此最新版本以 Registry 对 `@senguoyun/dsh-arkme` dist-tag 的解析结果为准。稳定通道读取：

```text
GET https://registry.npmjs.org/@senguoyun%2Fdsh-arkme/latest
```

测试通道读取 `/next`。Host 只接受固定包名、受支持 dist-tag 和经过校验的 HTTPS Registry Origin。

不以 GitHub master、Git tag 或提交时间判断用户是否需要更新，因为这些状态不等于可安装的 npm 产物。

### 2. 新版本自身携带通知元数据

新版本的 `package.json` 增加可选的发布元数据。npm Registry 的版本响应会带回该字段，因此版本与提示文案由同一次发布原子交付，不需要额外搭建通知后端。

```json
{
  "arkme": {
    "updateNotice": {
      "schemaVersion": 1,
      "level": "normal",
      "title": "Arkme 插件有新版本",
      "summary": "新增更新内容的一句话说明，最多 200 个字符。",
      "publishedAt": "2026-08-19T03:00:00.000Z",
      "releaseNotesUrl": "https://github.com/arkme-senx/arkme-dsh-plugin/releases/tag/v0.1.4"
    }
  }
}
```

约束：

- `schemaVersion` 只接受 `1`。
- `level` 只接受 `normal | important | critical`，缺失或非法时降级为 `normal`。
- `title` 最多 60 个字符，`summary` 最多 200 个字符；客户端只作为纯文本渲染。
- `releaseNotesUrl` 只接受无账号密码的 HTTPS URL，首版限制在批准的 GitHub/npm/Arkme 文档域名。
- 元数据缺失不影响更新判断，UI 使用本地内置的通用文案。
- 远端响应永远不能提供 shell 命令、HTML、Markdown HTML 或脚本。

### 3. Host 检查，Browser 展示

新增独立的 `ArkmePluginUpdateManager`，它属于插件生命周期，不属于 `ArkmeService` 的 Arkme 业务数据边界。

```text
npm Registry
     │ HTTPS，固定包名，无账号信息
     ▼
ArkmePluginUpdateManager（Host 单例）
     │ 校验 / semver 比较 / 单飞 / 周期调度 / 本地持久化
     ▼
/arkme-self/api：plugin.update.status/check/acknowledge/install/install-status
     │ 同源、Browser 只接收安全 DTO
     ▼
ArkmeUpdateStore（Browser 单例）
     ├── 侧边栏 Arkme 行内更新按钮
     └── 设置页 Arkme 账号行的当前版本标题
```

Browser 不直接访问 Registry，原因是：

- 避免 CORS、代理和多标签页重复检查。
- 保证版本校验、缓存和错误策略只有一份实现。
- 不把未来可能增加的发布策略暴露成不受控浏览器逻辑。

更新事件不进入现有 Chat SSE。客户端首次挂载和页面重新可见时显式请求 Host 检查 Registry，不受 12 小时成功结果缓存限制；60 秒突发限流只用于合并短时间内的重复进入。长间隔定时器只读取本机 Host 状态，由 Host 的周期调度决定是否访问 Registry。

## Host 组件设计

### `ArkmePluginUpdateManager`

建议新建 `src/plugin-update.ts`，职责如下：

- 从已安装包的 `package.json` 读取 `installedVersion`，不从手写配置重复维护版本。
- 根据 `updateChannel` 读取 `latest` 或 `next` dist-tag。
- 使用标准 semver 库校验和比较版本，不自研不完整的版本比较器。
- 将同一时刻的检查合并为一个 Promise，多个标签页不会并发访问 Registry。
- 维护最后成功结果、最后检查时间、失败重试时间和当前提示确认状态。
- 启动不阻塞：插件挂载完成后以 5～30 秒随机抖动触发首次后台检查。
- Web App 首次进入或重新变为可见时绕过 12 小时成功结果缓存；60 秒内的重复进入合并到已有结果。
- 长期运行实例每 12 小时执行一次后台检查；失败按 15 分钟、30 分钟、1 小时退避，之后最多每 6 小时重试。
- `dispose()` 清理定时器和未完成请求。

### 网络边界

- 默认 Registry：`https://registry.npmjs.org`。
- 允许通过插件配置覆盖为另一个 HTTPS Origin，以兼容企业镜像；不允许 URL 中含账号、密码、查询参数或路径。
- 单次请求超时 5 秒。
- 响应体上限 64 KiB；超限、非 JSON、包名不匹配或版本非法均视为失败。
- 只发送通用 `Accept: application/json`，不发送 Cookie、Authorization、Arkme Token 或任何实例标识。
- 日志只记录状态码、错误类别和版本号，不记录完整响应或用户信息。

### 本地状态

状态独立写入 `<stateDirectory>/plugin-update-state.json`，不混入账号级 outbox 或凭据存储。

```ts
interface PersistedPluginUpdateStateV1 {
  version: 1
  lastCheckedAtMillis?: number
  lastSuccessfulCheckAtMillis?: number
  lastKnownLatestVersion?: string
  lastKnownNotice?: ArkmePluginUpdateNotice
  acknowledgedVersion?: string
  snoozedUntilMillis?: number
  consecutiveFailures: number
}
```

文件沿用现有 state store 的原子临时文件 + rename 写入方式。状态损坏时备份错误信息到日志并从空状态恢复；它不包含秘密，但目录和文件权限仍分别保持 `0700` 和 `0600`。

### 对 Browser 的安全 DTO

```ts
type ArkmePluginUpdateAvailability =
  | 'unknown'     // 尚未成功检查，或版本不可比较
  | 'current'     // installed === latest
  | 'available'   // latest > installed
  | 'ahead'       // 本地开发/预览版本高于当前 dist-tag

interface ArkmePluginUpdateStatus {
  installedVersion: string
  latestVersion?: string
  availability: ArkmePluginUpdateAvailability
  level: 'normal' | 'important' | 'critical'
  title?: string
  summary?: string
  releaseNotesUrl?: string
  checkedAtMillis?: number
  lastSuccessfulCheckAtMillis?: number
  stale: boolean
  checkFailed: boolean
  checking: boolean
  acknowledged: boolean
  snoozedUntilMillis?: number
  updateCommand: string
  restartRequired: true
}
```

`updateCommand` 由本地常量生成，首版固定为：

```sh
dsh plugin --profile web up @senguoyun/dsh-arkme --latest
```

若插件配置选择 `next` 通道，命令固定使用 `@senguoyun/dsh-arkme@next` 安装 spec；绝不采用远端返回的命令片段。

### Host 操作

更新操作只加入内置 UI 的 `ArkmeHostOperation`，不加入公开 Consumer SDK 契约：

- `plugin.update.status`：立即返回缓存状态；缓存过期时在后台触发单飞检查。
- `plugin.update.check`：用户手动检查，受 60 秒限流，完成后返回新状态。
- `plugin.update.acknowledge`：确认当前 `latestVersion` 已展示，可选择稍后提醒 24 小时。
- `plugin.update.install`：严格预检 Registry 依赖、当前 DSH bin、profile 和 helper 后启动一次更新任务。
- `plugin.update.install-status`：读取独立 updater 写入的安装、重启、成功或回滚状态。

这些操作不要求 Arkme 登录。`acknowledge` 只能确认 Host 当前已知版本，不能由 Browser 任意写入版本字符串。

## 状态机

```text
                 首次挂载 / TTL 到期
unknown 或 cached ───────────────────────► checking
      ▲                                      │
      │                                      ├─ 成功且 latest > installed ─► available
      │                                      ├─ 成功且相等 ────────────────► current
      │                                      ├─ 成功且 latest < installed ─► ahead
      │                                      └─ 失败 ─► cached-stale / unknown
      │
      └──────── 下次成功检查用新事实覆盖旧缓存

available ── acknowledge ─► available + acknowledged/snoozed
available ── 用户完成升级并重启 ─► current（自动清理旧版本确认状态）
```

网络失败不会把 `available` 清成 `current`。如果已经缓存一个可更新版本，即使后续检查失败，提示仍保留并标记为陈旧；设置页可展示“上次成功检查于……”。

## 用户感知设计

### 第一层：常驻侧边栏更新入口

`ArkmeFooterAction` 的 Arkme 图标右上角增加独立更新点：

- `normal`：蓝色 6px 圆点。
- `important`：橙色圆点。
- `critical`：红色圆点。
- Chat 未读数字保持原样，更新点不复用、不覆盖未读 badge。
- `aria-label` 追加“插件有可用更新”或“插件有重要更新”。
- 宽侧边栏中，Arkme 名称右侧直接出现紧凑“更新”按钮；点击只触发更新，不展开或关闭 Arkme 面板。
- 安装过程中按钮显示“更新中…”并禁用重复点击；窄侧边栏只保留图标更新点。

这保证用户无需打开 Arkme 面板即可感知并执行更新，Arkme 会话目录不再承载版本卡片。

### 第二层：设置页版本标题

现有 `ArkmeSettingsRow` 保持单行：标题从“Arkme 账号”改为 `Arkme v<installedVersion>`，下方只显示登录状态，右侧仅保留退出登录。设置页不再重复提供检查、安装、说明或复制命令；所有更新动作统一由侧边栏 Arkme 行持有。

## 更新操作与重启语义

Registry 安装中，用户点击“立即更新并重启”后：

1. Host 只接受自己当前已知的目标版本，并拒绝 Browser 传入包名、命令或任意版本。
2. Host 校验 profile 中的依赖是合法 semver 范围，或是明确的本地 `link:`/`file:` 开发安装；Git、URL 和其他非受控来源继续阻断。
3. Host 写入权限为 `0600` 的计划文件，启动打包在插件内的独立 updater，然后向当前 DSH 发送 `SIGTERM`。
4. Host 在停止 DSH 前由 Arkme 校验 Profile 的 `packageManager`；旧 Profile 缺失时只从 pnpm 的 `.modules.yaml` 安装元数据回填，并确认用户 PATH 中的 pnpm 能解析到该精确版本。updater 在旧进程退出后，通过同一个 DSH `bin.js` 和完整 Node `execArgv`，以 Host 已校验的精确目标版本执行插件 CLI `add`，不再次解析可能陈旧的 `latest`。随后按原 `execArgv`、应用 `argv`、`DSH_HOME`、profile、Host 和端口重启；源码启动依赖的 loader 参数不能丢失。
5. updater 调用 loopback Host API 验证目标版本已加载；失败则重新安装旧版本并再次重启。
6. Browser 在服务离线期间保留“正在更新”状态，轮询恢复后的 Host；成功后自动刷新页面。

固定命令仍作为失败兜底：

```sh
dsh plugin --profile web up @senguoyun/dsh-arkme --latest
```

当前 DSH `0.1.0-rc.7` 没有运行时插件更新 API：`dsh plugin` 仅向 profile 目录转发 `pnpm` 参数，`dsh-host-plugin-inventory` 也明确是只读且不能增删插件。因此 companion updater 仍调用 DSH CLI 作为 profile/bundle reconciliation owner；Browser 从不获得任意命令执行能力。未来若 DSH 提供正式更新 API，应替换 helper，而保留本设计的状态机和 UI。

## 配置

新增插件配置：

```ts
interface Config {
  updateCheckEnabled: boolean        // 默认 true
  updateChannel: 'stable' | 'next'   // 默认 stable
  updateRegistryUrl: string          // 默认 https://registry.npmjs.org
  updateCheckIntervalHours: number   // 默认 12，允许 1～168
}
```

生产 `cordis.patch.yml` 使用默认稳定通道，并允许本地路径开发安装显示更新入口；点击更新只替换 Profile 依赖，本地 checkout 保持不变。若不希望开发环境接收 Registry 提示，可显式配置 `updateAllowLocalInstall: false` 或 `updateCheckEnabled: false`。

## 发布流程

每次 npm 发布必须同时完成：

1. 按 semver 更新 `package.json.version`。
2. 更新 `arkme.updateNotice`，写清级别、短说明和 release notes URL。
3. CI 校验版本比当前 Registry 目标 dist-tag 单调递增。
4. 运行 typecheck、完整测试、资源校验与 build。
5. 发布到 `next` 做灰度，或发布到 `latest` 做稳定更新。
6. 发布后轮询 Registry，确认版本、dist-tag 与 `dist.integrity` 可读。
7. 用上一正式版启动 DSH，验证其能够发现本次新版本并正确展示通知。

若发布版本存在问题，应发布更高版本的修复包。不得只把 `latest` 指回更低版本并期望客户端降级，因为已安装版本会进入 `ahead` 状态。

## 安全与隐私

- 更新检查完全独立于 Arkme 登录，不读取或发送 Keychain/Credential Locker、SQLite、账号 ID、Token 或 `uniqueCode`。
- Registry URL 只能是 HTTPS Origin；包路径由固定包名 URL 编码生成，避免 SSRF 和路径注入。
- 远端文案长度受限、只按文本渲染；链接有域名 allowlist；远端不能下发命令。
- Host API 保持现有 loopback 与 same-origin 校验。
- 状态文件不记录完整远端响应，防止长期存储无界或异常内容。
- “检查更新”限流，避免恶意页面或多个标签页把本机变成 Registry 请求放大器。
- 只有用户明确点击后才安装；包名固定、版本来自已验证 Registry 响应、命令在本地生成，远端不能下发 shell 内容。
- updater 计划文件权限为 `0600` 且使用参数数组启动进程，不经过 shell；日志不写入环境变量或凭据。

## 可观测性

Host 使用结构化但不含个人信息的日志：

- `plugin_update_check_started`
- `plugin_update_check_succeeded`：installed/latest/channel/duration
- `plugin_update_check_failed`：错误类别/status/duration/consecutiveFailures
- `plugin_update_available`：installed/latest/level
- `plugin_update_acknowledged`：latest/snoozeHours

日志不得包含 Registry 响应正文、release notes 全文、账号或设备标识。首版不新增远端遥测。

## 代码边界

预计新增：

- `src/plugin-update.ts`：Host 检查、校验、semver、调度与 DTO 投影。
- `src/plugin-update-state.ts`：设备级持久化状态。
- `src/plugin-update-install-state.ts`：跨进程安装状态。
- `src/plugin-updater-helper.ts`：独立升级、重启、健康检查和回滚。
- `src/client/plugin-update-store.ts`：Browser 状态、可见性刷新和轮询。
- `tests/plugin-update.test.ts`
- `tests/plugin-update-state.test.ts`
- `tests/client-plugin-update.test.tsx`

预计修改：

- `src/index.ts`：配置、manager 生命周期和 Host API 注入。
- `src/host-api.ts`、`src/types.ts`、`src/client/api.ts`：内置 UI 操作与安全 DTO。
- `src/client/index.tsx`：update store 生命周期。
- `src/client/ArkmeFooterAction.tsx`、`ArkmeFooterDropdown.tsx`：图标更新点和行内更新按钮。
- `src/client/ArkmeSettingsRow.tsx`：账号状态和当前版本标题。
- `cordis.patch.yml`、`package.json`、`README.md`：生产默认、发布元数据和用户说明。

更新能力不加入 `ArkmeService`、公开 Consumer SDK、模型工具 Catalog 或 system prompt。

## 测试设计

### Host 单元测试

- 相等、可更新、本地 ahead、prerelease、非法版本的 semver 投影。
- 正常/重要/关键元数据缺失、非法、超长和恶意 URL 的降级行为。
- 成功缓存、失败保留旧缓存、TTL、退避、手动检查限流和单飞并发。
- 超时、非 JSON、响应过大、包名不匹配和 HTTP 错误。
- `dispose()` 取消定时器与请求。
- 本地状态原子写入、损坏恢复、权限和旧版本确认自动清理。

### Host API 测试

- 未登录也可读取更新状态。
- `status/check/acknowledge` 参数边界与错误映射。
- Browser 不能确认 Host 当前版本之外的任意版本。
- 更新操作不进入公开 SDK 的编译期操作集合。

### 客户端测试

- 未检查、已最新、可更新、陈旧缓存、检查失败的 UI。
- 更新点与 Chat 未读 badge 同时存在且各自可访问。
- `normal/important/critical` 的颜色、文案、snooze 行为。
- 设置页只保留一行，并把当前版本投影到 `Arkme v<version>` 标题。
- 多次挂载只保留一个 Browser store 轮询器，卸载后清理。

### 集成验收

1. 用 `0.1.3` 安装到隔离 `web` profile，并让测试 Registry 返回 `0.1.4`。
2. 不登录 Arkme，启动 DSH Web，确认侧边栏出现更新点。
3. 同时制造 Chat 未读，确认未读数字没有被更新提示覆盖。
4. 确认宽侧边栏 Arkme 行出现“更新”按钮，点击不会切换 Arkme 面板展开状态。
5. 打开设置页，确认只有 `Arkme v<version>` 账号行，不再出现第二行插件操作。
6. 断网重启，确认最后一次可更新结果仍显示且标记为陈旧。
7. 执行官方升级命令并重启 DSH，确认状态变为 `current`，旧提示消失。
8. 在 macOS 与 Windows 各完成一次真实 profile 验收。

## 完成标准

- 新版本发布后，一个成功检查周期内，未进入设置页的用户也能在侧边栏感知更新。
- 更新状态不依赖 Arkme 登录，不泄露账号或设备信息。
- 网络失败不会产生“已是最新版”的假结论，也不会清除已知更新提示。
- 通知不覆盖 Chat 未读、不注入 DSH 私有 DOM、不接入 Chat SSE。
- Registry 与本地 `link:`/`file:` 开发安装都可在应用内完成升级和自动重启；本地 checkout 不会被修改，且仍有固定 CLI 兜底。
- 单元、Host API、客户端组件和 macOS/Windows profile 验收全部通过。
