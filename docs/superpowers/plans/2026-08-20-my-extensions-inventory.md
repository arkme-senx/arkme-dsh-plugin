# “我的扩展”统一清单实施计划

**Execution status:** Completed on 2026-08-20; final evidence is recorded in the linked spec and the section at the end of this plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将扩展市场“我的发布”改为账号隔离的“我的扩展”，统一展示当前用户创建的 Cordis、本地持久化和云端发布状态，排除 DSH 官方及第三方安装插件，并允许从 Cordis 卡片复用现有发布链。

**Architecture:** 新增 Host-owned `ArkmeOwnedExtensionInventory`，从 Dynamic Cordis、Profile 本地 Bundle 和云端 `my-list` 三个权威源读取事实，由账号归属/血缘 SQLite 合并成安全投影。UI、Tool、SDK 只消费该 owner；UI/SDK 用短时 `ownedRef` 发布，Tool 继续用当前 Agent 的确切 `pluginId + packageId`，两条适配器最终调用同一个 `publishCordis()`。

**Tech Stack:** TypeScript 6、React 18、Node `DatabaseSync`、DSH/Cordis public services、Vitest、pnpm 11、`.arkext` publish session。

**Spec:** `docs/superpowers/specs/2026-08-20-my-extensions-inventory-design.md`

## Global Constraints

- 业务代码只写入基于最新 `origin/master` 的 Arkme 插件隔离 worktree；DSH 仓只读。
- 实际执行基线为 `0ec0ff41eb1c73519f4b11ffcc2bef2be6615d09`；执行前已重新 fetch 并验证 live `origin/master`，不得把该历史 SHA 当作永远最新。
- 不扫描全部 `dsh.profile.bundles` 再维护官方黑名单；只正向接纳账号归属明确的 Cordis、local-spec Profile dependency 和云端 `my-list`。
- `@arkme-local/ext-*` 只有在云端 owner 或已有创建血缘证明属于当前账号时才进入列表。
- 不按名称或源码摘要猜合并；只使用 `extension_id`、Profile package identity 和已持久化血缘。
- UI/SDK 不暴露本地路径、Agent 定位、signed URL/headers、Token、密钥或其他账号 userId。
- Dynamic Cordis 缺失、Profile 单项损坏或云端不可用均采用分源降级，不清空其他已证实状态。
- UI 新增 Host 查询和发布命令必须同时覆盖 Tool、SDK 与共用 Host owner。
- 发布仍要求 DSH `>=0.1.0-rc.7`、确切 Package、空 MVP permissions、幂等键和用户明确意图。
- 本次不修改服务端发布/签名协议，不实现 persisted-only 普通 package 的自动发布。
- commit message 必须包含中文 `功能点:`，且每个提交只包含该任务列出的文件。

---

### Task 1: 建立 OpenSpec sidecar 与统一类型合同

**Files:**
- Create in governance worktree: `openspec/changes/c20260820-arkme-my-extensions-inventory/proposal.md`
- Create in governance worktree: `openspec/changes/c20260820-arkme-my-extensions-inventory/design.md`
- Create in governance worktree: `openspec/changes/c20260820-arkme-my-extensions-inventory/flow.md`
- Create in governance worktree: `openspec/changes/c20260820-arkme-my-extensions-inventory/tasks.md`
- Create in governance worktree: `openspec/changes/c20260820-arkme-my-extensions-inventory/specs/arkme-my-extensions-inventory/spec.md`
- Create in governance worktree: `openspec/changes/c20260820-arkme-my-extensions-inventory/.openspec.yaml`
- Create: `src/extensions/owned-types.ts`
- Test: `tests/extensions/owned-types.test.ts`

**Interfaces:**
- Produces: `ArkmeMyExtensionItem`, `ArkmeMyExtensionPage`, `ArkmeMyExtensionState`, `ArkmeMyExtensionWarning`, `ArkmeMyExtensionPublishInput`。
- Consumes: 设计 spec 中的准入、合并、安全投影与失败语义。

- [ ] **Step 1: 写 OpenSpec artifacts**

在新的 meta worktree 中用 `OPENSPEC_TELEMETRY=0` 建立 `c20260820-arkme-my-extensions-inventory`。proposal 写明用户结果与三源边界；design 固化数据 owner、账号归属、血缘、部分失败和 capability matrix；flow 写出 list/publish/account-switch 时序；spec 使用 SHALL/MUST 场景逐条覆盖本计划验收标准；tasks 映射本计划 Task 1–8。

