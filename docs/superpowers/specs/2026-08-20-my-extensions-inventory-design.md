# “我的扩展”统一清单设计

## 目标

把扩展市场中的“我的发布”改为“我的扩展”。该列表只展示当前 Arkme 账号自己创建的扩展，并把同一扩展的 Dynamic Cordis、本地 Profile 持久化和云端发布状态合并展示。DSH 官方插件、仅安装的第三方市场扩展、远端 registry/Git 插件和无法证明归属的本地插件不进入列表。

## 当前事实

- 云端 `extensions.my-list` 已按当前 Arkme 账号返回发布记录。
- Dynamic Cordis runner 能列出进程内插件，并能按 `Agent + pluginId + packageId` 读取一个不可变 Package 的完整 Host/Client 源码；定义在 DSH 重启后消失。
- Profile 的 `package.json` 把 DSH 官方 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 保留为 installation-owned bundle，它们不是 Profile `dependencies`。
- 当前本地 Profile 示例中的自建插件通过 `link:/...` 出现在 `dependencies`，而官方 bundle 只出现在 `dsh.profile.bundles`。
- Arkme 持久安装表只记录安装事实，没有创建者账号和 Cordis/云端血缘。
- 当前 UI 的“我的发布”只读取云端 `extensions.my-list`，不能表示 Cordis 或仅本地状态。

## 归属定义

“我的扩展”中的“我的”按当前 Arkme `userId` 判定：

1. 云端扩展必须来自当前账号的 `my-list`。
2. 新建 Dynamic Cordis Plugin 在 `cordis_define` 成功时绑定当时已认证的 Arkme `userId`；同一 Plugin 的后续 Package 继承该绑定。
3. 功能上线前仍存活的 Cordis Plugin，只允许当前选中会话在当前账号下做一次安全回填；其他会话中缺少归属证据的旧 Cordis 不自动认领。
4. 本地 Profile 扩展必须是 `link:` 或目录型 `file:` dependency、声明有效 `dsh.bundle.patch`，并在首次发现时绑定当前账号。远端 semver、npm alias、Git、URL 和 tarball dependency 不自动认领。
5. `@arkme-local/ext-*` 市场安装 wrapper 只有在其 `extension_id` 出现在当前账号 `my-list`，或已有当前账号创建血缘时才进入“我的扩展”；安装第三方扩展不会使它成为“我的扩展”。
6. 同一 Profile package 已绑定其他 Arkme 账号时，当前账号不得看到或重新认领。

上述规则通过正向准入排除 DSH 官方插件，不维护按版本漂移的官方插件黑名单，也不按显示名称猜归属。

## 统一状态

一个逻辑扩展可以同时拥有以下状态：

- `cordis`：当前 DSH 进程中仍存在至少一个不可变 Package。
- `persisted`：当前 `web` Profile 中存在账号归属明确的本地 Bundle。
- `published`：当前账号云端 `my-list` 中存在发布记录。

列表一行表示一个逻辑扩展。合并只使用显式血缘：

1. 云端 `extension_id` 是已发布扩展的稳定身份。
2. Arkme wrapper 的 `installation.json.extension_id` 与云端身份合并。
3. Cordis 发布成功后记录 `hostInstanceId + agentId + pluginId -> extension_id`，随后与云端行合并。
4. 普通本地 package 使用 `profileName + packageName` 作为 Profile 内稳定身份。
5. 名称相同或源码摘要相同不自动合并；摘要只用于完整性和诊断。

## 安全投影

UI、SDK 和 Tool 共用 Host `ArkmeOwnedExtensionInventory`。浏览器和外部插件只得到：

- 不透明、账号绑定、短时有效的 `ownedRef`。
- 名称、说明、状态标签、版本、可见范围、Host/Client half 和可执行动作。
- 安全降级信息，例如“云端状态暂不可用”。

它们不得得到 Profile 绝对路径、artifact URL/headers、Token、签名公钥、内部数据库行、其他账号 userId 或不需要的 Agent 定位信息。

## 列表与动作

- Tab 文案改为“我的扩展”。
- Cordis-only：显示“Cordis 临时”，存在精确可读 Package 时提供“发布”。
- Persisted-only：显示“已持久化”；没有可发布 Cordis 源码时不伪造发布入口。
- Published-only：显示“已发布”和云端可见范围。
- 多状态：同一张卡同时显示对应标签，不重复成多行。
- 状态标签以轻量灰色胶囊紧跟标题，不占用卡片右侧动作区域。
- 卡片右侧只显示真实行为：仅尚未发布且有精确 Cordis Package 的条目显示“发布”；已发布和仅本地条目不渲染按钮。
- Cordis 发布必须锁定确切 Package：优先当前成功运行的 `currentPackageId`；没有 current 时选择定义顺序最后一个 Package；不得自动选择失败或进行中的 `nextPackageId`。
- UI 发布表单收集名称、说明、语义化版本、可见范围和 changelog，复用现有 artifact 校验、幂等 publish session 和失败恢复。
- 发布成功后立即记录血缘并刷新统一列表；失败时保留原 Cordis 行和用户输入。

