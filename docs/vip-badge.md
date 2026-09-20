# 私聊昵称会员标识

基线：dev `108b18396c9f50e64907e1231ca8d5763827aaf5`。

私聊标题的对方昵称旁显示 13px 四角星：VIP 淡紫色、SVIP 金色。
图形与颜色参照 Arkme 桌面端 TopicMemberBadge，支持深色背景。
免费、未知、缺失会员数据不显示；群聊及其他标题不显示。

| 能力面 | 实现 |
| --- | --- |
| Host | SourceService 投影现有 Chat 列表和详情中的 private_counterpart.member_type，不新增请求 |
| UI | 私聊标题消费 peerMemberType；目录及当前选中会话响应等级变化 |
| Tools/SDK | 既有 source 返回合同新增可选 peerMemberType；没有新增操作、权限或查询 |
| Client/Harness | 复用现有 Browser module，未修改原生桥、客户端源码或 DSH |

普通实时增量未携带等级时保留同一对方的已知状态；完整快照的 unknown/free 会清除旧标识。
本标识属于私聊对方，不读取当前登录用户会员资料，也不作为权益授权依据。