- [ ] **Step 2: 校验 OpenSpec**

Run:

```bash
OPENSPEC_TELEMETRY=0 openspec validate c20260820-arkme-my-extensions-inventory --strict
```

Expected: `valid`，无缺失 artifact、未映射 requirement 或 schema 错误。

- [ ] **Step 3: 写统一类型的失败测试**

在 `tests/extensions/owned-types.test.ts` 固定 JSON-safe 投影：

```ts
const item: ArkmeMyExtensionItem = {
  ownedRef: 'owned-ref',
  name: '天气助手',
  description: '展示天气',
  states: ['cordis', 'published'],
  halves: { host: true, client: false },
  cordis: { packageCount: 2, active: true },
  published: { extensionId: 'ext-1', version: '1.0.0', visibility: 'private' },
  publish: { allowed: true, mode: 'version' },
}
expect(JSON.parse(JSON.stringify(item))).toEqual(item)
expect(item).not.toHaveProperty('artifactPath')
expect(item).not.toHaveProperty('sessionId')
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm vitest run tests/extensions/owned-types.test.ts`

Expected: FAIL，因为 `src/extensions/owned-types.ts` 尚不存在。

- [ ] **Step 5: 实现最小类型合同**

在 `src/extensions/owned-types.ts` 定义：

```ts
export type ArkmeMyExtensionState = 'cordis' | 'persisted' | 'published'
export type ArkmeMyExtensionWarning = 'cloud-unavailable' | 'cordis-unavailable' | 'profile-entry-invalid'

export interface ArkmeMyExtensionItem {
  ownedRef: string
  name: string
  description: string
  states: ArkmeMyExtensionState[]
  halves: { host: boolean; client: boolean }
  cordis?: { packageCount: number; active: boolean }
  persisted?: { packageName: string; version?: string; active: boolean }
  published?: { extensionId: string; version?: string; visibility: 'private' | 'unlisted' | 'public' }
  publish: { allowed: boolean; mode?: 'new' | 'version'; reason?: string }
}

export interface ArkmeMyExtensionPage {
  items: ArkmeMyExtensionItem[]
  warnings: ArkmeMyExtensionWarning[]
}

export interface ArkmeMyExtensionPublishInput {
  ownedRef: string
  name: string
  description: string
  version: string
  visibility: 'private' | 'unlisted' | 'public'
  changelog?: string
  clientMutationId: string
}
```

- [ ] **Step 6: 运行类型测试**

Run: `pnpm vitest run tests/extensions/owned-types.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/extensions/owned-types.ts tests/extensions/owned-types.test.ts
git commit -m "feat(extensions): 功能点: 定义我的扩展统一合同"
```

Meta OpenSpec 使用单独提交：

```bash
git add openspec/changes/c20260820-arkme-my-extensions-inventory
git commit -m "docs(openspec): 功能点: 定义我的扩展统一清单"
```

### Task 2: 持久化账号归属、血缘和短时引用

**Files:**
- Create: `src/extensions/owned-store.ts`
- Create: `src/extensions/owned-refs.ts`
- Test: `tests/extensions/owned-store.test.ts`
- Test: `tests/extensions/owned-refs.test.ts`

**Interfaces:**
- Consumes: `ArkmeMyExtensionPublishInput.ownedRef`。
- Produces: `ArkmeOwnedExtensionStore.bindCordis()`, `bindProfile()`, `linkCloud()`, `cordisOwner()`, `profileOwner()`, `cloudLink()`；`ArkmeOwnedExtensionRefs.issue()` / `resolve()`。

- [ ] **Step 1: 写账号隔离和迁移失败测试**

覆盖以下精确行为：

```ts
store.bindCordis({ hostInstanceId: 'i1', agentId: 's1', pluginId: 'p1', creatorUserId: 7 })
expect(store.cordisOwner('i1', 's1', 'p1')).toBe(7)
expect(() => store.bindCordis({ hostInstanceId: 'i1', agentId: 's1', pluginId: 'p1', creatorUserId: 8 }))
  .toThrow('已属于其他 Arkme 账号')

store.bindProfile({ profileName: 'web', packageName: 'local-weather', specDigest: 'a'.repeat(64), creatorUserId: 7 })
store.linkCloud({ creatorUserId: 7, sourceKind: 'cordis', sourceKey: 'i1\0s1\0p1', extensionId: 'ext-1' })
expect(store.cloudLink(7, 'cordis', 'i1\0s1\0p1')).toBe('ext-1')
```