## 数据 owner 与失败语义

- Dynamic Cordis runner 是临时 Package 和源码 owner。
- Profile manifest 与本地 package manifest 是本地持久化存在性 owner。
- Arkme 扩展服务 `my-list` 是云端发布 owner。
- `ArkmeOwnedExtensionStore` 只拥有账号归属和跨状态血缘，不复制源码、云端详情或运行态。
- 云端读取失败时仍返回 Cordis/本地结果，并标记 `cloud-unavailable`；不得把本地结果清空。
- Profile 某个 dependency 无效时只跳过该 dependency 并返回安全诊断；不得阻断其他条目。
- Dynamic Cordis capability 缺失时返回 `cordis-unavailable`，已持久化和云端项目仍可展示。
- 未登录时返回 `login-required`，不把无账号归属的本地项目临时归给任意账号。

## 能力矩阵

| 能力面 | 入口 | 安全语义 |
| --- | --- | --- |
| Host owner | `ArkmeOwnedExtensionInventory.list()` / `publishCordis()` | 当前账号归属、显式血缘、幂等发布、部分失败合并 |
| UI | “我的扩展”Tab、Cordis 发布表单 | 只使用 `ownedRef`，写操作要求同源页面 |
| Tool | `arkme_extension_list_mine`、现有 `arkme_extension_publish` | 当前 Agent 只能读取/发布自己会话中的 Cordis；发布继续走 DSH ask grant |
| SDK | `myExtensions()`、`publishMyExtension()` | 同源 Host API、能力探测、结构化错误、调用者负责取得用户明确发布意图 |

## 不在本次范围

- 修改 DSH 源码或让 Dynamic Cordis 跨重启自动恢复。
- 把任意 npm/Git 第三方插件认定为当前用户创作。
- 自动把 persisted-only 普通 Profile package 转为 Arkme 发布制品。
- 修改扩展市场服务端发布协议、签名协议或官方插件清单。
- 发布 npm、推送分支、创建 PR、部署或替换用户常驻 DSH。

## 验收标准

1. “我的发布”全部改为“我的扩展”。
2. 同时准备一个当前账号 Cordis Plugin、一个当前账号本地 `link:` Bundle 和一个当前账号云端扩展时，列表展示三种状态且没有 DSH 官方 bundle。
3. 同一 Cordis 发布成功后由一行 `Cordis 临时` 更新为一行 `Cordis 临时 · 已发布`，不新增重复行。
4. 当前账号安装的第三方市场扩展不出现在“我的扩展”。
5. 切换 Arkme 账号后，前一账号绑定的 Cordis、本地与云端项目均不可见。
6. 云端暂时失败时 Cordis 和本地行仍可见，并显示非阻塞降级提示。
7. UI、Tool 和 SDK 返回一致的条目、状态和发布结果语义。
8. UI/SDK 不出现本地绝对路径、signed URL、headers、Token、私钥或其他账号身份。
9. 未修改的官方 DSH 中，真实会话能发现并调用 `arkme_extension_list_mine`，并能在用户确认后发布确切 Cordis Package。
10. `.tgz` 在全新临时 `DSH_HOME`/Profile 中安装后，通过真实扩展市场页面完成列表与发布场景；常驻 DSH 不受影响。

## 实施证据（2026-08-20）

- Host owner、UI、Tool、SDK 和 Profile scanner 已在 Arkme 插件隔离分支实现。
- 全量 79 个测试文件：78 passed、1 skipped；484 个测试：483 passed、1 skipped。
- `pnpm typecheck`、`pnpm build`、`pnpm run verify:call-assets`、`git diff --check` 通过。
- clean-build `.tgz` 只包含当前 hash chunk，无本机路径或测试凭据；全新临时 DSH Profile 通过官方 CLI 安装并启动。
- 真实 Host capability 暴露 `myExtensions` / `extensionPublish`；真实浏览器显示云端 owned 与临时 `link:` Bundle，未显示 DSH base/web 或“我的发布”。
- 真实 DSH ToolRuntime 可见并执行 `arkme_extension_list_mine`；独立 tarball SDK Consumer 类型检查通过。
- 未执行真实扩展发布写入：发布 owner、授权、确切 Package、幂等和 lineage 由自动化测试覆盖；没有获得用户对正式扩展市场写入的额外授权。
