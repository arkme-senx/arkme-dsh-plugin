# Bundle-first 扩展市场实施计划

> 执行方式：用户已选择当前会话内顺序实施，功能整体完成后统一复核；不拆分子代理检查点。

> 兼容修订（2026-08-20）：新发布保持 Bundle v2-only；历史 `.arkext` 的服务端只读解析与插件安装必须保留到迁移和客户端覆盖验收完成。

**Goal:** 让 Dynamic Cordis、本地 DSH Bundle 目录和本地 Bundle tarball 都发布为唯一的标准 `bundle.tgz`，市场安装直接使用官方 DSH CLI，不再生成 `.arkext` wrapper Bundle。

**Architecture:** `jotmo-extension-publish` 是 v2 Bundle/source、版本、签名和迁移 owner；`arkme-dsh-plugin` 是三种本地来源的校验/物化、UI/SDK/Tool 编排和安装回滚 owner；未修改的 DSH CLI 是 Profile 写入 owner。旧 `.arkext` 只在一次迁移窗口中读取，最终 API 只接受/返回 v2 Bundle。

**Tech Stack:** Go 1.24、Gin、MongoDB、OSS、Ed25519、TypeScript 6、Node 22、pnpm 11、Vitest、React、SQLite、官方 DSH CLI。

**设计合同：** `docs/superpowers/specs/2026-08-20-bundle-first-extension-market-design.md`

## 0. 已核实基线与执行目录

| 仓库 | 规划时基线 | 规划 worktree | 实施要求 |
| --- | --- | --- | --- |
| `arkme-senx/arkme-dsh-plugin` | `origin/master=3425a07` | `/Users/apple/hehs/arkme-dsh-plugin-c20260820-bundle-first-market-plan` | 唯一插件业务代码可写根 |
| `jotmo-extension-publish` | `master=3c7f40c` | `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first-plan-readonly` | 当前只读快照；实施前另建任务 worktree |
| `jotmo-meta` | `origin/master=61a3fe64` | `/Users/apple/hehs/senqisi_refactor/.worktrees/c20260820-arkme-bundle-first-market-meta` | 只写本 change |
| DSH | 当前 `/Users/apple/hehs/dsh` checkout | `/Users/apple/hehs/dsh` | 只读；不建修复分支、不提交 |

当前“我的扩展”实现位于提交 `ae61f3f`、`b41ba96`，其旧基线为 `f255fce`。实施时先把这两个提交移植到最新插件任务分支；不得 rebase 或修改仍在运行演示实例使用的 `/Users/apple/hehs/arkme-dsh-plugin-c20260820-my-extensions-plan`。

## 1. 能力矩阵

| 能力 | Host owner | UI | SDK | Tool |
| --- | --- | --- | --- | --- |
| 列出我的 Cordis/本地/云端扩展及发布资格 | `ArkmeOwnedExtensionInventory.list()` | “我的扩展” | `myExtensions()` | `arkme_extension_list_mine` |
| 发布 Cordis 或本地 Bundle | `ArkmeOwnedExtensionInventory.publish()` | 发布 Dialog | `publishMyExtension()` | `arkme_extension_publish` |
| 预览并安装 Bundle | `ArkmeExtensionManager.previewInstall/apply()` | 市场详情/安装确认 | 只暴露安全 preview，不暴露 URL | Tool 保留明确安装确认与 grant |
| 更新/卸载/回滚 | `ArkmeExtensionManager` + profile helper | 已安装/更新页 | 现有安全能力 | 现有 Tool 能力 |

三个消费面不得返回本地路径、Agent/Package 定位、source object、预签名 URL/headers、Bearer Token 或签名私钥。

---

### Task 1: 建立最新实施分支并移植“我的扩展”前置实现

**Files:**
- Modify only through cherry-pick: files owned by commits `ae61f3f` and `b41ba96`
- Verify: `docs/superpowers/specs/2026-08-20-my-extensions-inventory-design.md`
- Verify: `docs/superpowers/plans/2026-08-20-my-extensions-inventory.md`

- [ ] **Step 1: 复核规划分支仍来自最新 master**

Run:

```bash
cd /Users/apple/hehs/arkme-dsh-plugin-c20260820-bundle-first-market-plan
git fetch origin master --prune
git rev-parse HEAD
git rev-parse origin/master
git rev-list --left-right --count HEAD...origin/master
git status --short --branch
```

Expected: 在开始移植前 `HEAD == origin/master`、ahead/behind 为 `0 0`、工作区只包含本计划已提交文档或完全干净。

- [ ] **Step 2: 移植前置提交，不动旧演示 worktree**

Run:

```bash
git cherry-pick ae61f3f b41ba96
```

Expected: “我的扩展”代码、测试和旧设计文档进入当前最新基线；若冲突，只在本任务 worktree 依据最新 owner 解决，不修改原分支。

- [ ] **Step 3: 建立前置测试基线**

Run:

```bash
pnpm install --frozen-lockfile
pnpm vitest run tests/extensions/owned-inventory.test.ts tests/extensions/profile-owned-inventory.test.ts tests/extensions/my-extension-model.test.ts tests/extensions/extension-center.test.tsx
pnpm typecheck
```

Expected: 现有“我的扩展”行为通过，且“只有 Cordis 可发布”的断言仍能被后续 Task 6 的失败测试捕获。