测试旧数据库自动增加表、相同 owner 幂等、跨账号重绑拒绝、关闭后重开保持数据、数据库/WAL/SHM 权限为 `0600`。

- [ ] **Step 2: 运行 store 测试确认失败**

Run: `pnpm vitest run tests/extensions/owned-store.test.ts`

Expected: FAIL，因为 store 尚不存在。

- [ ] **Step 3: 实现 SQLite owner**

`owned-store.ts` 在扩展 state directory 中创建 `owned-extensions.sqlite3`，包含：

```sql
CREATE TABLE cordis_owners (
  host_instance_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  creator_user_id INTEGER NOT NULL,
  created_at_millis INTEGER NOT NULL,
  PRIMARY KEY (host_instance_id, agent_id, plugin_id)
);
CREATE TABLE profile_owners (
  profile_name TEXT NOT NULL,
  package_name TEXT NOT NULL,
  spec_digest TEXT NOT NULL,
  creator_user_id INTEGER NOT NULL,
  claimed_at_millis INTEGER NOT NULL,
  PRIMARY KEY (profile_name, package_name)
);
CREATE TABLE extension_lineage (
  creator_user_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('cordis', 'profile')),
  source_key TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  updated_at_millis INTEGER NOT NULL,
  PRIMARY KEY (creator_user_id, source_kind, source_key)
);
```

所有写入使用 `BEGIN IMMEDIATE`，冲突时先读 owner 并拒绝跨账号覆盖。

- [ ] **Step 4: 运行 store 测试**

Run: `pnpm vitest run tests/extensions/owned-store.test.ts`

Expected: PASS。

- [ ] **Step 5: 写不透明引用失败测试**

```ts
const refs = new ArkmeOwnedExtensionRefs({ ttlMillis: 60_000, maxEntries: 100, now: () => 1000 })
const ref = refs.issue(7, { kind: 'cordis', agentId: 's1', pluginId: 'p1', packageId: 'pkg-1' })
expect(ref).not.toContain('s1')
expect(refs.resolve(7, ref)).toMatchObject({ kind: 'cordis', packageId: 'pkg-1' })
expect(() => refs.resolve(8, ref)).toThrow('引用不属于当前账号')
```

再覆盖 TTL 过期、容量淘汰和单次 DSH 进程重启后 ref 不可复用。

- [ ] **Step 6: 实现并验证引用表**

`owned-refs.ts` 使用 `randomUUID()` 生成 `owned_` 前缀引用，Map 值包含 `userId`、精确 target 和 `expiresAtMillis`；`resolve()` 后仍由业务 owner 重新验证账号、Agent 和 Package 存在性。

Run: `pnpm vitest run tests/extensions/owned-refs.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/extensions/owned-store.ts src/extensions/owned-refs.ts tests/extensions/owned-store.test.ts tests/extensions/owned-refs.test.ts
git commit -m "feat(extensions): 功能点: 持久化扩展归属与血缘"
```

### Task 3: 读取本地 Profile 自建 Bundle，结构性排除官方插件

**Files:**
- Create: `src/extensions/profile-owned-inventory.ts`
- Test: `tests/extensions/profile-owned-inventory.test.ts`

**Interfaces:**
- Consumes: `profileDirectory`, `profileName`, 当前 `userId`, 云端 owned extension IDs, `ArkmeOwnedExtensionStore`。
- Produces: `scanOwnedProfileExtensions(): { items: OwnedProfileExtension[]; warnings: ArkmeMyExtensionWarning[] }`。

- [ ] **Step 1: 写 Profile fixture 测试**

用带空格临时目录创建：

```json
{
  "dependencies": {
    "local-weather": "link:../My Local Weather",
    "local-file": "file:../My File Plugin",
    "registry-third-party": "^1.0.0",
    "git-third-party": "github:owner/plugin",
    "@arkme-local/ext-aaaaaaaaaaaaaaaa": "link:arkme-extensions/a/1.0.0"
  },
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "local-weather", "local-file"
  ] } }
}
```

断言：

- `local-weather`、目录型 `local-file` 声明有效 `dsh.bundle.patch` 后进入候选。
- registry、Git、tarball、缺 package.json、缺 patch、patch 越界或 package name 不匹配的 dependency 被跳过并产生一个去重 warning。
- `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 不进入候选，因为它们不是 local dependencies。
- `@arkme-local/ext-*` 只有 installation extension ID 位于当前 `my-list` 时进入。
- 已绑定 user 7 的本地 package 在 user 8 下不出现。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/extensions/profile-owned-inventory.test.ts`

