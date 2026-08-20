# Bundle-first 扩展市场设计

**状态：** 已确认，待实现

**插件实施基线：** `arkme-senx/arkme-dsh-plugin@3425a07`

**发布服务参考基线：** `jotmo-extension-publish@3c7f40c`

**DSH 机制参考：** `/Users/apple/hehs/dsh` 当前 checkout，仅只读参考

## 1. 结论

扩展市场只保留一种可安装制品：标准 DSH Bundle 的 npm tarball（下文统一称 `bundle.tgz`）。Dynamic Cordis、本地 Bundle 目录和本地 Bundle `.tgz` 只是三种发布来源，不再各自形成一种市场安装格式。

- Dynamic Cordis 发布时，Arkme 把确切 Package 一次性物化为标准 DSH Bundle。
- 本地 `link:`、目录型 `file:` Bundle 经过相同策略校验后确定性打包；本地 `.tgz` 通过校验后保持原字节上传。
- 市场安装下载并验签 `bundle.tgz`，然后直接调用官方 `dsh plugin --profile web add <tgz>`。
- 删除 `.arkext -> @arkme-local wrapper Bundle -> link:` 的双重转换链。
- 源码快照使用独立的 owner-only `source.tgz`，不参与安装，也不出现在公开目录和普通安装解析结果中。
- 现有 `.arkext` 只允许一次性迁移；切换完成后不保留长期双格式读写面。

## 2. 为什么现在的发布方式需要替换

当前系统把 `.arkext` 当作市场制品，安装时再由插件生成 `@arkme-local/ext-*` Bundle，并以 `link:` 写入 Profile。该设计能给 Cordis 函数体提供 Arkme 沙箱，但产生了三个产品问题：

1. 已经存在的标准 DSH Bundle 不能直接发布，因为发布入口只接受 Dynamic Cordis Package。
2. 市场制品和 DSH 最终安装制品不是同一个对象，签名、回滚和问题定位横跨两层转换。
3. “我的扩展”能识别本地 Bundle，却只能展示“已持久化”，无法把它作为可发布源。

DSH 的公开合同已经明确：Bundle 是作者编写和分发的单元，Profile 是用户安装后的组合；`dsh plugin` 能直接安装 `.tgz` 并依据包内 `dsh.bundle.patch` 维护 `dsh.profile.bundles`。市场应对齐这个 owner，而不是再发明一个平行安装格式。

## 3. 目标与非目标

### 目标

- 一个发布版本只有一个可安装字节对象和一个 SHA-256。
- Cordis 与本地 Bundle 共享发布会话、服务端校验、签名、目录、安装、更新、撤销和回滚语义。
- “我的扩展”中的未发布 Cordis、本地目录 Bundle、本地 Bundle tarball 都能在验证通过时显示唯一动作“发布”；已发布条目不显示动作按钮。
- DSH 官方 Bundle 和非当前账号拥有的市场/第三方 Bundle 不进入“我的扩展”。
- 安装失败或重启后不健康时，使用上一版本的已验证 `.tgz` 通过同一 DSH CLI 恢复。
- 不执行发布源的构建脚本，不把作者机器路径、Profile 路径、上传签名 URL、Token 或源码暴露给 Browser、SDK 或模型 Tool。

### 非目标

- 不修改 DSH core，也不复制 DSH 的 Profile reconciliation。
- 不在发布服务中编译用户源码或执行 Bundle 代码。
- 不把签名描述成沙箱或安全审核；签名只证明平台验证过的字节、发布身份和时间没有被篡改。
- 不新增内容审核状态；技术校验通过后仍按现有 MVP 直接发布。
- 不在本次提供云端源码编辑器；`source.tgz` 只为后续编辑/重建保留 owner-only 原料。

## 4. 单一制品，不等于单一执行权限

Bundle-first 统一的是分发格式，不会自动统一运行权限。

