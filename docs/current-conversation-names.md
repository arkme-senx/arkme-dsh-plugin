# 当前私聊名称

当前会话名称由 Chat 响应持有，真人账号昵称的事实源仍是 Auth。Chat 保留
`private_counterpart.display_name_snapshot` 与 `private_supplement.counterpart_name_snapshot`
两个兼容键，但在当前真人私聊展示中返回当前账号名称，不再返回历史成员/联系人昵称。

插件显示非空备注优先，其次使用上述当前昵称。头像资料缓存不能覆盖会话昵称。
Chat 当前名称装饰失败时，插件保留同账号上次成功展示；已注册真人不回退 pending_name。
下一次成功刷新会恢复当前昵称。pending 联系人和 Bot 使用其原名称 owner。

现有列表、详情、display-snapshots 实时投影和重连读取共用此规则，名称变化不要求消息 seq 推进。
改名本身不新增独立 SSE 广播、定时器或轮询。历史消息作者、转发和成员活动快照不变。
并发页只在名称自身于请求期间变化时保留实时名称；已读或置顶变化不能阻挡正常昵称刷新。

## 能力覆盖

| 面 | 结果 |
| --- | --- |
| UI | 目录 Host 与 Browser store 共享当前名称，既有行继续显示 displayName。 |
| Tools | 复用已注册的 arkme_sources_list，读取同一 Host；无新增工具或授权。 |
| SDK | 复用公开 listSources，字段形状和订阅合同不变；无新增版本探测。 |
| Host | Chat 统一按可见对端批量投影；插件不回写账号或历史快照。 |
| Client/Harness | 无桥接/生命周期/装配变更，客户端源码无需修改。 |

## 验证

- Chat 的公开 list/detail/display-snapshots/unread 场景覆盖同序号改名、备注保留、失败/缺失、去重批量与历史不变。
- 插件覆盖首屏、头像装饰、实时 sessions-delta、清空备注、失败恢复、账号隔离和晚返回列表/并发已读。
- 完整测试、typecheck、build 和不可变包安装结果记录在本次 OpenSpec change 的 verification.md。

部署顺序为 Chat 后端先部署，插件随后通过正常渠道交付。此改动没有数据迁移。