Expected: FAIL，因为 scanner 尚不存在。

- [ ] **Step 3: 实现安全 scanner**

实现规则：

```ts
export interface OwnedProfileExtension {
  sourceKey: string
  packageName: string
  version?: string
  name: string
  description: string
  active: boolean
  halves: { host: boolean; client: boolean }
  extensionId?: string
}
```

只接受 `link:` 和指向目录的 `file:`；相对路径以 Profile directory 解析；使用 Node path/URL API，禁止 `..` 逃逸检查误删合法带空格路径。读取 resolved `package.json` 后校验其 `name` 等于 dependency key、`dsh.bundle.patch` 是包内普通文件。绝对路径只留在 Host 内部，不写入返回对象或日志。

- [ ] **Step 4: 实现首次账号绑定**

普通 local dependency 在当前已认证账号首次发现时调用 `bindProfile()`；`@arkme-local/ext-*` 不自动绑定，必须先从 `installation.json.extension_id` 与当前云端 owned IDs/既有 lineage 得到归属证明。

- [ ] **Step 5: 运行跨平台路径测试**

Run: `pnpm vitest run tests/extensions/profile-owned-inventory.test.ts`

Expected: PASS，包括 POSIX、Windows 风格分隔符 fixture、带空格目录和非法路径用例。

- [ ] **Step 6: 提交**

```bash
git add src/extensions/profile-owned-inventory.ts tests/extensions/profile-owned-inventory.test.ts
git commit -m "feat(extensions): 功能点: 识别账号自建本地扩展"
```

### Task 4: 绑定 Cordis 创建者并实现三源 Host owner

**Files:**
- Create: `src/extensions/owned-inventory.ts`
- Modify: `src/extensions/types.ts`
- Modify: `src/extensions/manager.ts`
- Modify: `src/extensions/publish-client.ts`
- Modify: `src/index.ts`
- Test: `tests/extensions/owned-inventory.test.ts`
- Modify: `tests/extensions/artifact.test.ts`

**Interfaces:**
- Consumes: `DynamicCordisRunnerLike.inventory()`, `inspectPackage()`, `ArkmeService.providerState()`, Profile scanner、云端 `my-list`、owner store、refs、`ArkmeExtensionManager.publish()`。
- Produces: `ArkmeOwnedExtensionInventory.captureCordisDefinition()`, `list()`, `publishCordis()`；扩展后的 `DynamicCordisRunnerLike.inventory()`。`ArkmeOwnedExtensionInventory` 在构造时生成并持有自己的进程实例 ID，调用者不得引用 `host-api.ts` 的私有常量。

- [ ] **Step 1: 扩展 runner duck type 并写 feature-detection 测试**

在 `src/extensions/types.ts` 增加 source-free inventory 类型和可选方法：

```ts
inventory?(): Array<{
  pluginId: string
  agentId: string
  packages: Array<{ packageId: string; name: string; purpose: string; hasHostHalf: boolean; hasClientHalf: boolean }>
  currentPackageId?: string
  nextPackageId?: string
  activeRun?: { pluginRunId: string; packageId: string }
}>
```

测试无 `inventory` 时列表保留 local/cloud 并返回 `cordis-unavailable`。

- [ ] **Step 2: 写三源合并失败测试**

构造：一个 owned Cordis、一个 linked local package、一个 cloud row；再把 Cordis lineage 和 local wrapper 都指向 cloud `ext-1`。断言只返回一行，states 固定顺序为 `['cordis', 'persisted', 'published']`。再断言同名无血缘项目保持两行、第三方 installed row 不出现、cloud reject 时 local/Cordis 仍返回。

- [ ] **Step 3: 写 Cordis Package 选择测试**

覆盖：

```ts
expect(selectPublishPackage({ packages: [p1, p2], currentPackageId: 'pkg-1', nextPackageId: 'pkg-2' }))
  .toBe('pkg-1')
expect(selectPublishPackage({ packages: [p1, p2], nextPackageId: 'pkg-2' }))
  .toBe('pkg-2')
```

第二个场景的 `pkg-2` 只有在不存在 current 且它也是定义顺序最后一个 Package 时可选；存在 current 时不得选失败/in-flight next。

- [ ] **Step 4: 运行 owner 测试确认失败**

Run: `pnpm vitest run tests/extensions/owned-inventory.test.ts`

Expected: FAIL，因为 Host owner 尚不存在。

- [ ] **Step 5: 实现 `ArkmeOwnedExtensionInventory.list()`**

