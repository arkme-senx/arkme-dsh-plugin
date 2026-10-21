# Arko 图片输入实施

基线：`origin/dev`，`6f7ec2f7`（最初从 `3c04defd` 建分支，已合入本轮 dev 更新）。用户明确指定 dev；本任务不修改版本号、根 README 或 DSH 源码。

## 能力矩阵

| 能力面 | 入口与 owner | 验证要求与当前状态 |
| --- | --- | --- |
| UI | Arko 图片草稿、发送、待确认轮次、历史和续接；通过 Host 调用 ArkoService | 纯图 v3、历史缩略图及缺图占位已在安装包官方 DSH 页面验收；失败重试、续接、传播限制有仓内测试 |
| Tools | 既有 `arkme_arko_ask` 扩展不透明本地文件引用；现有工具授权和稳定 call ID | schema、能力/失败合同及官方 DSH 真实会话工具执行通过；复用上传文件不重复上传 |
| SDK | 公开 Arko 类型与方法，使用现有 SDK Host transport、账号和 dispose 生命周期 | 最终 tgz 的仓外 Consumer 严格编译通过；官方 DSH 上纯图发送并等待回复通过 |
| Host owner | ArkoService 唯一处理图片能力、上传、冻结请求、身份、受理与恢复；StateStore 持久化，Files owner 保留原文件 | 账号隔离、冻结请求、文件保留、受理后确认失败、默认模型变化、旧 pending 导入及跨适配器合同测试通过 |

## 不变量

- 图片上传只通过既有 Files owner，不接受任意路径、URL 或供应商文件 ID。
- 图文调用独立 v3；纯文字继续使用既有入口。已冻结的请求按同一 clientTurnUid 重放，不重新读本地文件或选模型。
- 文件保留依赖由 Arko owner 提供，不冒充快记重编辑草稿。
- 续接图片依据实际 run 能力，不能使用 UI 当前模型推断。
- 含原图用户消息不能进入仅能保留文本的转发/分享；导出仍明确提示不含图片文件。
- 最终交付须分别记录单测、构建、不可变 tgz、隔离 DSH 安装、Tools/SDK/UI 行为证据；缺少真实环境证据不能视为完成。

## 验收记录（2026-10-19）

最终包 SHA-256：`26719968da53c19719d77ecde5724723713e8d89da8ee028cfec5bad1aa76d1d`。构建、全量测试、typecheck、仓外SDK consumer均通过。

审查修复包含同UID重复历史图片位置、SSR document guard；合并最新dev保留其多选覆盖布局及模型目录刷新。DOM标记测试等待真实owner metadata/焦点帧并模拟浏览器blur，未放宽生产选区权限。

仅有macOS本地运行证据，Windows/Linux及Android/iOS真机不在本轮已验范围。

- 全量：1078 个测试文件通过，12645 个测试通过，另有 15 个文件/20 个测试按原条件跳过；构建通过。
- 不可变包：任务工作区 `analysis-evidence/release-review-package/senguoyun-dsh-arkme-3.0.15.tgz`，从该包安装到隔离 profile；未修改 DSH 源码或常驻进程。
- 官方 DSH `0.1.5-rc.2` / `fb2c4b9e698e`：`tests/e2e/arko-images.e2e.mjs` 通过 SDK、会话 Tools、UI 三入口，观察到实际上传与 v3 请求以及流式完成；截图在任务工作区 `analysis-evidence/arko-release-review-full-chain.png`。
- 新增连接 circuit：设置 `ARKO_CHAIN_BROWSER=1`，Intelligent `TestArkoImagesFrontendBackendCircuit` 启动实际受理/SQL/outbox、Camellia实际compound、managed-ai/Files物化/资金、event/SSE/history；本文件的E2E通过 `ARKO_CHAIN_CONTROL` 连接。最终不可变包通过 SDK 两图、会话Tools反向两图、UI单图发送，多轮供应商输入顺序严格断言；历史刷新5图，隐藏原图后原clientTurnUID重放和5个缺图占位通过。结算6条、唯一原图上传2份、临时资产0、预占0。
- 上述连接 circuit 的对象投递/Record服务、供应商wire、队列调度/返回传输仍为隔离fixture，Camellia Run Mongo调度未接入；Record真实Mongo、真实供应商识图/付费replay分别验证。不能称为已部署的全套服务/OSS远程E2E。
- 运行入口：设置 `ARKME_DSH_CHECKOUT`、`ARKME_PACKED_PROFILE`、隔离 TLS 证书/密钥路径后，在官方 DSH checkout 运行 `pnpm exec vitest run --config <plugin-worktree>/vitest.arko-images-e2e.config.mts`。证书只用于本地测试，不写入仓库。
