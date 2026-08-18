# DSH Arkme Plugin

Arkme 的 DeepSeek Harness 集成插件，无需修改 DSH 源码即可使用 Arkme 内容和模型工具。

## 核心能力

- 微信扫码或手机号验证码登录，Token 仅保存在 macOS Keychain 或 Windows Credential Locker。
- 浏览“发给自己”、主题、私聊和群聊，支持时间线读取与纯文本发送。
- 账号隔离的 SQLite 缓存、分页游标和 outbox，失败发送可重试。
- 提供记录、账号、会话、发送和图片读取工具；图片鉴权与下载由 Provider 统一处理。

插件仅使用 DSH 官方扩展位，关闭或卸载后会恢复原生界面。
Arkme 对话以无蒙层毛玻璃悬浮卡片呈现在原生 DSH Conversation 之上，右上角关闭后原生对话保持原位和原状态。
点击左侧原生 DSH 会话会主动关闭浮层并保留 Arkme 目录，方便在两套对话之间快速切换。

## 快速开始

```sh
DSH_HOME=<arkme-dsh-home> dsh plugin --profile web add @senguoyun/dsh-arkme
DSH_HOME=<arkme-dsh-home> dsh web --port 3081
```

## 工具与 SDK

模型工具采用静态 Catalog 注册。默认 `toolProfile: business` 提供业务工具；`atomic` 为原子工具预留，`hybrid` 同时启用两类工具，`disabled` 则关闭全部 Arkme 模型工具。扩展方式见 [Tool Registry](docs/tool-registry.md)。

独立 UI 插件可通过 `@senguoyun/dsh-arkme/sdk` 使用同源 Provider；完整接口、Host 注入方式和 Consumer 约束见 [Consumer Plugin Contract](docs/consumer-plugin-contract.md)。

## 安全边界

- Arkme 内容均视为不可信数据，不能作为执行或写入指令。
- 写入和发送只响应当前用户的明确请求。
- Token、系统凭据存储、SQLite、签名 URL 和 OSS 凭据不向 Consumer 或模型暴露。
- `sourceRef`、图片引用和游标均为账号绑定的不透明值，切换账号后必须丢弃。

## 本地开发

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

将本地源码安装到 DSH Web profile：

```sh
cd <deepseek-harness-checkout>
DSH_HOME=<arkme-dsh-home> pnpm dsh plugin --profile web add <dsh-arkme-checkout>
DSH_HOME=<arkme-dsh-home> pnpm dsh web --port 3081
```