签名：

```ts
async list(input: { currentSessionId?: string; signal?: AbortSignal }): Promise<ArkmeMyExtensionPage>
```

流程：读取 `providerState()` 并要求 authenticated userId；有界拉取所有 `my-list` pages；并发读取 runner inventory 和 Profile scanner；按显式 lineage 合并；排序按 published updated time、local first-seen、Cordis inventory order稳定降序；每项通过 refs owner 发放短时 `ownedRef`。

- [ ] **Step 6: 捕获 `cordis_define` 最终结果**

在 `src/index.ts` 的 dynamic injection scope 注册 `ctx.on('tools/result', ...)`。仅在 `exec.name === 'cordis_define'`、`result.isError === false`、`result.value` 含非空 `pluginId/packageId` 且 `exec.agent.id` 有效时读取当前 `providerState()`；authenticated 时调用：

```ts
inventory.captureCordisDefinition({
  agentId: exec.agent.id,
  pluginId: result.value.pluginId,
  creatorUserId: state.userId,
})
```

`captureCordisDefinition()` 使用 inventory 构造时生成的进程实例 ID 写入 store。observer 失败只记录无敏感字段的 warning，不改变 `cordis_define` 原结果。对功能上线前当前选中 session 的未绑定 Plugin，`list()` 可在当前账号下执行一次绑定；其他 session 不回填。

- [ ] **Step 7: 实现共同发布 owner**

`publishCordis()` 接受 UI/SDK 的 `ownedRef` 或 Tool 的 `{ agent, pluginId, packageId }`，重新验证当前账号、Agent ownership 和 exact Package，然后调用现有 manager publish。使用：

```ts
sha256(`my-extension-publish\0${userId}\0${sourceKey}\0${input.version}\0${input.clientMutationId}`)
```

作为 idempotency key。成功后 `linkCloud()`，失败不写 lineage。修改现有 `arkme_extension_publish` 适配器后，Tool 也必须走这个 owner。

- [ ] **Step 8: 扩展云端分页而不复制 HTTP 逻辑**

给 `ExtensionPublishClient.myList()` 保留 cursor/limit 参数；Host owner 最多读取 20 页、拒绝循环 cursor，并在达到上限时返回结构化 `cloud-unavailable` warning，不静默截断为“完整列表”。

- [ ] **Step 9: 运行 owner 与既有发布测试**

Run:

```bash
pnpm vitest run tests/extensions/owned-inventory.test.ts tests/extensions/artifact.test.ts
```

Expected: PASS；现有 artifact validation、publish recovery、安装和卸载用例无回归。

- [ ] **Step 10: 提交**

```bash
git add src/extensions/owned-inventory.ts src/extensions/types.ts src/extensions/manager.ts src/extensions/publish-client.ts src/index.ts tests/extensions/owned-inventory.test.ts tests/extensions/artifact.test.ts
git commit -m "feat(extensions): 功能点: 合并我的扩展三态数据"
```

### Task 5: 接入 Host API 与公开 SDK

**Files:**
- Modify: `src/types.ts`
- Modify: `src/host-api.ts`
- Modify: `src/sdk/index.ts`
- Modify: `tests/extensions/host-api.test.ts`
- Modify: `tests/sdk.test.ts`
- Modify: `tests/arkme-service.test.ts`

**Interfaces:**
- Consumes: `ArkmeOwnedExtensionInventory.list()` / `publishCordis()`。
- Produces: operations `extensions.mine.list`、`extensions.mine.publish`；SDK `myExtensions()`、`publishMyExtension()`；capability flags `myExtensions`、`extensionPublish`。

- [ ] **Step 1: 写 Host BFF 失败测试**

断言 list 传递 `currentSessionId`；publish 只传 `ownedRef`、表单字段和 `clientMutationId`；返回值不含 `agentId`、本地路径、upload URL/headers。把 `extensions.mine.publish` 加入同源 Origin 强制集合，无 Origin 返回 `origin-required`。

- [ ] **Step 2: 运行 Host 测试确认失败**

Run: `pnpm vitest run tests/extensions/host-api.test.ts`

Expected: FAIL，operation 未注册。

- [ ] **Step 3: 实现 Host operations**

将两项加入 `ArkmePluginOperation`，以便外部 SDK 类型安全调用；`ArkmeHostApiOptions` 注入 inventory getter；dispatch 只做参数提取，不复制归属/合并/发布逻辑。`extensions.mine.publish` 必须要求同源 Origin。