| `execution_model` | 来源 | 运行边界 | 安装提示 |
| --- | --- | --- | --- |
| `arkme-sandboxed` | Dynamic Cordis 物化包、旧 `.arkext` 迁移包 | Bundle 入口调用 Arkme Bundle Runtime；函数体继续使用现有 VM、只读 Context 和 Host/Client bridge 约束 | “Arkme 沙箱扩展” |
| `dsh-native` | 作者已有的原生 DSH Bundle | 与普通 DSH 插件相同，代码在 DSH 进程权限下运行 | 必须明确提示“拥有 DSH 本地插件权限”并由用户确认安装 |

两者都是同一种 `bundle.tgz`，共享同一个服务端和安装协议。技术校验可以阻止安装脚本、路径穿越、原生二进制、依赖漂移和 patch 越权，但不能静态证明任意 JavaScript 在运行期无恶意行为。原生 Bundle 的权限提示不得省略。

## 5. 数据与生命周期 owner

| 事实 | 唯一 owner |
| --- | --- |
| 当前进程 Cordis Package 源码 | Dynamic Cordis runner |
| 本地 Bundle 路径与 Profile 激活状态 | Profile `package.json`、resolved package manifest、DSH Loader |
| 本地来源归属及云端血缘 | Arkme `owned-extensions.sqlite3` |
| 扩展身份、全局 `package_name`、版本、发布会话、SHA、签名、撤销 | `jotmo-extension-publish` |
| Profile 依赖写入和 `dsh.profile.bundles` reconciliation | 官方 `dsh plugin` CLI |
| Browser/Tool/SDK 安全投影、发布编排、安装编排 | Arkme Host owner |

浏览器只获得 opaque `ownedRef`、展示字段、验证结果和安全动作；真实本地路径、Agent/Package 定位、预签名 URL 和密钥始终留在 Host。

## 6. Bundle v2 合同

### 6.1 tarball 结构

`bundle.tgz` 必须是可被 pnpm 安装的 npm tarball，所有文件位于 `package/` 下：

```text
package/
  package.json
  cordis.patch.yml
  lib/**
  assets/**                 可选
  arkme/source.json         仅 arkme-sandboxed 生成包需要
```

服务端从压缩包内原始 `package/package.json` 计算 `package_json_sha256`，从整个 gzip 字节计算 `bundle_sha256`。同一扩展的所有版本必须保持相同 `package_name`；`version` 必须同时等于发布请求和 `package.json.version`。

### 6.2 package manifest 最小要求

