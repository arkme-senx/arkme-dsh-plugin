# 私聊菜单合并前审核与修复记录

日期：2026-09-09。目标基线 `dev@f7a9f1f`；初始实现提交 `9311880`。只提交/推送任务分支，不合并或发布。上一次方案分析与本次实施说明分别保留，不能把历史分析中的“未实施”当作当前状态。

## 审核结论与循环

第一轮并非直接判定实现通过：先复现失败，再修正以下问题。

| 级别 | 已确认路径与影响 | 修复落点 | 反例测试 |
| --- | --- | --- | --- |
| P1 | Host 解析私聊成员后，封禁请求再次读取当前会话；此时换号会把旧目标与新操作人混合 | `UserBanService.context` 在两跳之间校验 userId/refreshToken，并显式传递同一会话；公用 owner 覆盖 UI/SDK/Tools | `services/user-ban-service` 的 account/login 变更用例；`private-chat-actions-chain` 的 HTTP 跨账号用例 |
| P2 | 身份首次失败后，重新打开菜单没有恢复核验入口 | 打开时调用身份资源的非强制刷新：失效则重试、有效则复用，不循环重试失败 | `private-chat-actions-ui`: retries an unavailable identity |
| P2 | 封禁查询被明确拒绝后，重试开始清除 error，旧员工资格导致入口短暂重新出现 | 公共资源保留上一次错误直到成功；不把“正在重试”当成已解除拒绝 | `private-chat-actions-ui`: keeps a known authorization rejection hidden |

第二轮从查询/操作并行场景复查，又确认：非强制读取先等待 pending，再判断已有有效值，会使封禁操作等待无关的后台 Profile。调整为先复用仍有效快照，强制刷新仍加入共享请求。`resource-store` 的 still-fresh fact 用例先失败、修复后通过。

修复没有新增状态、依赖、配置、动态工作流或公开业务接口。错误、身份、拒收版本和封禁不确定结果仍由各自 owner 解释。针对修复重新执行场景测试、类型检查、全量测试与制品验收，不能只复跑最初发现的断言。

## 场景 → 代码 → 测试映射

下面路径均相对插件仓；跨仓路径注明仓名。对“未知”和“未执行”明确保留边界，不以猜测补齐。

| 场景 | 代码链与不变量 | 证据 |
| --- | --- | --- |
| 首次打开、无缓存、慢请求 | `PrivateChatActions.privateChatActionItems` 使用未勾选/隐藏资格/员工默认封禁；默认值不进入 Store | UI immediate-result、真实安装包慢请求验收 |
| 热打开 | `useResource` open/enabled 订阅刷新；Sidebar 每次打开刷新 admission | UI revalidates warm snapshots；Sidebar 回归 |
| 查询失败/离线 | `ResourceStore.refresh` 保留已知 value/error；各行反馈互不阻塞 | resource-store、UI local failure |
| 初次身份失败后重开 | `usePrivateChatActions` 非强制身份刷新；失败不形成 effect 无限循环 | 新 UI 恢复反例 |
| 已核验身份后台刷新 | `ResourceStore.refresh(force=false)` 立即使用有效事实；默认强制读仍联网 | 新资源层反例、UI warm snapshot |
| 普通/未知/持久化旧员工 | identity 只从 `user.profile.refresh` 接收当前账号匹配结果；`canManage` 默认 false | Store unknown/persistent/mismatched profile；HTTP ordinary-account |
| 员工身份过期/刷新失败/明确拒绝 | 60 秒客户端新鲜度、stale 检查；已知拒绝直至成功都隐藏 | UI expiry、focus、pending denial retry |
| 退出、换环境、同账号重登 | auth binding 观察每次 auth transition；Store reset 取消旧任务、版本防晚到；键隔离环境和账号 | auth-binding、Store logout/login/old completion |
| Provider 重启 | `provider-instance-runtime` reset 所有菜单资源并重读活动订阅 | provider-instance-runtime、资源 reset/订阅保留 |
| 切换私聊、返回原私聊 | key 按账号和稳定 sourceKey 隔离；未发出的确认检查当前目标；已发命令不因导航被宣称回滚 | Store delayed navigation/latest sourceRef；Sidebar 会话切换回归 |
| 引用更新但会话不变 | `chatActionKey` 稳定身份；entry.binding 更新请求引用，缓存不清空 | Store stable chat/latest opaque reference |
| 旧持久化/损坏/配额失败 | admission adapter 验证状态、布尔和双 revision；存储异常不导致服务端成功变失败 | direct-message-admission-ui、resource-store persistence |
| 多消费者、重复点击、失效风暴 | 一个 pending、同步写锁、dirty 合并；单消费者离开不取消共享任务 | resource-store join/lock/invalidate/unsubscribe |
| 晚到旧查询与写回执竞争 | mutation 提升本地 version，旧 read 不能 commit | resource-store old-read-before-mutation |
| 双方向版本回退/不可比较 | admission.accept 要求两个版本都不倒退；不拼装假投影，最多一次补读 | Store two revision axes、resource bounded recovery |
| 缺少真实 revision 时点拒收 | 先读取完整 admission；捕获 refused=true，不按新结果反转 | Store default intent、HTTP refusal/revocation |
| CAS 冲突 | Chat `SetOwnRefusal` → Host `ArkmeDirectMessageAdmissionError` → SDK error body →同一 Store；不自动重放 | HTTP chain conflict；Chat Handler/domain/真实 E2E |
| 创建开关关闭、已有拒收解除 | `setRefused` 与 Host/Chat 保持“只禁止新增，不禁止解除” | direct-message-admission boundary/UI；Chat rollout/revocation |
| 仅对方拒收/互相拒收 | `projectDirectMessageAdmission` 校验四态，Composer 订阅同一 canSend | direct-message-admission 四态；Chat 真实 E2E |
| 草稿、附件、转发、历史编辑 | 只改 admission Hook 事实源；保留 `requireDirectMessageSendAllowed` 与原发送/编辑流程 | conversation-send-directory；制品草稿保留；Chat 新发送阻断/稳定重放/历史保留 |
| 相关录音资格和列表权限 | eligibility 仅 Backend able-func 17；page 独立重验资格并走 Chat 聚合/来源权限；不提前读 Audio 列表 | related-recording-service；HTTP chain eligibility denial；Chat related-recording Handler 测试 |
| 封禁目标/操作人 | 浏览器只传 sourceRef/remark；Host 验签、Chat 活跃成员精确确定一个对端；Backend 从鉴权读取员工/正常状态 | Host API、真实 HTTP chain、Backend ensureUserBanStaff/Handler 测试 |
| 两跳中换号/重新登录 | `UserBanService.context` 防新凭据复用旧目标；Backend 请求固定同一登录 | 新 owner 两个反例及 HTTP chain |
| Mongo 已写但 Redis 发布失败/回执丢失 | UnconfirmedBanError 保留显式方向；read-back 不证明全部副作用；只有明确重试 | HTTP chain 同向两次 ban；Backend service publication-failure 测试；制品页面验收 |
| 取消确认/确定拒绝 | 不发送写入；保留此前不确定重试；login-required/context-changed 是已确认未提交路径 | Store canceled confirmation/definite rejection；Host context |
| 跨源/伪造账号目标 | Host Origin、签名 sourceRef、服务端身份不信任浏览器伪造 id；返回屏蔽内部操作人/目标字段 | HTTP chain forged origin/cross-account；host-api 与 SDK 回归 |
| 键盘、焦点、按下到释放间变更 | 通用菜单捕获动作；结构改变取消手势；Escape/方向键/焦点恢复；实际尺寸定位 | UI keyboard/gesture/permission removal/第四项 |
| 后续新增选项 | 显式声明 id/visibility/action；业务经 `PrivateChatActionsPort`，资源层不理解业务权限 | UI 第四项测试、代码依赖审查 |