- [ ] **Step 4: 写 SDK 失败测试**

```ts
await sdk.myExtensions({ currentSessionId: 'session-1' })
await sdk.publishMyExtension({
  ownedRef: 'owned-ref', name: '天气', description: '天气卡片', version: '1.0.0',
  visibility: 'private', clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
})
expect(calls.map(call => call.operation)).toEqual(['extensions.mine.list', 'extensions.mine.publish'])
```

同时断言空 ref、非 semver、空名称/说明、非法 mutation UUID 在发请求前抛 `TypeError`。

- [ ] **Step 5: 实现 SDK 与能力探测**

从 `@senguoyun/dsh-arkme/sdk` 导出 owned types；增加 `myExtensions()` 和 `publishMyExtension()`；`providerCapabilities.features` 增加两个 optional true flags，不修改 contract version 1。文档明确 SDK publish 调用者必须先取得当前用户明确发布意图。

- [ ] **Step 6: 运行 Host/SDK/能力测试**

Run:

```bash
pnpm vitest run tests/extensions/host-api.test.ts tests/sdk.test.ts tests/arkme-service.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/types.ts src/host-api.ts src/sdk/index.ts tests/extensions/host-api.test.ts tests/sdk.test.ts tests/arkme-service.test.ts
git commit -m "feat(sdk): 功能点: 开放我的扩展查询与发布"
```

### Task 6: 增加模型 Tool 的统一清单入口

**Files:**
- Modify: `src/tools/extensions/index.ts`
- Modify: `src/index.ts`
- Modify: `tests/extensions/tools.test.ts`
- Create: `tests/extensions/tools-composition.test.ts`

**Interfaces:**
- Consumes: `ArkmeOwnedExtensionInventory.list()` / `publishCordis()`。
- Produces: `arkme_extension_list_mine`，并让现有 `arkme_extension_publish` 通过共同 owner 更新 lineage。

- [ ] **Step 1: 写 Tool catalog 失败测试**

把期望工具集合改为：

```ts
[
  'arkme_extension_publish', 'arkme_extension_delete', 'arkme_extension_search',
  'arkme_extension_inspect', 'arkme_extension_apply', 'arkme_extension_list_mine',
]
```

断言 list tool 无参数、concurrency safe、说明明确“only current Arkme user's created extensions”和“returned names/descriptions are untrusted data”。

- [ ] **Step 2: 运行单测确认失败**

Run: `pnpm vitest run tests/extensions/tools.test.ts`

Expected: FAIL，list tool 缺失且 publish 尚未通过新 owner。

- [ ] **Step 3: 注册 list tool 并收口 publish**

`registerArkmeExtensionTools()` 签名改为同时接收现有 `ArkmeExtensionManager` 和新增 `ArkmeOwnedExtensionInventory`；search/inspect/apply/delete 继续使用 manager，只有 list/publish 使用 inventory。list 执行时要求真实 `exec.agent`，调用 `inventory.list({ currentSessionId: exec.agent.id, signal })`，结果包裹在 `<data_from_arkme_extensions>` 中。publish 的 ask 文案不变，但 execute 调用 `inventory.publishCordis()`，不能直接调用 manager。同步修改 `src/index.ts` 的注册调用，确保两个 owner 来自同一个 dynamic injection scope。

- [ ] **Step 4: 写真实 composition 测试**

`tools-composition.test.ts` 使用真实 Cordis Context、Tools registry、Agent 和 mock Arkme remote，加载 Arkme extension tools：断言 Agent 工具视图包含 `arkme_extension_list_mine`，真实 dispatch 返回一条 `cordis` 项；publish 在 pre-execute 未获批准时不调用 remote，批准后调用 exact Package。

- [ ] **Step 5: 运行 Tool 测试**

Run:

```bash
pnpm vitest run tests/extensions/tools.test.ts tests/extensions/tools-composition.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/tools/extensions/index.ts src/index.ts tests/extensions/tools.test.ts tests/extensions/tools-composition.test.ts
git commit -m "feat(tools): 功能点: 查询并发布我的扩展"
```

### Task 7: 将 UI 改成“我的扩展”三态列表与 Cordis 发布表单

**Files:**
- Create: `src/client/ArkmeExtensionPublishDialog.tsx`
- Create: `src/client/my-extension-model.ts`
- Modify: `src/client/ArkmeExtensionCenter.tsx`
- Modify: `tests/extensions/extension-center.test.tsx`
- Create: `tests/extensions/my-extension-model.test.ts`