- [ ] **Step 4: 创建发布服务实施 worktree**

Run:

```bash
cd /Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first-plan-readonly
git fetch origin master --prune
git worktree add -b codex/c20260820-bundle-first-extension-market /Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first origin/master
cd /Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first
git rev-list --left-right --count HEAD...origin/master
git status --short --branch
go test ./...
```

Expected: 服务 worktree 为 `0 0`、干净，现有 v1 全量 Go 测试通过。

---

### Task 2: 发布服务持久化 v2 Bundle/source 与全局 package identity

**Files:**
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/models.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/repository.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/mutation.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/memory_store.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/memory_repository.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/memory_mutation.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/mongo_store.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/mongo_repository.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/mongo_mutation.go`
- Test: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/mongo_repository_test.go`
- Test: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/service_test.go`

**Contract:**

```go
type Extension struct {
    // existing fields...
    PackageName string `bson:"package_name,omitempty" json:"package_name,omitempty"`
}

type ExtensionVersion struct {
    // existing audit fields remain during migration window
    ArtifactContractVersion int64  `bson:"artifact_contract_version,omitempty" json:"artifact_contract_version"`
    ArtifactKind            string `bson:"artifact_kind,omitempty" json:"artifact_kind"`
    ExecutionModel          string `bson:"execution_model,omitempty" json:"execution_model"`
    BundleObjectKey         string `bson:"bundle_object_key,omitempty" json:"-"`
    BundleSize              int64  `bson:"bundle_size,omitempty" json:"bundle_size"`
    BundleSHA256            string `bson:"bundle_sha256,omitempty" json:"bundle_sha256"`
    PackageJSONSHA256       string `bson:"package_json_sha256,omitempty" json:"package_json_sha256"`
    SourceObjectKey         string `bson:"source_object_key,omitempty" json:"-"`
    SourceSize              int64  `bson:"source_size,omitempty" json:"-"`
    SourceSHA256            string `bson:"source_sha256,omitempty" json:"source_sha256"`
}

