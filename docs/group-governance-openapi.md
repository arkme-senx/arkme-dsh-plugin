# 群治理开放平台能力

本次只迁移模型工具入口。消息和成员治理的唯一业务 owner 是 Chat，公开权限、引用和输入输出合同由 OpenAPI 维护。Arkme 通过现有官方 DSH MCP client 动态发现工具，不复制 schema、不增加本地业务代理、不在连接失败时回退到旧本地工具。

| 消费面 | 设计与验收 |
| --- | --- |
| Tools | 当前登录账号协调托管 MCP 凭据；官方 MCP client 注册 `mcp__arkme__` 工具，现有账号 guard 和执行 fence 保护账号切换、登出。隔离官方 DSH + 不可变包验收六项工具发现、七次实际调用、版本冲突和注销。 |
| SDK | N/A：本次未新增外部插件产品入口或 Host 能力；现有 ChatService/SDK 成员与消息接口仍被已有产品消费，保持既有合同，不以 MCP 代替其内部引用。 |
| UI | 未新增页面、按钮或 Host 路由。已通过真实 Chromium 在官方 DSH 聊天界面提交治理请求，检查七次工具调用和完成结果；现有群管理与撤回交互继续使用原服务。 |
| Host owner | 群关系、准入限制及消息结构终态属于 Chat；Record 正文及搜索/首页投影属于 Record；插件只负责账号生命周期和 DSH 协议接入。 |

正式工具：`query_group_message_moderation_targets`、`withdraw_group_messages`、`batch_get_group_members`、`remove_group_members`、`set_group_join_restrictions`、`list_group_join_restrictions`。输入输出以服务的 tools/list 与 REST 文档为准。

删除本地 `arkme_message_withdraw`、`arkme_group_member_remove`、`arkme_group_join_restriction_set`、`arkme_group_join_restrictions` 注册、专用实现和提示词。没有静态新工具别名、旧工具 fallback 或本地批处理工作流。

调用方可组合移出、限制和撤回。移出携带 `prevent_rejoin=true` 时，Chat 在同一成员文档中原子建立两项事实。版本冲突必须重新读取并判断原意，不能自动刷新版本重放旧操作。全历史治理查询只返回元信息；空页也必须依据 `has_more` 续页。

跨仓验收入口为 `tests/e2e/group-governance.e2e.mjs`：需要 Record/Chat/OpenAPI 测试 fixture、官方 DSH checkout 和通过官方 CLI 安装 `.tgz` 的临时 Profile。实际浏览器输入 → 官方 agent loop/grant/ToolRuntime/MCP client → OpenAPI 认证和 Registry → Chat HTTP/Mongo → 现有 completion → Record HTTP/Mongo 均实际运行。检查撤回结构、成员禁入、版本拒绝、Record 搜索可见性/首页 gate 和正文保留；登出后工具撤销。

仅登录、managed credential 控制面和模型输出使用确定性 fixture，不验证线上登录或模型规划质量。未运行外部 MQ、旧客户端消费者或 Elasticsearch；对应 owner/投递边界由仓内回归覆盖，不能把它们描述为真实端到端投递验收。使用本地额外 CA，不关闭 TLS 校验；不调用生产账号、不替换常驻实例。

本轮验证基于已合入的 dev `998e1bd`、官方 DSH `052bacaa97166b6b3240c37956ea2a1b4d3d396b`，Node 24。正式安装的 `.tgz` SHA-256 为 `a1399a4d593e1cbd8443253d64dadb94269b23fcb534e4cdfe1b4e3859f6c704`；后续仅补充测试和文档，产品代码与该包一致。typecheck/build/pack 通过，全量 vitest 5759 通过、9 跳过，1 项已有 client-adapter seat 列表断言失败已在原始 dev 复现。此次运行平台为 macOS，未声称 Windows/Linux 实机验收。