**Interfaces:**
- Consumes: Host operations `extensions.mine.list` / `extensions.mine.publish` 和 `ArkmeMyExtensionItem`。
- Produces: “我的扩展”Tab、三态 badge、部分失败提示、发布表单、成功刷新。

- [ ] **Step 1: 写纯 view model 测试**

固定状态文案和主动作：

```ts
expect(myExtensionBadges(['cordis', 'persisted', 'published']))
  .toEqual(['Cordis 临时', '已持久化', '已发布'])
expect(myExtensionPrimaryAction(cordisOnly)).toEqual({ label: '发布', disabled: false })
expect(myExtensionPrimaryAction(persistedOnly)).toEqual({ label: '仅本地', disabled: true })
expect(myExtensionPrimaryAction(publishedOnly)).toEqual({ label: '已发布', disabled: true })
```

再覆盖 warnings 去重、published visibility 文案和不把同名条目在客户端二次合并。

- [ ] **Step 2: 运行 model 测试确认失败**

Run: `pnpm vitest run tests/extensions/my-extension-model.test.ts`

Expected: FAIL，新 model 不存在。

- [ ] **Step 3: 实现纯 model**

`my-extension-model.ts` 只做服务端状态到文案/动作的纯映射，不读取 Profile、云端或 Cordis，也不重新判断 owner。

- [ ] **Step 4: 写 UI 渲染失败测试**

更新静态 markup 断言：存在“我的扩展”，不存在“我的发布”；mock load 后一张卡同时出现三个 badge；不存在 `@deepseek-ai/dsh-base`；`cloud-unavailable` 渲染非阻塞提示；Cordis 行出现“发布”。

- [ ] **Step 5: 重构 mine tab 数据加载**

删除 `publishedItems` 和 mine 分支的 `extensions.my-list` 直连，改为：

```ts
callArkme<ArkmeMyExtensionPage>('extensions.mine.list', {
  ...(currentSessionId === undefined ? {} : { currentSessionId }),
}, signal)
```

其他 discover/installed/updates tab 行为保持不变。

- [ ] **Step 6: 实现发布表单**

`ArkmeExtensionPublishDialog` 预填 item name/description，visibility 默认 `private`，校验 semver、必填字段和 changelog 长度。提交时生成一次 `crypto.randomUUID()` 作为 `clientMutationId`，重复点击复用同一次 mutation ID 直到成功或用户修改版本。失败保留输入；成功关闭表单并静默刷新 mine tab。

- [ ] **Step 7: 完成可访问性和状态恢复**

发布表单使用 `role="dialog"`、可读标题、Escape 关闭、提交中禁用关闭/重复提交、错误使用 `role="alert"`、成功刷新使用 `role="status"`。扩展市场主对话关闭时一并清理子对话状态和 AbortController。

- [ ] **Step 8: 运行 UI 测试**

Run:

```bash
pnpm vitest run tests/extensions/my-extension-model.test.ts tests/extensions/extension-center.test.tsx
```

Expected: PASS；既有发现、已安装、更新、下载进度和无会话 Profile 安装用例继续通过。

- [ ] **Step 9: 提交**

```bash
git add src/client/ArkmeExtensionPublishDialog.tsx src/client/my-extension-model.ts src/client/ArkmeExtensionCenter.tsx tests/extensions/extension-center.test.tsx tests/extensions/my-extension-model.test.ts
git commit -m "feat(ui): 功能点: 展示并发布我的扩展"
```

### Task 8: 文档、完整门禁、打包安装和真实验收

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-20-my-extensions-inventory-design.md`
- Modify: `docs/superpowers/plans/2026-08-20-my-extensions-inventory.md`

**Interfaces:**
- Consumes: Task 1–7 的全部能力。
- Produces: 当前行为文档、完成后的 capability matrix 证据、可安装 `.tgz` 与真实 DSH 验收记录。

- [ ] **Step 1: 更新 README**

写明“我的扩展”的三种状态、当前账号隔离、local `link:`/directory `file:` 准入、DSH 官方/第三方排除、Cordis 重启消失、persisted-only 不可直接发布、SDK/Tool 方法和部分失败语义。

- [ ] **Step 2: 运行最小相关测试**

```bash
pnpm vitest run tests/extensions tests/sdk.test.ts tests/arkme-service.test.ts
```

Expected: 全部 PASS，0 个新增 skip。

- [ ] **Step 3: 运行仓库门禁**

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm run verify:call-assets
git diff --check
```

Expected: 全部 exit 0。

