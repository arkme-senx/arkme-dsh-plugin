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


读取失效先撤下材料再回源：目录和消息保留身份、未读、偏好；本地revalidating保留多选身份但禁用材料动作。命令补全的零Record版本ACK不能恢复已存在的读取事实。草稿及发送中引用预览复用Host preflight按当前账号/会话/精确源版本复验，不改immutable command或用户输入；失败/迟到旧授权不能恢复摘要。详情正文必须来自当前extensions读取，不能在读取完成前用传入快照回显。


本人撤回成功也必须向既有本地Team失效总线广播，不能等待IM往返才撤下目录摘要。只读聊天预览和转发选择器摘要同样消费当前读取资格；预览分页旧回包不能复活，冻结目录fallback只保留身份。转发目标、附言与已接受结果保持原owner，读取复验仅覆盖源材料。


重新编辑中的用户输入是独立本地修改；原文提示仍是源读取材料。失效只撤下原文提示，不清输入。短暂网络失败可通过online/focus重新复验；旧响应与卸载后的响应不能恢复材料。
