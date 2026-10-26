# 账号密码登录

手机号登录按钮下方增加次级文字入口，在原登录区域切换账号、密码表单，支持密码显隐、回车提交和返回手机号登录。提交期间禁止重复操作；密码仅保存在当前表单内存中，离开、成功或卸载时清空。

沿用移动端 `/api/public/v1/auth/login-by-pwd` 的 `account`、`pwd`、`unique_code`、`keep_cancel: true` 合同。账号会去除首尾空白，密码保留原始空格。登录完成、注销确认、手机号要求和凭据存储继续由 Host AuthService 统一处理，客户端及 DSH 无需源码变化。

## 能力矩阵

| 消费面 | 入口与边界 | 验证 |
| --- | --- | --- |
| UI | 手机号登录 → 账号密码登录；用户亲自输入，返回时清空密码 | 组件测试及官方 DSH 打包 E2E 覆盖焦点、显隐、失败、返回、回车、提交状态和成功 |
| Host | `auth.password.login` → AuthService → 既有 `acceptLoginSession` | 移动端请求合同、密码空格保留、失败不覆盖凭据、手机号和注销门禁、取消响应 |
| SDK | `loginByPassword`；通过 `passwordLogin` 能力探测，支持 AbortSignal，仅返回安全登录快照 | 仓外 Consumer 类型编译、打包 SDK 调用、旧 Provider 明确返回不支持 |
| Tools | 既有 `arkme_plugin_contract` 提供能力发现和人工登录指引 | 官方 DSH 真实会话发现并调用；无凭据参数 |
| Client/Harness | 使用现有同源 Host API 与账号作用域桥 | macOS 客户端构建及隔离实例加载；无新增原生协议 |

Tools 不接收或提交密码，密码不能进入工具参数、会话记录或模型输出。SDK 面向用户直接操作的 Browser consumer，禁止把密码转交模型或持久化。UI、SDK 和能力发现共用同一个 Host 业务 owner。

## 前台恢复

窗口 focus/visibilitychange 仍执行原有认证校验。重新读取登录配置时，启动页和侧栏保留用户选择的登录方式及当前表单；只有尚未选择或原方式已不可用时使用默认方式。登录完成或进入必须绑定手机流程后释放该选择。

回归测试覆盖两个登录入口的手机号、账号密码模式以及重复状态刷新。打包 E2E 通过真实 Browser focus/visibilitychange 验证两次前台校验后仍保留账号密码表单。

## 验证方式

```sh
pnpm typecheck
pnpm build
NODE_OPTIONS=--no-experimental-webstorage pnpm test --maxWorkers=8
```

Node 25 内置 WebStorage 与现有 jsdom 测试环境冲突时，使用上述兼容参数；该参数不筛选测试用例。

打包 E2E 使用 `vitest.password-login-e2e.config.mts`，从未修改的官方 DSH checkout 执行，配置独立的 `ARKME_DSH_CHECKOUT`、`ARKME_PACKED_PROFILE`、`ARKME_E2E_TLS_KEY`、`NODE_EXTRA_CA_CERTS` 和 `ARKME_ACCEPTANCE_OUTPUT`。先通过官方 CLI 将插件 `.tgz` 安装到全新的隔离 Profile，再验证 UI、Host、公开 SDK 及真实会话 Tool。上游认证使用隔离 fixture。

审核账号需按现有业务规则预先配置完整。真实审核账号登录及 Windows/Linux 真机交互仍需验收；fixture 结果不代表上述验收已完成。
