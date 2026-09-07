# DSH 人工文本与系统主题跨仓验收

`scripts/run-dsh-input-e2e.sh` 使用目标 Harness 自带的 Web scaffold 和无密钥模型回放，在真实 Chrome 中提交文本，再通过正式安装的 Arkme 包进入真实 Record API/Mongo/Redis。测试属于插件仓，不把 Arkme 业务 fixture 放进 Harness 产品代码。

前置：Node/pnpm 满足目标 Harness 的要求；两仓已安装依赖；本机 Docker、OpenSSL、Go 和 Chrome 可用。先从插件任务分支生成 `.tgz`，使用目标 Harness 官方 `dsh plugin --profile <name> add -w <artifact.tgz>` 在全新临时 `DSH_HOME` 中安装。不要传用户真实 Profile 或 `link:` 安装。Profile 只用作不可变包解析锚点；每个测试另建 state、凭据命名空间和浏览器上下文，不读取其账号配置。

```sh
ARKME_DSH_CHECKOUT=/path/to/target-harness \
ARKME_PACKED_PROFILE=/path/to/temporary-dsh-home/profiles/web \
JOTMO_RECORD_E2E_RECORD_REPO_PATH=/path/to/task-record \
DSH_WEB_TEST_BROWSER_CHANNEL=chrome \
bash scripts/run-dsh-input-e2e.sh
```

验证 Enter、发送按钮和合成事件的差异；前两者仅写入原始文本且恰好一条，后者零归档；服务返回权威主题类型；SDK 和真实 DSH Tool 读取同一首页策略；实际页面不显示发送入口，开关经持久化成功后更新。

身份服务和无关 Chat 上游是固定隔离 fixture，不是生产登录验收。Records/Topics/Home 请求全部转发到 runner 自建的真实 Record 栈。临时证书仅用于回环 HTTPS，未关闭全局证书校验。退出时清理本次浏览器、Host、账号凭据、临时目录和 Compose 栈，不触碰常驻 DIC。

默认端口探测不是跨进程原子预留。与其他 Record E2E 同时启动时，应通过既有 `JOTMO_RECORD_E2E_PORT_SEARCH_START` / `JOTMO_RECORD_E2E_PORT_SEARCH_END` 指定不重叠范围，或依次启动；不要把端口竞争当作业务断言失败。
