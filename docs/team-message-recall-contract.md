# Team 消息撤回

T09在现Team Host owner中撤回本人当前会话的一次发布；不限时，当前读取资格必需，成员/访客对称，无管理员代撤。保留个人Record和其他独立发布。

| 能力面 | 入口与授权 | 验收 |
| --- | --- | --- |
| UI | 服务器canRecall菜单、确认、占位；未知结果回读同一身份 | 组件/Host测试与实际加载场景 |
| SDK | teamMessageRecall能力发现、recallTeamMessage、不透明账号引用、调用signal/dispose | 仓外consumer编译与调用 |
| Tool | arkme_team_message_recall，explicit-user-write，当前人类明确授权 | 正式注册/Schema及独立DSH调用 |
| Host | team.app.recall与team.messages.recall共用TeamAppService；服务器裁决权限/状态/幂等 | 同语义、跨会话拒绝、未知结果核对 |

recalled是不可恢复终态。投递任务已完成，不能重发或补全文；消息revision单调，已知终态不被旧ACK覆盖。收到changed时沿原generation刷新读取与详情/媒体绑定。单条message_recalled不等同not_accessible。

复用team.message.changed；没有新配置、队列状态、缓存owner或worker。原cancel只待发，delete仍是Record全局删除。旧Provider不支持时SDK显式失败，不回退这两个动作。