## 实际验证层次

1. **插件连通测试**：`tests/private-chat-actions-chain.test.tsx`，真实 React 交互、SDK fetch、本地 HTTP Host、ArkmeService、请求协调器、SQLite/Profile 持久化及响应投影。仅 Auth/Chat/Backend 的最外层上游 HTTP 使用受控协议夹具；不是 mock Host 返回值。六项覆盖拒收/解除、CAS、封禁不确定结果、普通账号/列表拒绝、Origin/签名及两跳换号。
2. **Chat 服务端门禁**：只读任务 worktree `193f8dd`，`internal/chat` 与 `gin/api` 相关测试通过；`test/e2e/run_chat_direct_message_refusal.sh` 通过。后者启动隔离 Chat、Record、Mongo、Redis、RabbitMQ、IM，执行真实 Handler/存储/接收通知，包含双向四态、新消息不产生正文/关系/完成任务、历史与稳定重放保留、解除恢复、SSE 失效。Record `76b2916`、IM `2e3837a`，均未修改代码。
3. **Backend 服务端门禁**：`072fdcc` 的 `internal/userban`、`gin/api`、`gin/middlewares` 定向测试通过。通过自带 Compose runner 提供隔离 Mongo/Redis 初始化条件；Handler 中的员工读取与领域测试仍按仓库现有 fake seam，不将它称为真实生产鉴权/全持久化 E2E。测试覆盖普通/异常员工/自封拒绝、显式命令、事实与 Redis 发布失败。
4. **制品 UI**：未修改官方 DSH、隔离 Home/凭据命名空间、`.tgz` 安装，验证菜单及恢复交互。详见实施说明。

修复后的 Node 24 全量回归：460 个文件通过、4 个跳过；5,087 项测试通过、6 项跳过；类型检查与 bundle 构建通过。最终制品重新安装后，其 `lib/client.js` SHA-256 与当前构建一致。页面复验普通账号慢请求时无加载占位、无封禁入口且封禁查询为 0；员工不确定回执展示“重试封禁”，明确重试后的记录为两次 `user-ban.ban`、零次 `user-ban.unban`，确认成功才显示“解封用户”；没有发送消息。浏览器验收使用本地受控账号，不写真实业务。

环境失败没有被改成“通过”：裸 Backend Gin 测试先因支付初始化配置失败；无 Docker runner 再因缺少 Redis 初始化失败；最终使用仓库正式 Compose runner 后通过，临时配置与容器由 runner 清理。插件未登记 catalog target，采用仓库原生测试；缺口属于编排能力，不是业务断言失败。

## 未夸大的边界

- 上述是分层连通与真实服务端测试，不是一次连接真实生产 Auth/Chat/Backend/Audio 的全系统浏览器 E2E。未对真实用户执行拒收/封禁；未创建上线灰度或配置。
- 员工资格新鲜度不是实时撤权推送；服务端最终鉴权保持。封禁公开合同没有 CAS，也没有新增跨客户端/跨重启持久化命令队列。
- Windows/Linux 未实机验证。本次不修改跨平台、原生凭据或进程实现。
- 没有任何有限测试能证明“绝对不会回归”；合并建议依据已执行断言、完整 diff、边界记录和未发现剩余阻断项，不以口头保证替代证据。
