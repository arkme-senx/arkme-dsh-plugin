# Arkme Sandboxed Client Export 合同修正设计

**状态：** 已确认，待书面复核

**插件实施基线：** `arkme-dsh-plugin@cdf1b3b`

**发布服务参考基线：** `jotmo-extension-publish develop@190a87a`

**DSH 合同参考：** `packages/client/modules/src/index.ts`，只读，不修改 DSH

## 1. 结论

Artifact Contract v2 尚无外部用户，本次直接修正 v2 的唯一合法格式，不提供旧 v2 Bundle 兼容层、迁移器或安装时修补。

- Host-only `arkme-sandboxed` Bundle 继续只导出 package root 和 `package.json`。
- Host+Client `arkme-sandboxed` Bundle 必须额外精确导出 `./client -> ./lib/client.js`。
- Cordis patch 仍然只能唯一加载 package root；`./client` 只供 DSH ClientModuleRegistry 发现浏览器半边，不能成为 patch row。
- 现有 v1 artifact-only 发布与安装保持不变。
- 测试环境中的旧错误 v2 数据直接清理并重新以正确合同发布，不保留或迁移旧 v2 字节。

## 2. 根因

当前生成器在存在 `clientCode` 时同时产生：

- `package/lib/client.js`
- `dsh.client = { platform: "web", inject: [] }`

但 package exports 仍固定为：

```json
{
  ".": "./lib/index.js",
  "./package.json": "./package.json"
}
```

DSH ClientModuleRegistry 对每个声明 `dsh.client.platform=web` 的 package 固定解析 `exports["./client"]`；缺失时启动失败。现有插件和后端 validator 又把 exports 数量严格锁为 2，因此生成器无法产出 DSH 可加载的 Client Bundle。

此前合同错误地把“patch 禁止加载 subpath”和“package 禁止导出标准 Client subpath”合并成同一限制。两者必须分开：patch root-only 是沙箱 Host 入口约束；`./client` 是 DSH 正式浏览器入口。

## 3. 唯一 v2 manifest 合同

### 3.1 Host-only

当且仅当不存在 `clientCode` 时：

```json
{
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./package.json": "./package.json"
  }
}
```

同时要求：

- 不声明 `dsh.client`。
- 不包含 `package/lib/client.js`。
- exports 恰好 2 项。

### 3.2 Host + Client

存在 `clientCode` 时：

```json
{
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": []
    }
  }
}
```

同时要求：

- `package/lib/client.js` 必须存在并为普通文件。
- `exports["./client"]` 必须是精确字符串 `./lib/client.js`，不接受条件对象、通配符或其他路径。
- exports 恰好 3 项。

### 3.3 一致性矩阵

| `dsh.client` | `lib/client.js` | `exports["./client"]` | 结果 |
| --- | --- | --- | --- |
| 无 | 无 | 无 | 合法 Host-only |
| web | 有 | `./lib/client.js` | 合法 Host+Client |
| web | 无 | 任意 | 拒绝 |
| web | 有 | 缺失或其他路径 | 拒绝 |
| 无 | 有 | 任意 | 拒绝孤立 Client |
| 无 | 无 | 存在 | 拒绝伪造导出 |

## 4. Patch 与安全边界

Host-only 和 Host+Client 都继续使用同一个 patch 规则：

```yaml
- insert:
    - id: arkme-<sha256(packageName)前16位>-runtime
      name: '<packageName>'
```

- 只能有一个 insert row。
- row id 必须等于 `arkmeSandboxEntryId(packageName)`。
- row name 必须精确等于 package root。
- 禁止 `<packageName>/client`、`<packageName>/lib/index.js` 和其他 subpath。
- `./client` 不扩大 Host 权限；它只允许 DSH 在浏览器侧加载已经声明的 Client 半边。
- 继续禁止任意额外 exports、生命周期 scripts、runtime dependencies、native addon、bin、路径逃逸和链接。

## 5. Owner 与改动范围

### Arkme 插件

