# Team 表态的群聊体验对齐

Team 消息复用群聊的表态面板、短语库、状态 store 和资料卡。表态行位于消息气泡内、时间之前；气泡与 viewport 提供共享 hover 定位标记，阅读回执保留原旁侧位置。菜单请求直接打开，末尾加号依次打开/关闭/打开；表态按钮和参与者点击不进入消息详情。

授权表态快照先返回，资料随后补全。Team 内部视角可使用账号作用域的 opaque person key 复用现有消息/回执备注；本人使用当前 profile。未在本地出现的参与者由既有 Host profile/私人备注 owner 补全。可选资料读取失败保留表态事实，账号变化和授权失败继续拒绝读取。外部视角不解析或返回内部成员目录。

## 能力面

| 面 | 本次范围 | owner / 验证 |
| --- | --- | --- |
| UI | 气泡内布局、hover、加号切换、本人资料和备注 | 原 ArkmeReactionPreview / Selections / ReactionPreviewStore；启用真实 Team target 的 DOM 回归与正式安装包浏览器场景 |
| Host | 既有 reactions 查询的延迟展示和可选资料失败降级 | 原 ArkmeService.reactions / ReactionService；不新增路由、写命令或持久化 |
| SDK | 既有 sdk.reactions 接收相同结果；ReactionActor 增加可选 teamPersonKey | 公开导出继续复用 reaction-contract；安装包独立 consumer 与 SDK 场景 |
| Tools | 既有 arkme_reactions_read 读取同一授权结果 | 原注册/grant 保持；官方 DSH 会话读取场景；未新增写能力 |

`reactionActorKeys` 只给已通过 reaction owner 授权的内部参与者生成与原 Team person 相同的账号别名，不读取额外成员目录，也不是新的对外查询入口。

同一身份展示适配用于行内和分页参与者；query、groups、actors 的授权内部参与者均携带该可选别名，资料服务降级时仍可复用已知的本人昵称和私人备注。

## 范围

不改变 Team target、side、表态持久事实、CAS/幂等、消息投递或原权限合同。Team 仍不进入旧 Chat 表态通知/历史分页；消息内表态修复不等于新增提醒、定位和已查看的跨服务闭环。

## 验证入口

- `tests/team-reaction-experience.test.tsx`：真实 Team 组件的嵌套、几何标记、加号开关、本人名称。
- `tests/team-reaction-presentation.test.ts`：Host 延迟读取、资料失败、备注一致性、外部身份裁剪。
- `tests/team-reaction-actors.test.tsx`：本地身份投影与账号切换。
- `tests/e2e/team-message-official-cli-acceptance.mjs`：沿现有正式 CLI/tgz 隔离场景，设置 `ARKME_E2E_REACTIONS_ONLY=1` 验证表态 UI、SDK、真实会话 Tool；上游 HTTP 使用本地合成夹具。