```json
{
  "name": "@example/weather-bundle",
  "version": "1.2.3",
  "type": "module",
  "files": ["lib", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- `name` 必须是合法 npm package name，且不能位于 `@deepseek-ai/*`、`@senguoyun/dsh-arkme`、`@arkme-local/*` 等保留集合。
- `version` 必须是严格 SemVer。
- `files` 必须显式存在；发布器按 npm packlist 语义只读取被选中的普通文件，避免误传仓库其他内容。
- `dsh.bundle.patch` 必须指向包内普通 YAML 文件。
- 普通标准 Bundle 不需要 Arkme 私有字段，缺少 execution marker 时服务端固定推导为 `dsh-native`。只有 Arkme 生成且结构匹配的包才可声明 `dsh.arkme.executionModel=arkme-sandboxed` 与受支持 runtime contract；作者不能用一个字符串把原生代码伪装成沙箱代码。
- `scripts` 必须缺失或为空；v2 不允许运行或携带生命周期脚本。
- `dependencies`、`optionalDependencies`、`bundledDependencies` 必须为空。运行时依赖只能放在受控 `peerDependencies`，MVP allowlist 为 DSH/Cordis/React 与当前 Arkme Runtime 合同。
- 禁止 `bin`、`.node`、符号链接、硬链接、设备文件、绝对路径、反斜杠路径、路径穿越、重复路径和 gzip trailing data。
- 压缩字节、解包普通文件总量、文件数和单文件大小均使用服务端固定上限；初始上限沿用 100 MiB/1024 files。

### 6.3 patch 策略

市场 Bundle 是普通 DSH Bundle 的安全子集：

- 顶层只允许 `insert`，不允许 remove/update 或其他可改写既有层的操作。
- 插入行的 `id` 必须以 `arkme-<sha256(package_name) 前 16 位>-` 开头。
- 插入行的 `name` 只能是本包名或本包 subpath，不得指向 DSH core、Arkme 主包或其他已安装 package。
- 同一 Bundle 内 id 不得重复；服务端保存 id 集合用于诊断。
- `dsh-native` 的 JS 运行能力不由 patch 校验替代，安装前仍必须有人类确认。

这意味着“本地有一个 Bundle”即可进入发布校验和发布流程，但不保证任意无约束 Bundle 都被市场接受；不满足策略时列表仍展示该扩展，并返回可操作的失败原因。

### 6.4 source.tgz

每次 v2 发布同时上传不可变 `source.tgz`：

- Cordis 来源包含确切 Package 的 Host/Client 函数体、描述和物化元数据。
- 本地目录来源只包含 npm packlist 选中的发布文件，不递归上传工作区其他文件。
- 本地 `.tgz` 来源把安全解包后的 package 文件作为源码快照；不猜测原仓库中未进入 tarball 的源码。
- 服务端只做路径、类型、大小、文件数和摘要校验，不执行或公开源码。
- 普通目录、详情、安装、更新接口不返回 source URL、object key 或 signed headers。

## 7. 发布 API v2

沿用现有 POST 路径，使用 `artifact_contract_version: 2` 做显式破坏性切换。创建请求的核心字段为：

```json
{
  "artifact_contract_version": 2,
  "artifact_kind": "dsh-bundle-tgz",
  "extension_id": "ext_xxx",
  "name": "天气助手",
  "description": "展示天气",
  "package_name": "@example/weather-bundle",
  "version": "1.2.3",
  "execution_model": "dsh-native",
  "visibility": "public",
  "bundle_size": 12345,
  "bundle_sha256": "64 lowercase hex",
  "package_json_sha256": "64 lowercase hex",
  "source_size": 23456,
  "source_sha256": "64 lowercase hex",
  "idempotency_key": "stable key"
}
```

创建响应返回两个 Host-only 上传槽：

```json
{
  "publish_session_id": "pub_xxx",
  "extension_id": "ext_xxx",
  "status": "uploading",
  "bundle_upload": { "url": "...", "method": "PUT", "headers": {}, "expires_at": "..." },
  "source_upload": { "url": "...", "method": "PUT", "headers": {}, "expires_at": "..." }
}
```

`complete` 只有在两个对象都存在、大小/SHA 匹配、Bundle 与源码分别通过校验后才进入 `published`。任何一个对象失败都将同一 session/version 标为 `rejected`，不会推进 latest 指针。

服务端给 `package_name` 建立全局唯一索引；新扩展完成首次发布后占用该名称，后续版本必须由同一 `extension_id` 和 owner 使用。幂等比较同时包含 artifact contract、package name、execution model、两个 size/SHA 和版本。

## 8. 签名与安装解析

v2 Ed25519 canonical JSON 固定字段顺序：

```json
{"format_version":2,"artifact_kind":"dsh-bundle-tgz","extension_id":"ext_xxx","package_name":"@example/weather-bundle","version":"1.2.3","execution_model":"dsh-native","bundle_sha256":"...","package_json_sha256":"...","source_sha256":"...","published_at":1780000000000,"signing_key_id":"key-1"}
```

`resolve-install` 返回：

- 上述签名字段与 `signature`；
- `bundle_url`、`bundle_headers`、`bundle_expires_at`、`bundle_size`；
- 技术校验后的安全 package 摘要；
- `requires_native_confirmation: true`（仅 `dsh-native`）。

不返回 source 下载信息。插件必须在修改 Profile 前完成签名、下载 SHA、package identity 和本地 Bundle 策略复验；随后把不可变 tarball保存到账号/Profile 作用域的 content-addressed 目录，再以 argv 数组调用：

```text
dsh plugin --profile <profile> add <absolute bundle.tgz path>
```

DSH CLI 仍是 dependencies 和 `dsh.profile.bundles` 的唯一写入 owner。

## 9. 三种发布来源

### 9.1 Dynamic Cordis

1. Host 由账号绑定的 opaque ref 重新验证 Agent、Plugin 和确切 Package。
2. `CordisBundleMaterializer` 使用已持久化的稳定 package name 生成带受验证 runtime marker 的 `arkme-sandboxed` Bundle；Host/Client 源码被写入包内，入口调用 Arkme Bundle Runtime。
3. 生成同源 `source.tgz`，执行本地策略校验，再进入 v2 publish session。
4. published 后写入 Cordis source -> `extension_id` 血缘。

### 9.2 本地 Bundle 目录

1. Profile scanner 只从 `link:` 和目录型 `file:` dependency 获得候选，并继续用本地 owner sidecar 排除非当前账号来源。
2. 发布时重新 realpath、读取 manifest、展开 npm packlist、拒绝链接/逃逸/脚本/不受控依赖和越权 patch。
3. 以规范 tar metadata 打包成确定性 `bundle.tgz` 和受限 `source.tgz`。
4. published 后写入 profile source -> `extension_id` 血缘；刷新后与云端合为一行。

### 9.3 本地 Bundle tarball

Profile dependency 为本地 `file:*.tgz` 时，scanner 可把它列为候选。发布时不重新打包 `bundle.tgz`，而是验证并复用原字节；`source.tgz` 由安全解包后的 package 文件生成。远端 URL、Git 和 registry dependency 仍不自动归为用户创作。

## 10. “我的扩展”投影

生命周期使用标题右侧 badge：`Cordis`、`已持久化`、`已发布`。右侧动作区只出现真实行为：

- 未发布且发布源当前可读取、策略校验通过：显示“发布”。
- 未发布但校验失败：不显示伪按钮；卡片展示安全、可修复的原因和“重新校验”入口。
- 已发布：不显示发布按钮。
- 同一来源发布成功后按显式 lineage 合并，不按名称猜测。

发布 UI、SDK、Tool 共享 `OwnedExtensionInventory.publish()`：

| 消费面 | 输入 | 安全边界 |
| --- | --- | --- |
| UI | opaque `ownedRef` + 发布元数据 | 同源 Host API；本地路径不进 Browser |
| SDK | opaque `ownedRef` + 发布元数据 | 公开类型、能力版本和账号作用域 |
| Tool | opaque `ownedRef` + 发布元数据 | 写 grant + 当前人类明确发布意图 |

## 11. 安装、更新、卸载与回滚

- 安装和更新都保存目标 `.tgz`，调用同一个 `profileInstaller.installTarball()`。
- `ArkmeInstalledExtension` 保存 `packageName`、`bundleSha256`、`bundlePath`、签名信息和 execution model，不再保存 wrapper directory。
- 重启健康检查仍以 Loader/已安装清单的真实 active 状态为准。
- 健康失败时 helper 使用上一条 store 记录的 `previousBundlePath` 再执行 `dsh plugin add <previous.tgz>`；首次安装失败则按精确 package name remove。
- 卸载只允许删除 install store 已证明属于该 `extension_id` 的精确 package name，不能接受 Browser/Tool 自由输入 package name。
- 成功切换后清理不再被任何 install store 行引用的旧 tarball；清理范围必须在 Arkme artifact directory 内。

## 12. 官方插件与第三方排除

“我的扩展”继续使用正向准入，而不是枚举全部 `dsh.profile.bundles`：

- DSH installation-owned base/web 等内置 Bundle 没有本地 dependency 来源，不进入候选。
- package name 命中官方保留集合时，即使通过 `link:` 指向本地 checkout 也不允许当前账号 claim/publish。
- registry、Git、URL dependency 不能仅凭“已安装”被认定为本人创作。
- 市场安装项只有其 `extension_id` 属于当前账号，或存在当前账号的显式 source lineage，才合并进“我的扩展”。

## 13. 一次性 `.arkext` 迁移与切换

迁移不保留长期兼容层：

1. 服务端 v2 先以兼容部署方式上线，但 v1 只保留在受控迁移窗口。
2. 只读统计所有 published v1 版本；零条时记录 no-op 证据，非零时由幂等迁移命令逐条读取、按旧 validator 验证并物化为 `arkme-sandboxed` Bundle 与 source snapshot。
3. 新 v2 Bundle 使用新的签名 envelope；旧 object key、旧签名和旧字段只保留为审计/紧急回退证据，不再由正常 resolve 返回。
4. 发布插件 v2，并在服务端启用 `artifact_contract_version=2` 强制门禁。
5. 验证市场所有 active latest 均有 v2 制品后，删除 v1 create/complete/resolve 代码路径；不删除历史对象。

迁移命令按 `extension_id + version` 幂等，已存在相同 `bundle_sha256` 的 v2 记录直接跳过；任一版本失败不得推进该扩展 latest 的 v2 readiness。

## 14. 部署顺序与回滚

### 顺序

1. 合入并部署发布服务 v2、双上传、校验、签名和迁移命令。
2. 在测试环境发布并安装 Arkme 插件 v2，完成 Cordis、本地目录、本地 tgz 三路发布与直接安装闭环。
3. 运行生产只读迁移预检，再执行一次性迁移。
4. 发布 Arkme 插件，确认最低版本覆盖后关闭 v1 写入和解析。
5. 删除 v1 运行代码并完成最终跨仓复核。

### 回滚

- 关闭 v1 之前，服务端可关闭 v2 feature gate，插件版本可回退，旧对象保持不变。
- v2 安装失败由客户端使用上一 `.tgz` 自动恢复，不回滚云端 published 事实。
- v1 关闭后若需紧急回退，只能在保留旧对象的迁移窗口内恢复服务端 v1 gate；不得让单个客户端自行把 v2 Bundle转换回 `.arkext`。

## 15. 验收

### 发布服务

- Bundle/source 双对象的 size、SHA、状态机、幂等、Mongo 单节点重试和 OSS promotion 测试通过。
- tar path traversal、链接、设备文件、重复路径、trailing data、脚本、native addon、bin、运行依赖和越权 patch 全部被拒绝。
- 固定 Ed25519 v2 跨语言向量在 Go/TypeScript 两端一致。
- 迁移命令 dry-run、非零迁移、重复运行和单条失败恢复均有测试。

### Arkme 插件

- Cordis 和相同本地目录重复打包得到相同 tar bytes/SHA；带空格路径、POSIX/Windows 路径 fixture 通过。
- UI、SDK、Tool 都能发布 Cordis、本地目录和本地 tgz；已发布卡片无按钮，badge 在标题右侧。
- `dsh-native` 安装必须经过明确确认，`arkme-sandboxed` 保持当前 VM/Context 限制。
- 更新失败重启后恢复上一 tgz，首次安装失败移除精确 package。
- 全量 test、typecheck、build、pack 清单通过。

### 真实 DSH

- 用未修改的官方 DSH 和全新临时 `DSH_HOME` 执行 `dsh plugin --profile web add <market bundle.tgz>`。
- Profile dependency 直接指向 tgz/package，不再出现 `@arkme-local/ext-*` wrapper 或 `link:<generated-directory>`。
- Loader 激活、Host/Client 行为、Tool 真实会话、仓外 SDK Consumer 和浏览器 UI 分别验收。
- macOS 完成真实运行；Windows/Linux 若没有真实环境，只报告实现级兼容与待验收，不宣称已完成跨平台证明。
