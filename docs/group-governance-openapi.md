# 群治理开放平台能力

本次只迁移模型工具入口。消息和成员治理的唯一业务 owner 是 Chat，公开权限、引用和输入输出合同由 OpenAPI 维护。Arkme 通过现有官方 DSH MCP client 动态发现工具，不复制 schema、不增加本地业务代理、不在连接失败时回退到旧本地工具。

| 消费面 | 设计与验收 |
| --- | --- |
| Tools | 当前登录账号协调托管 MCP 凭据；官方 MCP client 注册 `mcp__arkme__` 工具，现有账号 guard 和执行 fence 保护账号切换、登出。隔离官方 DSH + 不可变包验收发现目标、六项治理能力、直接及 run_code 调用、取消、六次确认、13 次实际调用、版本冲突和注销。 |
| SDK | N/A：本次未新增外部插件产品入口或 Host 能力；现有 ChatService/SDK 成员与消息接口仍被已有产品消费，保持既有合同，不以 MCP 代替其内部引用。 |
| UI | 未新增页面、按钮或 Host 路由。真实 Chromium 在官方 DSH 聊天界面提交治理请求、取消并逐次确认；移出执行后通过已有 members-invalidated 事件刷新成员展示，现有群管理与撤回交互继续使用原服务。 |
| Host owner | 群关系、准入限制及消息结构终态属于 Chat；Record 正文及搜索/首页投影属于 Record；插件只负责账号生命周期和 DSH 协议接入。 |

正式工具：`query_group_message_moderation_targets`、`withdraw_group_messages`、`batch_get_group_members`、`remove_group_members`、`set_group_join_restrictions`、`list_group_join_restrictions`。输入输出以服务的 tools/list 与 REST 文档为准。

删除本地 `arkme_message_withdraw`、`arkme_group_member_remove`、`arkme_group_join_restriction_set`、`arkme_group_join_restrictions` 注册、专用实现和提示词。没有静态新工具别名、旧工具 fallback 或本地批处理工作流。

调用方可组合移出、限制和撤回。移出携带 `prevent_rejoin=true` 时，Chat 在同一成员文档中原子建立两项事实。版本冲突必须重新读取并判断原意，不能自动刷新版本重放旧操作。全历史治理查询只返回元信息；空页也必须依据 `has_more` 续页。

跨仓验收入口为 `tests/e2e/group-governance.e2e.mjs`：需要 Record/Chat/OpenAPI 测试 fixture、官方 DSH checkout 和通过官方 CLI 安装 `.tgz` 的临时 Profile。实际浏览器输入 → 官方 agent loop/grant/ToolRuntime/MCP client → OpenAPI 认证和 Registry → Chat HTTP/Mongo → 现有 completion → Record HTTP/Mongo 均实际运行。检查撤回结构、成员禁入、版本拒绝、Record 搜索可见性/首页 gate 和正文保留；登出后工具撤销。

仅登录、managed credential 控制面和模型输出使用确定性 fixture，不验证线上登录或模型规划质量。未运行外部 MQ、旧客户端消费者或 Elasticsearch；对应 owner/投递边界由仓内回归覆盖，不能把它们描述为真实端到端投递验收。使用本地额外 CA，不关闭 TLS 校验；不调用生产账号、不替换常驻实例。

验证使用 dev 基线、官方 DSH `052bacaa97166b6b3240c37956ea2a1b4d3d396b` 和 Node 24。包通过官方 CLI 安装到隔离 Profile；完整测试结果和不可变包 SHA-256 记录于跨仓交付报告。此次运行平台为 macOS，未声称 Windows/Linux 实机验收。

## 旧工具替代与体验合同

| 下线的模型工具 | 正式替代能力与目标发现 |
| --- | --- |
| arkme_message_withdraw | withdraw_group_messages，单条是一个 item；通过已有会话/消息读取获得群 UID 与 sequence，指定发送者全历史定位使用 query_group_message_moderation_targets。仍是群主撤回他人消息，不替代自己的消息删除、私聊操作或平台封禁。 |
| arkme_group_member_remove | list_chat_members 获得 user_ref，batch_get_group_members 读取 version，remove_group_members 执行；prevent_rejoin=true 保留原移出并禁入场景。 |
| arkme_group_join_restriction_set | set_group_join_restrictions；单独设置不移出，解除不拉回，冲突需要重新读取和确认。 |
| arkme_group_join_restrictions | list_group_join_restrictions 返回当前群昵称/公开名称、user_ref、版本及限制时间；离群成员也能识别并解除。 |

名字只辅助展示，不作为操作身份。缺少当前资料时名称为空，重名或资料不足不能猜人；不以历史快照或私密真实姓名代替当前名称。原 UI/SDK 的头像和成员展示字段继续沿其已有接口提供。

三个 MCP 写工具复用 ArkmeConversationalConfirmation 和 DSH 公开 tools/execute 扩展点。待确认意图绑定当前账号；切换账号后重新确认，不泄露该内部身份。首次调用仅展示问题、结束当前轮次；同轮重试或插件消息不执行，后续直接用户明确确认后才重放相同目标和业务参数。自然语言确认/取消的语义仍由模型判断，与原机制一致。为遵守远端输出 schema，待确认用工具的非执行错误结果承载原 confirmation_required；仅完全匹配当前 pending 的结果可作为已准备确认：直接调用以该结果落盘为准；run_code 子调用还必须等待根调用成功落盘。待确认的错误消息与内容使用同一 JSON，代码调用方可捕获 confirmation_required 并向用户提问；普通子调用失败、根调用失败或结果未落盘仍重新准备。不会伪造空成功批次，也不扩展 OpenAPI 的业务输出 schema。

remove_group_members 实际派发后，无论完整成功、部分结果或结果未知，插件通过窄 GroupGovernancePresentation 接口清除本账号所涉群缓存，并发布已有成员失效事件；不解析人物引用、不把传输成功推断为移出成功。账号切换时不向新账号发布旧账号事件，缓存失败不覆盖写结果。此装配接口不增加 SDK/Host 业务路由。服务端既有入群通知与主动退群事件不能混作移出通知。

验收从正式 MCP 查找群和成员开始，不预注入目标引用；实际完成 13 次服务调用与 6 次本地确认，浏览器取消后验证零写入，最终核对名单名称、解除/重设后的版本、两次移出派发对应的本地失效事件，以及 Chat/Record 的持久状态。模型为确定性 fixture，因此不宣称自然语言规划质量已经验收。

## 下线发布条件

顺序必须是 Chat 全部 writer/worker 与索引就绪 → OpenAPI 正式接口和文档可用 → 当前账号 managed MCP 为 ready、六项治理工具及现有会话/成员发现工具可用 → 发布删除旧工具的插件。Record 仅新增验收测试，无生产发版依赖。

MCP 显式关闭、凭据尚未就绪、服务仍是旧版本时，不满足旧工具下线的体验前提；不能宣称这些状态下无损，也不自动改用户设置。发布前必须核实支持范围内的账号/Profile 已满足该条件。失败恢复使用既有连接状态与重试机制，不新增开关或旧工具 fallback。

这是模型工具名称和引用合同的替换，不承诺旧工具名或旧引用仍可执行。新会话从当前 tools/list 获取定义，存量会话重新通过正式读取工具定位目标，不能把 source_ref/member_ref/message_withdrawal_ref 拼装为公开引用。若有依赖旧名字的固定自动化，必须先迁移调用合同。回退先恢复插件入口，再按服务端既定顺序停用新公开入口；不回滚已成立的治理事实。
