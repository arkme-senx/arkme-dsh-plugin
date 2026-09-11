# 群治理工具接入

群消息撤回、移出成员和未来入群限制沿用既有 Chat owner 业务。开放平台提供六项可组合的 REST/MCP 能力；插件不实现第二套群治理业务。

## 能力覆盖

| 消费面 | 本次处理 | 验证 |
| --- | --- | --- |
| Tools | 保留四个既有本地工具；为已连接的 MCP 群治理写工具接入原会话确认与成员缓存失效 | 原目录/注册/确认回归及隔离 DSH 会话验收 |
| SDK | 既有单条业务方法继续可用；消费个人详情明确有效来源，原 SDK 方法保留 | 既有类型与服务测试 |
| UI | 保留原入口；接收既有成员缓存失效事件 | 服务事件回归；不新增群治理页面 |
| Host owner | 原 Arkme service/Chat 服务与 OpenAPI owner | 单条、批量权限和事实语义对照 |

## 入口与引用

`arkme_message_withdraw`、`arkme_group_member_remove`、`arkme_group_join_restriction_set`、`arkme_group_join_restrictions` 均继续注册，保留原引用、确认及名单呈现。MCP 关闭、未就绪时不丢失这些入口，不新增开关或自动 fallback。

已连接的 MCP 工具通过正式目录发现。已知群 UID 和 sequence 可直接撤回；按发送者定位历史消息时使用有界分页查询，空页仍检查 has_more。user_ref 只来自对应账号的正式公开读取结果，不将旧 source_ref/member_ref/message_withdrawal_ref 拼装为另一种引用。

移出、禁入和撤回独立。prevent_rejoin=true 同步原子移出并禁入，false 不解除已有禁入；单独禁入不移出，解除不重新入群。成员工具不要求新增治理版本；结果未知时核对当前状态，重新入群后不能自动重放旧的移出意图。

个人重新编辑按服务端 `source_kind` 确认当前来源；已撤回群消息可以在个人来源继续编辑，不能用旧群引用绕回会话。历史 `origin_kind` 不代替有效归属。

## 确认与缓存

新 MCP 写工具复用 ArkmeConversationalConfirmation 和公开 tools/execute 接口。待确认意图绑定当前账号及完整参数，后续用户确认后才执行；直接调用及 run_code 路径均需覆盖。同一 pending 的可辨认错误只表示等待确认，不伪造业务成功。

remove_group_members 实际派发后，无论完整成功、部分成功或结果未知，通过 GroupGovernancePresentation 窄接口清除本账号目标群缓存并发送原有成员失效事件。缓存失败不改变 owner 写结果，账号切换不将旧账号事件投给新账号。

## 交付验证

本轮修复的测试、隔离 DSH 安装包和真实服务验收结果以任务交付报告为准。此前含旧工具下线、治理版本、pending 索引及“Record 无生产改动”的结论已被本轮方案取代，不能作为上线依据。没有运行的 MQ、客户端或真实搜索引擎链路不得描述为已通过端到端验收。
