# Arko 图片输入实施

基线：`origin/dev`，`3c04defd`。用户明确指定 dev；本任务不修改版本号、根 README 或 DSH 源码。

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

- 全量：1073 个测试文件通过，12602 个测试通过，另有 15 个文件/20 个测试按原条件跳过；构建通过。
- 不可变包：任务工作区 `analysis-evidence/verified-package/senguoyun-dsh-arkme-3.0.15.tgz`，从该包安装到隔离 profile；未修改 DSH 源码或常驻进程。
- 官方 DSH `0.1.5-rc.2` / `fb2c4b9e698e`：`tests/e2e/arko-images.e2e.mjs` 通过 SDK、会话 Tools、UI 三入口，观察到实际上传与 v3 请求以及流式完成；截图在任务工作区 `analysis-evidence/arko-verified-acceptance.png`。
- 该 DSH 用例的上游 API 为隔离合同 fixture；真实供应商识图、Record 内容验证与 MySQL 结算由后端独立测试验证，不能把页面用例描述为已部署的跨服务端到端测试。
- 运行入口：设置 `ARKME_DSH_CHECKOUT`、`ARKME_PACKED_PROFILE`、隔离 TLS 证书/密钥路径后，在官方 DSH checkout 运行 `pnpm exec vitest run --config <plugin-worktree>/vitest.arko-images-e2e.config.mts`。证书只用于本地测试，不写入仓库。