type PublishSession struct {
    // existing fields remain during migration window
    ArtifactContractVersion int64
    ArtifactKind            string
    ExecutionModel          string
    BundleStagingObjectKey  string
    SourceStagingObjectKey  string
    ExpectedBundleSize      int64
    ExpectedBundleSHA256    string
    ExpectedPackageJSONSHA256 string
    ExpectedSourceSize      int64
    ExpectedSourceSHA256    string
}
```

- [ ] **Step 1: 写失败测试固定模型、幂等和唯一性**

在 `service_test.go` 覆盖：

```go
request := CreatePublishRequest{
    ArtifactContractVersion: 2,
    ArtifactKind: "dsh-bundle-tgz",
    PackageName: "@example/weather-bundle",
    ExecutionModel: "dsh-native",
    Version: "1.2.3",
    BundleSize: 1024,
    BundleSHA256: strings.Repeat("a", 64),
    PackageJSONSHA256: strings.Repeat("b", 64),
    SourceSize: 512,
    SourceSHA256: strings.Repeat("c", 64),
}
```

断言同一 owner+idempotency 完全相同输入重放，任一 Bundle/source 字段改变返回 `ErrIdempotencyMismatch`；另一扩展/owner 复用 `package_name` 返回 `ErrConflict`；同一扩展升级版本可继续使用原 package name，换名被拒绝。

- [ ] **Step 2: 运行失败测试**

Run:

```bash
go test ./internal/extension ./internal/publication -run 'Test.*(BundleV2|PackageName|Idempotency)'
```

Expected: FAIL，因为 v2 字段、唯一索引和 mutation 合同尚不存在。

- [ ] **Step 3: 实现内存/Mongo 对等持久化**

- `Extension.PackageName` 保存全局 package identity。
- Mongo 增加 `package_name` unique sparse index，旧 v1 文档没有字段时不冲突。
- `CreatePublish` 对 v2 session 的 package name 和双对象摘要做原子/可重入校验。
- `PublishVersionInput` 一次写入 Bundle/source、签名和 published 状态；任何失败不得只推进其中一半。
- `cloneVersion/cloneSession` 覆盖所有新字段。

- [ ] **Step 4: 运行 store 测试并格式化**

Run:

```bash
gofmt -w internal/extension/*.go
go test ./internal/extension
```

Expected: memory/Mongo 同一合同通过，旧文档读取不 panic。

- [ ] **Step 5: 提交服务模型**

Run:

```bash
git add internal/extension
git commit -m "feat(extensions): 功能点: 持久化 Bundle v2 制品合同"
```

---

### Task 3: 发布服务校验标准 DSH Bundle 与 owner-only source

**Files:**
- Create: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/archive.go`
- Create: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/bundle_validator.go`
- Create: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/source_validator.go`
- Create: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/bundle_validator_test.go`
- Create: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/source_validator_test.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/validator.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/go.mod`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/go.sum`

**Interfaces:**

```go
type BundleValidationResult struct {
    BundleSHA256      string
    PackageJSONSHA256 string
    PackageName       string
    Version           string
    ExecutionModel    string
    PatchIDs          []string
}

func ValidateBundle(reader io.Reader, expectedSize int64) (*BundleValidationResult, error)
func ValidateSource(reader io.Reader, expectedSize int64) (sourceSHA256 string, err error)
```

- [ ] **Step 1: 写安全矩阵失败测试**

`bundle_validator_test.go` 用内存 tar fixture 覆盖：

- 合法 `package/package.json + patch + lib`。
- gzip trailing data、重复路径、绝对路径、`../`、反斜杠、symlink、hardlink、device、超量文件/字节。
- package 缺 `files`、patch 逃逸、非 SemVer、保留 package name。
- 非空 scripts、dependencies、optional/bundledDependencies、bin、`.node`。
- patch 非 insert、id 非 package hash namespace、name 指向其他 package、重复 id。
- 请求 execution model 与服务端根据 Bundle 结构推导的结果不一致；普通 Bundle 缺 marker 时必须推导为 `dsh-native`，只有结构匹配的 Arkme Runtime 包可成为 `arkme-sandboxed`。

`source_validator_test.go` 覆盖普通文件安全归档、路径逃逸、链接、重复路径、大小/数量上限；断言源码校验从不返回内容或对象 key。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
go test ./internal/publication -run 'TestValidate(Bundle|Source)'
```

Expected: FAIL，因为两个 validator 尚不存在。

- [ ] **Step 3: 实现共享 archive reader**

`archive.go` 只接受单一 gzip member 和规范 `package/`（Bundle）或 `source/`（source）前缀；以 `io.LimitedReader` 同时计算 gzip bytes SHA 和解包总量。不要写入长期临时目录，不跟随链接，不执行 JS。

- [ ] **Step 4: 实现 manifest/patch 策略**

把 `gopkg.in/yaml.v3` 提升为直接依赖。使用严格 JSON 解码 package manifest；YAML 使用 `yaml.Node` 检查结构和 tag，禁止自定义 executable tag。package namespace 为：

```go
prefix := "arkme-" + hex.EncodeToString(sha256.Sum256([]byte(packageName))[:])[:16] + "-"
```

实现时先把数组结果保存再切片，避免对不可寻址的 `sha256.Sum256` 临时值直接取 slice。

- [ ] **Step 5: 保留 v1 validator 仅供迁移**

将现有 `ValidateArtifact` 和 `FormatVersion=1` 移到清晰的 legacy 区域/文件注释中，正常 create/complete 不再调用它；Task 5 迁移完成、v1 gate 删除后再移除。

- [ ] **Step 6: 运行测试、race 与格式化**

Run:

```bash
gofmt -w internal/publication/*.go
go test ./internal/publication
go test -race ./internal/publication
```

Expected: 所有 Bundle/source/legacy test 通过，无 data race。

- [ ] **Step 7: 提交服务校验器**

Run:

```bash
git add internal/publication go.mod go.sum
git commit -m "feat(extensions): 功能点: 校验标准 DSH Bundle 制品"
```

---

### Task 4: 发布服务双上传、v2 签名与直接安装解析

**Files:**
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/service.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/signer.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/signer_test.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/publication/service_test.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/gin/api/router_test.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/gin/api/router.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/storage/provider.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/storage/local.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/storage/oss.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/README.md`

- [ ] **Step 1: 写 API 合同失败测试**

固定以下行为：

- create 必须收到 `artifact_contract_version=2` 和两组 size/SHA。
- response 有 `bundle_upload`、`source_upload`，无顶层旧 `upload_url`。
- complete 在两个对象都上传前失败；其中一个摘要错误会整体 rejected。
- validation 全部成功后才 promote 到 `bundles/sha256/<sha>.tgz` 与 `sources/sha256/<sha>.tgz`。
- `resolve-install` 返回 `bundle_url` 和 v2 签名，不返回 source URL/object key。
- `dsh-native` 返回 `requires_native_confirmation=true`，`arkme-sandboxed` 为 false。

- [ ] **Step 2: 写 Go/TypeScript 共用的固定签名向量**

Go canonical payload 必须精确等于：

```json
{"format_version":2,"artifact_kind":"dsh-bundle-tgz","extension_id":"ext_vector","package_name":"@example/vector","version":"1.2.3","execution_model":"arkme-sandboxed","bundle_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","package_json_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","source_sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","published_at":1780000000000,"signing_key_id":"test-key-v2"}
```

把 payload、公钥和签名写入 `signer_test.go`；Task 6 在 TypeScript 侧复制相同字面量并验签，防止字段顺序和时间单位漂移。

- [ ] **Step 3: 运行失败测试**

Run:

```bash
go test ./internal/publication ./gin/api -run 'Test.*(BundleV2|DualUpload|ResolveInstall|SigningV2)'
```

Expected: FAIL，因为 service 和 signer 仍返回 v1。

- [ ] **Step 4: 实现 create/complete/status**

- session 创建两条独立 staging key 和预签名 PUT。
- upload content type 分别为 `application/vnd.dsh.bundle+gzip` 与 `application/vnd.arkme.extension-source+gzip`。
- complete 顺序为：stat 两对象 -> validate 两对象 -> 比对 request identity -> promote 两对象 -> v2 sign -> 单次 mutation publish -> 清理 staging。
- promotion 或 mutation 中断必须可幂等重试，不覆盖不同 SHA 的已发布版本。

- [ ] **Step 5: 实现 v2 resolve/update**

`ResolveInstallResult` 使用 `BundleURL/BundleHeaders/BundleExpiresAt`；更新候选包含 package name、execution model 和 Bundle SHA。普通 API 永远不暴露 source locator。

- [ ] **Step 6: 全量服务验证并提交**

Run:

```bash
gofmt -w gin/api/*.go gin/middlewares/*.go gin/response/*.go internal/extension/*.go internal/publication/*.go storage/*.go
go test ./...
git diff --check
git add gin internal storage README.md
git commit -m "feat(extensions): 功能点: 发布并签名 Bundle v2"
```

Expected: 全量 Go test 通过；提交不包含配置秘密、真实签名 URL 或本机路径。

---

### Task 5: 一次性迁移 `.arkext` 并关闭长期双格式面

**Files:**
- Create: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/migration/bundle_v2.go`
- Create: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/migration/bundle_v2_test.go`
- Create: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/cmd/migrate-bundle-v2/main.go`
- Create: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/bootstrap/runtime.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/main.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/repository.go`
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/internal/extension/mutation.go`
- Modify: corresponding memory/Mongo repository and mutation files
- Modify: `/Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first/docs/deploy/extension-publish-production.md`

**Command contract:**

```text
go run ./cmd/migrate-bundle-v2 --config assets/config/config.yaml --dry-run
go run ./cmd/migrate-bundle-v2 --config assets/config/config.yaml --apply
```

- [ ] **Step 1: 写迁移失败测试**

覆盖：零条 no-op、单条 host/client v1 转换、多版本、重复运行、已是 v2 跳过、旧 SHA 不匹配拒绝、单条失败不标记该版本/扩展 ready、v1 object/签名仍保留审计。

- [ ] **Step 2: 运行失败测试**

Run:

```bash
go test ./internal/migration
```

Expected: FAIL，因为迁移包尚不存在。

- [ ] **Step 3: 提取共享 bootstrap**

把 `main.go` 的 store/storage/signer 构建移到 `internal/bootstrap/runtime.go`，server 与 migration command 共用；不得把 AccessKey、Mongo URL 或 private key写入 argv/log。

- [ ] **Step 4: 实现确定性 legacy 转换**

- 读取旧 object，继续用 legacy `.arkext` validator，绝不执行代码。
- 生成 `arkme-sandboxed` 标准 Bundle：package name 为 `@arkme-migrated/ext-<extension id sha256 前16位>`，入口调用插件将新增的 `@senguoyun/dsh-arkme/bundle-runtime`，源码写入包内安全数据文件。
- 生成 source snapshot、v2 SHA/signature，并通过 `MigrateVersionToBundleV2` 条件 mutation 写入同一版本。
- 新 Bundle 与 Task 6 materializer 共用固定 fixture bytes/hash；跨语言 fixture 不一致时测试失败。

- [ ] **Step 5: dry-run 与内存 apply 验证**

Run:

```bash
gofmt -w cmd/migrate-bundle-v2/*.go internal/bootstrap/*.go internal/migration/*.go internal/extension/*.go
go test ./internal/migration ./internal/bootstrap ./internal/extension
go run ./cmd/migrate-bundle-v2 --config assets/config/config.yaml --dry-run
```

Expected: local 默认数据返回结构化计数，不修改存储；日志只含数量、extension/version 和安全错误码，不含源码/object signed URL。

- [ ] **Step 6: 增加 v1 gate 清理测试**

在 `service_test.go` 固定：feature gate 关闭后，create 拒绝缺少 v2 合同的请求；resolve 对 active latest 只返回 v2。legacy validator 只可从 migration package 调用，正常 API 不可达。

- [ ] **Step 7: 提交迁移能力**

Run:

```bash
go test ./...
git diff --check
git add cmd internal main.go docs/deploy/extension-publish-production.md
git commit -m "feat(extensions): 功能点: 一次迁移旧扩展至 Bundle v2"
```

---

### Task 6: 插件实现标准 Bundle 校验、三路物化与 v2 发布客户端

**Files:**
- Create: `src/extensions/bundle-artifact.ts`
- Create: `src/extensions/bundle-materializer.ts`
- Create: `src/extensions/bundle-runtime.ts`
- Create: `tests/extensions/bundle-artifact.test.ts`
- Create: `tests/extensions/bundle-materializer.test.ts`
- Modify: `src/extensions/types.ts`
- Modify: `src/extensions/publish-client.ts`
- Modify: `src/extensions/manager.ts`
- Modify: `src/extensions/signature.ts`
- Modify: `tsdown.config.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Retire after migration: `src/extensions/artifact.ts`
- Retire after migration: `src/extensions/persistent-bundle.ts`
- Retire after migration: `src/extensions/persistent-client-bundle.ts`
- Replace tests: `tests/extensions/artifact.test.ts`
- Remove tests after equivalent coverage exists: `tests/extensions/persistent-bundle.test.ts`

**Core types:**

```ts
export type ArkmeBundleExecutionModel = 'arkme-sandboxed' | 'dsh-native'

export interface ArkmeBundleArtifact {
  bytes: Uint8Array
  bundleSha256: string
  packageJsonSha256: string
  packageName: string
  version: string
  executionModel: ArkmeBundleExecutionModel
}

export interface ArkmeBundlePublishSource {
  bundle: ArkmeBundleArtifact
  source: { bytes: Uint8Array; sourceSha256: string }
}
```

- [ ] **Step 1: 写跨语言签名和 tar 安全失败测试**

TypeScript 使用 Task 4 固定 payload/public key/signature；覆盖 Bundle tgz 的路径、链接、脚本、依赖、bin/native、patch namespace 和 package/version 校验。测试中 Bundle 目录必须包含空格，并增加 Windows 风格 dependency spec fixture。

- [ ] **Step 2: 写三路物化失败测试**

覆盖：

- 同一 Cordis inspection 两次物化 bytes/SHA 完全相同，execution model 为 `arkme-sandboxed`。
- 同一本地目录两次通过固定 pnpm 11 pack 得到相同 bytes/SHA；发布过程中不会运行 package scripts，且未声明 Arkme marker 的标准 Bundle 自动归类为 `dsh-native`。
- `file:*.tgz` 验证后 bundle bytes 不变。
- source 只包含 Bundle 已打包文件；源目录中的 `.env`、`.git`、未进入 packlist 的文件不存在于 source。

- [ ] **Step 3: 运行失败测试**

Run:

```bash
pnpm vitest run tests/extensions/bundle-artifact.test.ts tests/extensions/bundle-materializer.test.ts
```

Expected: FAIL，因为 v2 packer/materializer 尚不存在。

- [ ] **Step 4: 实现本地安全预检与 pack**

- 在执行任何子进程前读取 manifest 并拒绝非空 scripts、不受控运行依赖、bin/native、保留 package name 和 patch 越权。
- 把候选目录复制到 0700 临时 snapshot，拒绝 symlink/逃逸并施加文件数/字节上限。
- 使用 `prepareProfilePackageManager()` 验证 Profile 固定 pnpm；以 `execFile/spawn` argv 和 `shell:false`（Windows 仅 pnpm `.cmd` 窄分支）在 snapshot 执行 `pnpm pack --out <absolute temp bundle.tgz>`。
- pack 后再用独立 reader 校验最终 bytes；校验失败不创建 publish session。
- source 从安全解包的 package 文件生成，不读取 packlist 外内容。

- [ ] **Step 5: 实现 Cordis Bundle Runtime**

把现有 `persistent-runtime.ts` 的 VM、guarded Context、handler bridge 和 client wrapper迁移到 `bundle-runtime.ts`，输入改为包内 descriptor/源码 URL和 package name，不再读取外部 `.arkext`、`installation.json` 或本机 artifact path。公开 export 改为：

```json
"./bundle-runtime": {
  "types": "./lib/types/extensions/bundle-runtime.d.ts",
  "default": "./lib/bundle-runtime.js"
}
```

Cordis materializer 生成的 Bundle 只依赖这个 allowlisted peer；本地 `dsh-native` Bundle 不经过该 runtime。

- [ ] **Step 6: 切换 publish client/manager 到双上传**

`createPublishSession()` 发送 v2 字段；`uploadBundle()` 与 `uploadSource()` 分别使用 Host-only signed request；manager 先生成/验证两对象，再 create -> upload both -> complete/status recovery。status recovery 只有 `validating/published` 才视为已提交。

- [ ] **Step 7: 运行目标测试与类型检查**

Run:

```bash
pnpm vitest run tests/extensions/bundle-artifact.test.ts tests/extensions/bundle-materializer.test.ts tests/extensions/artifact.test.ts tests/arkme-service.test.ts
pnpm typecheck
```

Expected: v2 通过，旧 artifact 测试已被等价 v2 测试替代，没有 `.arkext` publish 调用。

- [ ] **Step 8: 提交插件 Bundle 核心**

Run:

```bash
git add package.json pnpm-lock.yaml tsdown.config.ts src/extensions tests/extensions tests/arkme-service.test.ts
git commit -m "feat(extensions): 功能点: 统一发布标准 DSH Bundle"
```

---

### Task 7: 让本地已持久化 Bundle 真正可发布

**Files:**
- Modify: `src/extensions/owned-types.ts`
- Modify: `src/extensions/owned-refs.ts`
- Modify: `src/extensions/owned-store.ts`
- Modify: `src/extensions/profile-owned-inventory.ts`
- Modify: `src/extensions/owned-inventory.ts`
- Modify: `tests/extensions/owned-refs.test.ts`
- Modify: `tests/extensions/owned-store.test.ts`
- Modify: `tests/extensions/profile-owned-inventory.test.ts`
- Modify: `tests/extensions/owned-inventory.test.ts`

**Target shape:**

```ts
type OwnedPublishTarget =
  | { kind: 'cordis'; agentId: string; pluginId: string; packageId: string; sourceKey: string }
  | { kind: 'profile-directory'; packageName: string; directory: string; sourceKey: string }
  | { kind: 'profile-tarball'; packageName: string; tarballPath: string; sourceKey: string }
```

真实 path 只存在 `ArkmeOwnedExtensionRefs` 的 Host 内存值中，不写入 `ArkmeMyExtensionItem`、SDK、Tool、Browser 或日志。

- [ ] **Step 1: 把原“本地无发布按钮”断言改为失败测试**

测试要求：

- 未发布且校验通过的 `link:`/目录 `file:`/本地 `file:tgz` 行 `publish.allowed === true`。
- 已发布行 `publish.allowed === false`，UI 不显示动作。
- 官方保留 package、registry/Git/URL、其他账号 claim、市场安装但非本人 owned 仍被排除。
- 校验失败条目保留在列表，`publish.reason` 为安全错误码，不泄露 path。
- local publish 成功后写 `profile source -> extension_id` lineage 并与云端行合并。

- [ ] **Step 2: 运行失败测试**

Run:

```bash
pnpm vitest run tests/extensions/profile-owned-inventory.test.ts tests/extensions/owned-inventory.test.ts tests/extensions/owned-refs.test.ts
```

Expected: FAIL，因为 ref 只支持 Cordis，本地行仍不可发布。

- [ ] **Step 3: 扩展 scanner/ref/store**

- scanner 正向接纳本地目录和本地 tarball，调用只读 lightweight validator 产生 eligibility。
- `ownedRef` 对三种 target 都使用随机短时 opaque ref；resolve 后重新验证当前账号、Profile spec digest、realpath、package name/version 和文件存在性。
- store 为 profile source 记录稳定 package identity 与 cloud lineage；跨账号 claim 保持拒绝。

- [ ] **Step 4: 统一 publish owner**

把 `publishCordis()` 收口为 `publish()`：按 target 调用 Cordis materializer、local directory packer 或 local tgz reader；创建 publish session 前完成最终校验。UI/SDK/Tool 不各自分支。

- [ ] **Step 5: 运行 owner 测试**

Run:

```bash
pnpm vitest run tests/extensions/owned-store.test.ts tests/extensions/owned-refs.test.ts tests/extensions/profile-owned-inventory.test.ts tests/extensions/owned-inventory.test.ts
pnpm typecheck
```

Expected: 三种来源、账号切换、stale ref、路径变化和发布血缘通过。

- [ ] **Step 6: 提交本地发布能力**

Run:

```bash
git add src/extensions/owned-*.ts src/extensions/profile-owned-inventory.ts tests/extensions/owned-*.test.ts tests/extensions/profile-owned-inventory.test.ts
git commit -m "feat(extensions): 功能点: 支持发布本地持久化 Bundle"
```

---

### Task 8: 安装直接使用市场 tgz，并以旧 tgz 回滚

**Files:**
- Modify: `src/extensions/types.ts`
- Modify: `src/extensions/install-store.ts`
- Modify: `src/extensions/manager.ts`
- Modify: `src/extensions/profile-installer.ts`
- Modify: `src/extensions/profile-restart-helper.ts`
- Modify: `tests/extensions/artifact.test.ts` or renamed v2 install test
- Modify: `tests/extensions/install-tasks.test.ts`
- Create: `tests/extensions/profile-restart-helper.test.ts`
- Remove after references are gone: `src/extensions/persistent-bundle.ts`
- Remove after references are gone: `src/extensions/persistent-client-bundle.ts`
- Remove after references are gone: `src/extensions/persistent-runtime.ts`
- Remove: `tests/extensions/persistent-bundle.test.ts`
- Replace: `tests/extensions/persistent-runtime.test.ts` with `tests/extensions/bundle-runtime.test.ts`

- [ ] **Step 1: 写直接安装和回滚失败测试**

断言首次安装 argv：

```ts
expect(run).toHaveBeenCalledWith([
  'plugin', '--profile', 'web', '--config.minimum-release-age=0',
  'add', '/tmp/arkme artifacts/sha256/<bundle>.tgz',
])
```

实际测试使用临时带空格绝对路径，不写死 `/tmp`。同时覆盖：

- 签名/SHA/package identity/本地 validator 均在 install 调用前完成。
- `dsh-native` 未确认时返回 awaiting-approval，不触碰 Profile。
- 更新失败时 helper `add <previous.tgz>`；首次安装失败 `remove <packageName>`。
- remove packageName 只来自 install store，不再限制 `@arkme-local/ext-*` regex。
- cleanup 只删除 artifact directory 内、且未被 store 引用的旧 tgz。

- [ ] **Step 2: 运行失败测试**

Run:

```bash
pnpm vitest run tests/extensions/install-tasks.test.ts tests/extensions/profile-restart-helper.test.ts tests/extensions/artifact.test.ts
```

Expected: FAIL，因为当前安装仍物化 wrapper 并调用 `link:`。

- [ ] **Step 3: 迁移 install store schema**

`ArkmeInstalledExtension` 使用 `bundleSha256/bundlePath/packageName/executionModel/packageJsonSha256/sourceSha256`；SQLite/JSON store 读取旧字段时只用于迁移/卸载，写入只产生 v2。迁移后不把 legacy artifact 当成可直接安装 Bundle。

- [ ] **Step 4: 改造 profile installer/helper**

```ts
installTarball(bundlePath: string): Promise<void>
remove(packageName: string): Promise<void>
```

helper plan schema 升为 2，字段改为 `targetBundlePath/previousBundlePath`，语义均为 tgz 文件；parse 必须检查绝对普通文件、位于 Arkme artifact root、package name 与 store 对应。子进程继续使用完整 `execPath/execArgv/dshBinPath/restartArgv` 和 `shell:false`。

- [ ] **Step 5: 删除 wrapper 链**

manager 不再调用 `materializePersistentExtensionBundle()`，不再生成 `installation.json`、`@arkme-local/ext-*` 或 client wrapper；安装记录直接指向下载的 content-addressed `.tgz`。

- [ ] **Step 6: 运行安装/回滚测试**

Run:

```bash
pnpm vitest run tests/extensions/bundle-runtime.test.ts tests/extensions/install-tasks.test.ts tests/extensions/profile-restart-helper.test.ts tests/extensions/artifact.test.ts
pnpm typecheck
```

Expected: install/update/uninstall/restart/rollback 全部以 tgz 为唯一对象；源码与测试中无 `link:${bundleDirectory}` 安装路径。

- [ ] **Step 7: 提交直接安装**

Run:

```bash
git add src/extensions tests/extensions package.json tsdown.config.ts
git commit -m "refactor(extensions): 功能点: 直接安装市场 Bundle 制品"
```

---

### Task 9: 收口 UI、SDK、Tool 的 badge、动作和原生权限确认

**Files:**
- Modify: `src/client/ArkmeExtensionCenter.tsx`
- Modify: `src/client/ArkmeExtensionPublishDialog.tsx`
- Modify: `src/client/my-extension-model.ts`
- Modify: `src/host-api.ts`
- Modify: `src/sdk/index.ts`
- Modify: `src/tools/extensions/index.ts`
- Modify: `src/types.ts`
- Modify: `docs/consumer-plugin-contract.md`
- Modify: `README.md`
- Modify: `tests/extensions/extension-center.test.tsx`
- Modify: `tests/extensions/my-extension-model.test.ts`
- Modify: `tests/extensions/host-api.test.ts`
- Modify: `tests/extensions/tools.test.ts`
- Modify: `tests/extensions/tools-runtime.test.ts`
- Modify: `tests/sdk.test.ts`

- [ ] **Step 1: 写消费面失败测试**

固定：

- `Cordis/已持久化/已发布` badge 位于标题 DOM 容器，右侧 action 区不出现状态按钮。
- eligible 未发布本地 Bundle 显示“发布”；已发布无按钮。
- publish dialog 对 Cordis 与本地使用同一字段，不显示/提交本地 path。
- `dsh-native` install preview 在 UI、SDK、Tool 返回安全 execution model；真正安装必须携带明确 confirmation token/grant。
- UI/SDK/Tool 发布同一 `ownedRef` 得到相同 extension/version/status/error code。

- [ ] **Step 2: 运行失败测试**

Run:

```bash
pnpm vitest run tests/extensions/extension-center.test.tsx tests/extensions/my-extension-model.test.ts tests/extensions/host-api.test.ts tests/extensions/tools.test.ts tests/extensions/tools-runtime.test.ts tests/sdk.test.ts
```

Expected: 本地 publish 与 v2 native confirmation 断言先失败。

- [ ] **Step 3: 接入共同 Host owner**

Host operation 仍只接收 opaque ref；SDK 与 Tool 类型增加 `executionModel`、`publish.allowed/reason`，不增加 path/upload/source 字段。Tool 发布继续要求写 grant 和当前人类明确意图。

- [ ] **Step 4: 完成 UI 行为**

- 标题右侧轻灰 badge 保持已确认样式。
- action 区只保留“发布/安装/更新/卸载”等行为。
- local validation error 以可修复文本展示，不把“仅本地”“已持久化”做成按钮。
- native install 确认明确说明 DSH 进程权限；取消不创建任务、不改 Profile。

- [ ] **Step 5: 运行消费面测试和可访问性断言**

Run:

```bash
pnpm vitest run tests/extensions/extension-center.test.tsx tests/extensions/my-extension-model.test.ts tests/extensions/host-api.test.ts tests/extensions/tools.test.ts tests/extensions/tools-runtime.test.ts tests/sdk.test.ts
pnpm typecheck
```

Expected: 六组测试通过，按钮 accessible name、disabled/pending 状态和 error recovery 完整。

- [ ] **Step 6: 提交消费面**

Run:

```bash
git add src/client src/host-api.ts src/sdk src/tools/extensions src/types.ts tests docs/consumer-plugin-contract.md README.md
git commit -m "feat(extensions): 功能点: 统一本地 Bundle 发布与权限提示"
```

---

### Task 10: 跨仓集成、tarball 安装、真实 DSH 与最终复核

**Files:**
- Modify if needed: service/plugin test fixtures only
- Evidence update: `docs/superpowers/plans/2026-08-20-bundle-first-extension-market.md`
- Evidence update: meta `openspec/changes/c20260820-arkme-bundle-first-extension-market/tasks.md`

- [ ] **Step 1: 发布服务全量门禁**

Run:

```bash
cd /Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first
gofmt -w gin/api/*.go gin/middlewares/*.go gin/response/*.go internal/extension/*.go internal/publication/*.go internal/migration/*.go internal/bootstrap/*.go storage/*.go cmd/migrate-bundle-v2/*.go main.go
go test ./...
go test -race ./...
git diff --check
```

Expected: 全部通过；Mongo/OSS 外部真实环境仍单独报告，不用内存测试冒充生产验收。

- [ ] **Step 2: 插件全量门禁**

Run:

```bash
cd /Users/apple/hehs/arkme-dsh-plugin-c20260820-bundle-first-market-plan
pnpm test
pnpm typecheck
pnpm build
pnpm run verify:call-assets
pnpm pack --dry-run
git diff --check
```

Expected: 全部通过；pack 清单不含测试、临时 source/bundle、worktree 路径、凭据或已删除 persistent wrapper 入口。

- [ ] **Step 3: 本地跨仓服务闭环**

在隔离配置启动最新服务，使用固定测试 JWT/本地 Ed25519 key 和 local storage；从插件测试 fixture 完成：

1. Cordis -> Bundle/source -> published -> resolve -> install。
2. local directory -> published -> resolve -> install。
3. local tgz -> published -> resolve -> install。
4. source URL 不出现在任何 public/authenticated普通读取响应。
5. 同一 package name 跨 owner 冲突，旧版本 update/rollback 正常。

端口用运行时空闲端口分配，不把端口写入源码或提交文档证据。

- [ ] **Step 4: 生成插件 tgz 并安装到全新 DSH_HOME**

Run:

```bash
cd /Users/apple/hehs/arkme-dsh-plugin-c20260820-bundle-first-market-plan
BUNDLE_MARKET_E2E_ROOT="$(mktemp -d)"
pnpm pack --pack-destination "$BUNDLE_MARKET_E2E_ROOT"
DSH_HOME="$BUNDLE_MARKET_E2E_ROOT/dsh-home" pnpm --dir /Users/apple/hehs/dsh dsh plugin --profile web add "$BUNDLE_MARKET_E2E_ROOT"/senguoyun-dsh-arkme-*.tgz
DSH_HOME="$BUNDLE_MARKET_E2E_ROOT/dsh-home" pnpm --dir /Users/apple/hehs/dsh dsh --profile web --dump-config
```

Expected: 插件自身从不可变 tgz 安装；dump-config 能看到 Arkme Bundle。随后通过测试服务安装一个市场 Bundle，Profile dependency 指向 tgz/package，且不存在新生成的 `@arkme-local/ext-*` 或 `link:.../arkme-extensions/...`。

- [ ] **Step 5: 真实消费面验收**

- UI：在隔离实例检查 badge 位置、local publish、published 无按钮、native 权限确认、失败重试。
- Tool：未修改 DSH 的真实 Agent session 能发现并调用 list/publish，grant 和明确意图生效。
- SDK：独立临时 consumer 只从插件 tgz import `@senguoyun/dsh-arkme/sdk`，完成类型检查和三来源 publish mock/real local call。
- Host：抓取结果确认无 path、signed URL、headers、Token、source locator。

- [ ] **Step 6: 迁移预演与切换证明**

先对测试数据运行：

```bash
cd /Users/apple/hehs/jotmo-extension-publish-c20260820-bundle-first
go run ./cmd/migrate-bundle-v2 --config assets/config/config.yaml --dry-run
go run ./cmd/migrate-bundle-v2 --config assets/config/config.yaml --apply
go run ./cmd/migrate-bundle-v2 --config assets/config/config.yaml --apply
```

Expected: 第一次 apply 迁移精确数量，第二次全部 skipped；每个 active latest 都能 resolve v2。生产执行和关闭 v1 gate 必须另获部署授权，本任务不自动执行。

- [ ] **Step 7: 搜索旧链与本机耦合**

Run:

```bash
cd /Users/apple/hehs/arkme-dsh-plugin-c20260820-bundle-first-market-plan
rg -n '\.arkext|@arkme-local/ext-|materializePersistentExtensionBundle|link:\$\{bundleDirectory\}|persistent-extension' src tests package.json tsdown.config.ts
rg -n '/Users/apple|127\.0\.0\.1:[0-9]{4,5}|Bearer [A-Za-z0-9]' src tests docs package.json
git status --short --branch
```

Expected: 第一条只剩明确的 migration/legacy 注释或零结果；第二条业务源码零结果；状态只含本任务预期文件。

- [ ] **Step 8: 整体代码复核**

一次性审查两个业务分支相对各自最新 master 的完整 diff，重点检查：

- 服务端双对象状态是否可能部分 published。
- package name/版本/签名 envelope 是否跨端一致。
- native 权限是否被误当成 sandboxed。
- Browser/SDK/Tool 是否泄露 Host-only 字段。
- Profile rollback 是否精确恢复上一 tgz。
- 旧 `.arkext` 是否仍可从正常 API 到达。
- 官方/第三方 Bundle 是否会被错误归为“我的扩展”。

finding 修复后重新运行 Step 1–7 的受影响门禁；最终只报告有实际输出支持的 macOS/Windows/Linux 结论。

- [ ] **Step 9: 更新证据并提交文档**

在本计划末尾追加实际命令、计数、SHA、运行环境和未完成平台验收；把 meta tasks 对应项标为完成并重新 strict validate。提交消息：

```bash
git commit -m "docs(extensions): 功能点: 记录 Bundle-first 市场验收"
```

## 2. 完成定义

- 服务端 normal API 只接受并解析 `artifact_contract_version=2` 的 `dsh-bundle-tgz`。
- Cordis、本地目录、本地 tgz 三者产生/使用同一安装合同。
- 市场安装调用官方 DSH CLI 直接 add 已验签 tgz；不存在本地 wrapper 转换。
- 已持久化但未发布的本人 Bundle 有发布动作；已发布行只有 title badge，没有发布按钮。
- 官方 DSH Bundle、远端第三方 dependency 和其他账号市场安装项不进入“我的扩展”。
- `dsh-native` 运行权限被诚实投影并要求明确确认。
- source 与 signed upload 信息不进入 public catalog、UI、SDK、Tool 或日志。
- 旧 `.arkext` 完成一次性迁移，正常运行代码不再提供双格式支持。
- Go/TS 全量测试、构建、插件 tgz、全新 DSH Profile、真实 UI/Tool/SDK 和失败回滚分别有证据。
- 未修改 DSH 仓 tracked 文件；未触碰用户常驻 DSH/Profile。