- `bundle-materializer.ts`：根据 `clientCode` 条件生成 `./client` export。
- `bundle-artifact.ts`：本地打包/安装前 validator 使用相同一致性矩阵。
- 测试覆盖 Host-only、Host+Client、缺文件、缺 export、错误路径和额外 export。

### 发布服务

- `bundle_validator.go`：解析 `dsh.client`，按一致性矩阵校验 exports 和 `lib/client.js`。
- 保留 sandbox Host 入口、patch root-only、Bundle/source 字节相等、SHA、签名和 package identity 校验。
- 更新跨语言/跨仓固定 fixture，确保插件生成器与 Go validator 对同一字节结论一致。

### DSH

- 不修改。`exports["./client"]` 已是正式合同。

### Tools / SDK / UI

- 不新增入口，标记为 N/A：这是既有发布 owner 内部的 Bundle 格式修正。
- 现有 UI、Tool、SDK 发布操作会自动使用修正后的同一物化器与后端 validator，不复制逻辑。

## 6. v2 直接切换与数据处理

- Artifact Contract 版本号仍为 `2`，但旧错误 v2 字节不再视为受支持格式。
- 后端不接受“旧 exports=2 但声明 Client”的新发布。
- 插件不保留旧 v2 本地读取/安装兼容分支。
- 不在安装时重写 tarball；否则 Bundle SHA、package-json SHA 和签名失效。
- 测试环境清理所有符合以下条件的错误记录和对象：`execution_model=arkme-sandboxed`、声明 `dsh.client`、缺少精确 `./client` export。
- 清理后从原 Cordis 测试源重新以正确合同发布；允许重新使用业务版本 `1.0.0`，因为旧 v2 测试数据已被彻底移除。
- 不建设通用迁移命令、版本扫描器、自动 patch bump 或 revoke 流程。

v1 不属于这次直接切换：v1 artifact-only 与带 source 的发布、resolve-install、插件 wrapper 安装继续保留并回归。

## 7. 部署顺序

1. 发布服务修改 validator，测试通过后部署测试服。
2. Arkme 插件修改生成器和本地 validator。
3. 清理测试服错误 v2 测试数据及本地临时 Profile 安装残留。
4. 用新插件重新发布一个 Host-only v2 和一个 Host+Client v2。
5. 在全新临时 Profile 中分别安装、重启并验证 active 状态。
6. 复跑 v1 artifact-only 与严格 v2 Bundle/source/SHA 回归。
7. 保持 52909 使用最终统一插件包供 UI 验收。

在发布服务更新与插件更新之间，旧插件发布 Client Bundle 可能被新 validator 拒绝；测试环境没有外部用户，允许这个短暂窗口，但部署应连续完成。

## 8. 验收

### 合同测试

- Host-only exports 恰好为 `.`、`./package.json`。
- Host+Client exports 恰好增加 `./client -> ./lib/client.js`。
- Client 声明、文件、export 任一缺失或不一致都被插件和 Go validator 拒绝。
- 额外 export 与 patch subpath 继续被拒绝。

### E2E

- 新 Host+Client Bundle 经测试后端发布成功。
- resolve-install 返回的 Bundle SHA/签名验证通过。
- 官方 `dsh plugin --profile web add <bundle.tgz>` 安装成功。
- DSH 重启时 ClientModuleRegistry 找到 `./client`，没有 composition error。
- 扩展 Host 与 Client 半边均 active，设置页或目标 Slot 能看到 Client UI。
- Host-only v2 安装不产生 Client module。
- v1 artifact-only 安装仍通过。

## 9. 回滚

- 后端可回滚 validator；新 Bundle 的额外精确 export 对旧 validator 不兼容，因此后端与插件应作为一个测试发布单元回滚。
- 插件可回滚到旧生成器，但不得在新 validator 下继续发布 Client Bundle。
- 测试数据已经清理，无需恢复旧错误 v2 对象。
- v1 数据和安装链始终不参与回滚。

