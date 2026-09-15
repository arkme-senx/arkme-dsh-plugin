# 群内本人昵称

群聊右上角三点菜单提供“修改群昵称”。所有活跃群成员均可修改自己的昵称，无需群主权限。私聊不提供此入口，也不修改群名称或账号公开昵称。

与移动端一致：输入 trim 后为 1–10 个 Unicode code point；读取失败可以重试；保存期间禁用操作；失败保留输入；成功采用服务端返回的昵称。切换群或账号后，旧请求不可更新当前界面。

菜单按“个人设置”和“群管理”分组，解散/退出群聊独立置底并使用危险操作色；群名称入口使用“修改群名称”，昵称使用移动端同款编辑图标。

## 能力合同

| 消费面 | 入口与行为 |
| --- | --- |
| UI | 三点菜单 → 当前昵称弹窗 → 保存/错误重试；复用带焦点约束和 Escape 的弹窗 |
| Host | ChatService.groupSelfNickname / setGroupSelfNickname；当前账号派生 target_user_id，来源引用绑定账号，仅接受 group_chat |
| 同源 API | group.self-nickname / group.self-nickname.set；参数 sourceRef 与 nickname；返回 sourceRef、memberRef、nickname |
| SDK | createArkmeSdk().groupSelfNickname / setGroupSelfNickname；通过 capabilities().features.groupSelfNickname 探测，支持 AbortSignal |
| Tools | arkme_group_self_nickname / arkme_group_self_nickname_set；business/hybrid 注册，写入需要 explicit-user-write 和会话确认 |
| Client | 沿用现有 Browser/Host 装配，不新增原生桥或桌面宿主代码 |

上游协议为 /api/v1/chats/members/update，action=4，display_name_snapshot，目标固定为当前用户。读取通过 members/by-user-ids 只查本人，不拉取全群。服务端权限错误原样走既有错误合同；响应必须匹配会话、本人、活跃状态和有效昵称。重复设置同一昵称不会追加其他业务副作用，不自动重试写操作。

保存后失效 Host 成员读取 epoch，并更新既有 SQLite 成员快照；UI 更新既有账号/群作用域的成员仓，取消旧 hydration，保留头像和统计。原有成员仓继续负责有界刷新、订阅和销毁，不新增轮询。

## 验证

- group-self-nickname.test.ts：真实本地数据库、同源 Host、SDK、官方 DSH ToolRuntime 注册/确认/调用/卸载；空白、Unicode 上限、跨账号引用、私聊、错误响应与后端失败。
- group-self-nickname-ui.test.tsx：预填、读取重试、失败保留、重复提交和卸载后取消。
- group-settings-menu.test.tsx：普通活跃成员可见入口，不依赖群重命名权限。
- conversation-members-store.test.ts：保存结果不被先发旧读取覆盖，其他成员及账号不受影响。
