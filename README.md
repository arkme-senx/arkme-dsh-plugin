# Arkme DSH Plugin

[![npm 版本](https://img.shields.io/npm/v/%40senguoyun/dsh-arkme?label=npm%20%E7%89%88%E6%9C%AC)](https://www.npmjs.com/package/@senguoyun/dsh-arkme)
[![发布记录](https://img.shields.io/badge/%E5%8F%91%E5%B8%83%E8%AE%B0%E5%BD%95-GitHub-blue)](https://github.com/arkme-senx/arkme-dsh-plugin/releases)

Arkme 的 DeepSeek Harness 集成插件，为 DSH 提供账号、记录、聊天、Bot、社区、通话和市集能力。

- npm：[`@senguoyun/dsh-arkme`](https://www.npmjs.com/package/@senguoyun/dsh-arkme)
- 源码：[`arkme-senx/arkme-dsh-plugin`](https://github.com/arkme-senx/arkme-dsh-plugin)

## 版本与发布

- 项目首页顶部的 **npm 版本** 徽章显示当前可通过 npm 安装的正式版本。
- 功能分支只提交功能代码；版本号、更新说明和 GitHub Release 由合并后的发版流程统一处理。
- 发版负责人通过 GitHub Actions 的“准备插件发版”创建发版 PR；合并后自动发布 npm、创建同版本 Git Tag 和 GitHub Release。详见[插件自动发版](docs/plugin-release.md)。

## 功能

- 内置搜索页支持快记搜索、搜索历史、纯图片库和已生成 AI 视频快速入口；图片库采用桌面端多列视图并排除普通视频。

## 安装

将插件安装到 DSH Web Profile：

```sh
DSH_HOME=<dsh-home> dsh plugin --profile web add @senguoyun/dsh-arkme
DSH_HOME=<dsh-home> dsh web
```

安装本地构建产物：

```sh
pnpm pack --pack-destination <artifact-directory>
DSH_HOME=<dsh-home> dsh plugin --profile web add <artifact-directory>/senguoyun-dsh-arkme-<version>.tgz
DSH_HOME=<dsh-home> dsh web
```

## Release Set 运行时制品

使用当前 `package.json.version` 构建 Electron Release Set 动态加载的 Arkme 插件制品：

```sh
pnpm pack:runtime
```

默认输出到 `dist/runtime-artifacts/`：

```text
dsh-arkme-<version>.tar.zst
artifact-metadata.json
SHA256SUMS
```

如需指定输出目录：

```sh
pnpm pack:runtime -- --output-dir /path/to/output
```

脚本会运行插件现有构建流程，并校验包名、版本、Release Set 必需入口、归档路径和文件类型；校验失败时不会留下不完整制品。

## 架构

插件通过一个 Host 业务层同时服务三个消费面，权限、数据、幂等和错误语义只实现一次：

| 目录 | 职责 |
| --- | --- |
| `src/services/` | 按业务域拆分的 Host Service 与共享请求运行时 |
| `src/tools/` | DSH 会话中的模型 Tools、Schema、grant 与注册适配 |
| `src/sdk/` | 面向外部 DSH 插件的公开 Browser SDK |
| `src/client/` | Arkme 内置 UI、状态与交互 |
| `src/extensions/` | 扩展安装、发布、验签与持久运行时 |
| `src/arkme-service.ts` | 保持兼容的顶层组合门面 |

涉及 DSH 生命周期、Profile、Cordis、Tools 或 Web Host 的实现只依赖 DSH 公开扩展点，不导入 DSH 私有源码路径。

## 外部插件接入

浏览器侧 Consumer 使用公开 SDK，并先读取能力合同：

```ts
import { createArkmeSdk } from '@senguoyun/dsh-arkme/sdk'

const arkme = createArkmeSdk()
const capabilities = await arkme.capabilities()
```

可信 Host 插件可以声明 `inject: ['arkmeData']`，通过 `ctx.arkmeData` 复用相同业务 owner。完整的类型、账号作用域、生命周期和安全要求见 [Consumer Plugin Contract](docs/consumer-plugin-contract.md)。

## 本地开发

要求 Node.js `^22.19.0 || >=24.0.0`，包管理器版本以 `package.json` 中的 `packageManager` 为准。

```sh
corepack enable
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run verify:call-assets
```

交付前应生成不可变 `.tgz`，在未修改的官方 DSH 和全新临时 Profile 中完成安装与运行验证；开发期 `link:` 安装不能作为最终兼容性证据。

## 安全与兼容边界

- Arkme 凭据、上游 Token、签名 URL 和内部定位信息只保留在 Host。
- Tools、SDK 和 UI 只接收最小结果或账号绑定的不透明引用。
- 写操作要求明确用户意图，并复用 Host 的权限、幂等与错误语义。
- 路径、端口、Profile 和可执行文件均来自运行时配置，不依赖开发电脑的固定目录。
- 新增 UI Host 能力时，必须同步评估并提供安全等价的 Tools 与 SDK 入口。

## 文档

- [工具注册与能力目录](docs/tool-registry.md)
- [外部插件消费合同](docs/consumer-plugin-contract.md)
- [请求协调与限流](docs/request-coordination.md)
- [市集控制](docs/extension-market-controls.md)
- [扩展评论与评分](docs/extension-reviews.md)
- [消息已读乐观更新](docs/read-ack-optimistic-flow.md)
- [Agent 代理发送链路](docs/agent-proxy-sender-flow.md)
