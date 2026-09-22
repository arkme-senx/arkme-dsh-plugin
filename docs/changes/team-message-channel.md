# 团队消息通道交付

## 范围

内置 UI 使用 Team App JWT 接口，共用 `TeamAppService` 的账号边界、权限、引用和失败语义。Team 与 Chat 为独立业务关系，Record 为同一个可修改正文。用户明确本次不开发开放平台、模型 Tools 或公共 SDK，因此这些消费面保持既有能力，不为本次 UI 增建入口。DSH 源码、根 README 与插件版本没有修改。

| 能力面 | 本次结果 |
| --- | --- |
| UI | 团队收件箱、外部咨询、团队管理/审批、组合头像、回执、草稿/重试/冲突、编辑/撤回、媒体与链接 |
| Host owner | App 登录；账号绑定不透明引用；Team API 适配；同源实时授权媒体；未暴露内部身份/凭据 |
| Tools / SDK | 用户明确排除本次扩展；现有能力不变 |

用户从“团队消息”或“联系团队”进入。外部用户不加入团队；内部成员可共同查看和回复。首次启用通道需 owner 核对成员；此后加入须审批。历史作者 ID 11 的私聊不迁移、不共享。

## 验证入口

普通验证：`pnpm test`、`pnpm typecheck`、`pnpm build`。端到端测试文件为 `tests/e2e/team-channel.e2e.mjs`，使用未修改目标 Harness 的正式 Web scaffold、官方安装的不可变 tgz、真实 Team/Record 进程及 Mongo replica-set/RabbitMQ。仅身份目录和不相关页面请求为本地 fixture，Chat/Subject/OpenAPI 不启动。

先在全新 DSH_HOME/Profile 通过官方 CLI 安装 tgz；使用支持 pnpm-workspace 配置的 package manager。通过官方 CLI 正常启动一次该 Profile（`--no-open`，空闲端口）建立官方 module fallback 后停止该测试进程。不得手建 symlink/源码 overlay 或复用用户 Profile。

执行前提供这些环境变量：

- `ARKME_DSH_CHECKOUT`：未修改的目标 DSH checkout。
- `ARKME_PACKED_PROFILE`：已通过官方 CLI 安装不可变 tgz 的 Profile。
- `ARKME_TEAM_E2E_ORIGIN`、`ARKME_RECORD_E2E_ORIGIN`：仅允许 127.0.0.1 的隔离服务。
- `ARKME_ACCOUNT_FIXTURE_PORT`：Team 配置引用的本地身份 fixture 空闲端口。
- `ARKME_TEAM_E2E_SIGNING_KEY`：仅与本地 Team/Record 配置一致的合成凭据，不用真实环境 secret。
- `ARKME_E2E_TLS_KEY`、`NODE_EXTRA_CA_CERTS`：临时 localhost TLS key/cert，不关闭证书校验。
- `ARKME_E2E_SCREENSHOT`：可选截图文件；仅包含测试账号和测试消息。

从目标 Harness 目录执行：

```sh
pnpm exec vitest run --config "$ARKME_PLUGIN_CHECKOUT/vitest.team-channel-e2e.config.mts"
```

测试会在本地服务创建/复用合成官方团队、审批合成成员、发送与编辑测试消息、移除合成成员，不能连接真实环境。当前验证的目标为官方 `0.1.5-rc.2`，真实 macOS Chrome；没有声称 Windows/Linux 原生环境已验收。

覆盖独立来访者隔离、幂等重试、审批防绕过、共享读取、实际 UI 回复和样式、相同 Record 修改、回执受众裁剪、撤权视图清空、切换账号和粘贴真实通道链接。完整跨仓证据与索引成本在同任务 meta change。