- [ ] **Step 4: 生成并检查 tarball**

```bash
pnpm pack --pack-destination .artifacts
tar -tf .artifacts/senguoyun-dsh-arkme-*.tgz | sort
```

Expected: tarball 包含 `lib`、`cordis.patch.yml`、README/docs；不包含源码 worktree 绝对路径、SQLite、Profile、临时文件、凭据或测试 fixture。

- [ ] **Step 5: 全新临时 DSH Profile 安装**

使用 `mktemp -d` 创建临时 `DSH_HOME`，选择空闲 loopback 端口，通过未修改的官方 DSH 执行：

```bash
DSH_HOME="$TEMP_DSH_HOME" dsh plugin --profile web add "$PLUGIN_TGZ"
DSH_HOME="$TEMP_DSH_HOME" dsh web --host 127.0.0.1 --port "$PORT"
```

Expected: 安装解析 tarball 版本，Profile bundle 激活，Host health 正常；不得使用 `link:` 作为最终证据，不触碰任何常驻实例。

- [ ] **Step 6: 真实 Tool 验收**

在临时 DSH 创建真实会话，通过 `cordis_define` 定义测试 Package。确认模型工具列表包含 `arkme_extension_list_mine`；调用后返回 Cordis row，不含官方 bundle；调用发布时出现 DSH ask，拒绝不发布，批准后 local stub publish service 收到确切 Package 且成功结果写入 lineage。

- [ ] **Step 7: 真实 UI 验收**

在临时 Profile 准备：一个当前账号 Cordis、一个 `link:` 自建 Bundle、一个云端 `my-list` fixture，以及官方 base/web bundles。打开扩展市场验证：

```text
Tab = 我的扩展
Rows = 当前账号 Cordis + 本地自建 + 云端 owned
Absent = @deepseek-ai/dsh-base + @deepseek-ai/dsh-web-app + 第三方 installed
Cordis publish success = 原行新增“已发布”，总行数不增加
Cloud failure = 本地两行保留并显示降级提示
Account switch = 前账号三类行全部隐藏
```

- [ ] **Step 8: SDK 仓外 Consumer 验收**

在临时目录安装 `.tgz`，创建只 import `@senguoyun/dsh-arkme/sdk` 的 TypeScript consumer，调用 `capabilities()`、`myExtensions()` 和类型检查 `publishMyExtension()`；不允许 private import 或复制类型。

Expected: consumer `tsc --noEmit` PASS；不支持能力版本时得到明确 feature absence/结构化错误。

- [ ] **Step 9: 跨平台结论**

确认 macOS 真实安装与 UI/Tool/SDK 验收结果；Windows/Linux 由 CI 跑 Profile local-spec 和路径测试。若没有目标平台真实运行证据，最终只报告“实现已消除路径耦合，Windows/Linux 待 CI/真机验收”，不得声明已保证。

- [ ] **Step 10: 最终自审与提交**

```bash
git status --short
git diff origin/master...HEAD --stat
git diff origin/master...HEAD -- src tests README.md docs
git diff --check origin/master...HEAD
```

确认 diff 只含本任务文件，DSH tracked 状态与开始时一致，计划和 spec 的 capability matrix 填入实际证据后提交：

```bash
git add README.md docs/superpowers/specs/2026-08-20-my-extensions-inventory-design.md docs/superpowers/plans/2026-08-20-my-extensions-inventory.md
git commit -m "docs(extensions): 功能点: 记录我的扩展验收合同"
```

不 push、不创建 PR、不发布 npm、不部署，除非用户另行明确要求。

## Final Evidence

- OpenSpec `c20260820-arkme-my-extensions-inventory` strict validation passed in an isolated meta worktree.
- Full suite: 78 passed test files + 1 skipped; 483 passed tests + 1 skipped.
- Typecheck, build, call-asset verification and diff check all exited 0.
- Clean tarball was generated and inspected without stale hash chunks, local paths or test credentials; its exact SHA is reported outside the packaged plan to avoid a self-referential artifact hash.
- Fresh official DSH Profile installed `@senguoyun/dsh-arkme@0.2.19` from the tarball and booted successfully.
- Browser acceptance: “我的扩展” rendered cloud owned and local `link:` entries; DSH base/web and “我的发布” were absent.
- ToolRuntime acceptance: `arkme_extension_list_mine` was model-visible and executed with an exact Agent session identity.
- External SDK acceptance: a clean tarball Consumer compiled `myExtensions()` and `publishMyExtension()` without private imports.
