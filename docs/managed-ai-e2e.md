# Managed AI 浏览器跨仓回归

入口：`scripts/run-managed-ai-e2e.sh`。测试不改变插件业务代码，也不修改官方 DSH。

## 准备

1. Node 24、pnpm、Go、Chrome、openssl；Intelligent 任务分支包含 `TestManagedAIPluginBrowserChain`。
2. 干净的目标官方 DSH checkout，HEAD 与已获取的 origin/master 一致；其官方 web 测试依赖已安装。
3. 在插件任务 worktree 完成 `pnpm install --frozen-lockfile`、`pnpm pack --out <临时目录>/arkme.tgz`。
4. 用独立临时 `DSH_HOME` 执行官方 `dsh plugin --profile web add -w <临时目录>/arkme.tgz`。不得使用常驻用户 profile 或 link。`ARKME_PACKED_PROFILE` 指向这个 profile 目录。
5. 准备本任务独占的 loopback MySQL 8.4（root 可建立测试库/测试用户）。Intelligent 已有 helper 随机建库并自动清理；禁止使用生产数据库。

```bash
export ARKME_DSH_CHECKOUT='<官方 DSH checkout 绝对路径>'
export ARKME_PACKED_PROFILE='<临时 DSH_HOME>/profiles/web'
export JOTMO_INTELLIGENT_CHECKOUT='<Intelligent 任务 checkout 绝对路径>'
export MANAGED_AI_TEST_MYSQL_ADDR='127.0.0.1:<本任务 MySQL 端口>'
bash scripts/run-managed-ai-e2e.sh
```

默认不需要供应商凭据。Go 启动真实 Managed AI HTTP/Service/MySQL，以本地供应商 SSE fixture 构造可重复故障；Node 使用正式安装插件和官方 DSH scaffold，Chrome 实际选择公开模型并发送消息。测试断言正常内容、502/SERVER、200 后缺失 usage 的 STREAM_CLOSED，以及同会话恢复。每轮只有一个模型 HTTP 请求；Go 通过 request_uid 核对用户、公开模型、route、usage、精确金额、一次结算/释放与最终预占归零。

可选设置 `JOTMO_MANAGED_AI_BROWSER_LIVE=1`、`JOTMO_MANAGED_AI_TEST_DEEPSEEK_API_KEY`，改用真实测试供应商执行一轮成功链；这是付费 API 调用。key 仅传 Go，不进入 Node/browser，也不自动读本机配置。`ARKME_E2E_SCREENSHOT` 可设置截图绝对路径。

登录与充值种子为本地 fixture，不能宣称此测试覆盖了真实生产登录/支付。没有生产 Ingress、K8S 和 Windows/Linux 真机验收。测试使用独立 TLS、状态目录和 keychain namespace，保留常驻客户端；shell 退出删除本次生成的 TLS 文件，调用方负责回收其创建的 MySQL 容器和临时安装 profile。

2026-09-10 验收：官方 DSH `d347e703`、插件 dev `562b61d`，确定性四场景与真实 DeepSeek 场景均通过。完整场景/实现/账本矩阵在 Intelligent 同任务分支的 `docs/managed-ai-model-proxy-premerge-review.md`。
