# 团队消息通道交付

## 2026-10-09 通道暂停能力

既有 Team App 通道响应新增 `can_pause` 权限元数据，由 `TeamAppService` 统一映射为 `canPause`。设置页仅按该能力决定是否显示接收消息开关；`canManage` 继续控制成员申请审批和链接重置，复制链接保持原行为。客户端不按团队即我号判断官方身份，官方常开策略及拒绝停用由 Team 服务负责。

旧服务没有 `can_pause` 时，Host 回退到 `can_manage`。Client 的 `canPause` 保持可选并回退到 `canManage`，兼容旧 Host DTO、已留存的内存快照和 UI fixture。设置页本身不持久化通道对象；团队目录与会话缓存无需数据迁移。

能力矩阵：UI 覆盖开关权限、审批、复制与重置；Host owner 仍为既有 `TeamAppService`，不新增请求或写入口；Tools / SDK 沿用本功能既有的内置 App 范围，不扩展公共消费面。变更不涉及 DSH 扩展机制或平台路径。

## 2026-09-30 链接设置与会话返回

本轮是既有能力的 UI 整理，没有新增 Host 查询、命令、持久化或配置。能力矩阵：UI 为覆盖面；Tools、SDK、Host owner 无新增能力，继续调用既有 Team App owner。Flutter 同步隐藏团队会话的屏蔽入口；后端屏蔽状态与拒绝发送规则不变。

```text
团队详情 / 接收外部消息
  链接输入框 → 复制链接 → 重置图标（悬停提示；仍需确认）
  外部用户可通过链接发消息

团队会话列表（当前团队名 / 团队对话）
  同一会话行组件：头像、外部用户标识、最新内容、时间、未读数
  → 来访者会话（对方昵称 / 团队名 · 外部用户）
  → 左上返回箭头 → 同一团队列表 → 下一位来访者
```

列表与首页侧栏共用 `TeamConversationRow`，行尺寸、头像容器、正文预览和时间格式从原会话目录抽到 `conversation-directory-presentation`，私聊、群聊保留原值。团队列表限制内容宽度；当前团队已在页头标明，行内不重复堆叠团队名。窄窗优先保留昵称，由标签截断，避免标签与时间挤掉昵称。返回使用既有 workspace intent，不新增导航栈；发送后保留原有目录刷新和草稿持久机制，切换用户不串草稿。团队列表继续使用稳定的即我号筛选，不能比较每次重新加密的 `teamRef`；单测和浏览器 fixture 覆盖返回时引用变化的情况。外部用户不会出现内部团队列表入口。失败仍使用原局部重试，撤权仍由 Team owner 判定。

插件和移动端均移除屏蔽/解除屏蔽的前端入口与空的更多菜单。没有引入功能开关，也不修改现有后端能力、协议、数据库或版本号。

验证：插件 9739 项单测通过、15 项跳过；Node 24.19.0 typecheck、build、pack 通过。新增测试覆盖回复甲 → 返回当前团队 → 打开乙 → 返回甲草稿仍在，以及管理员/成员侧没有屏蔽入口。Flutter 81 项团队测试和定向 analyze 通过，覆盖手机、平板宽度下的输入、表情收起和草稿保留。独立官方 DSH 0.1.5-rc.2（`fb2c4b9e`）使用临时 Profile 安装 tgz，真实 Chrome 验证设置、返回、草稿、媒体和回执；后端数据为隔离 fixture，不冒充测试服实测。用户的 3082、安卓 App 和主 checkout 未修改或重启。

本轮继续既有任务分支 `codex/c20260922-team-message-channel`（插件起点 `7381610a`、Flutter 起点 `043717f97a`）。检查时插件远端 dev 为 `bc33e583`，功能分支相对它 ahead 19 / behind 9；此次没有执行 rebase 或测试服合并。

## 范围

内置 UI 使用 Team App JWT 接口，共用 `TeamAppService` 的账号边界、权限、引用和失败语义。Team 与 Chat 为独立业务关系，Record 为同一个可修改正文。用户明确本次不开发开放平台、模型 Tools 或公共 SDK，因此这些消费面保持既有能力，不为本次 UI 增建入口。DSH 源码、根 README 与插件版本没有修改。

| 能力面 | 本次结果 |
| --- | --- |
| UI | 通用团队对话、团队管理/审批、发送者头像、回执、草稿/重试/冲突、编辑/删除、媒体与链接、个人会话首页设置 |
| Host owner | App 登录；账号绑定不透明引用；Team API 适配；同源实时授权媒体；未暴露内部身份/凭据 |
| Tools / SDK | 用户明确排除本次扩展；现有能力不变 |

用户从现有对话列表、团队页或“联系作者”进入。“联系作者”定位官方团队，和其他团队使用同一业务与呈现。外部用户不加入团队；内部成员可共同查看和回复。首次启用通道需 owner 核对成员；此后加入须审批。历史作者 ID 11 的私聊不迁移、不共享。

## 验证入口

普通验证：`pnpm test`、`pnpm typecheck`、`pnpm build`。端到端测试文件为 `tests/e2e/team-channel.e2e.mjs`，使用未修改目标 Harness 的正式 Web scaffold、官方安装的不可变 tgz、真实 Team/Record 进程及 Mongo replica-set/RabbitMQ。仅身份目录和不相关页面请求为本地 fixture，Chat/Subject/OpenAPI 不启动。

先在全新 DSH_HOME/Profile 通过官方 CLI 安装 tgz；使用支持 pnpm-workspace 配置的 package manager。通过官方 CLI 正常启动一次该 Profile（`--no-open`，空闲端口）建立官方 module fallback 后停止该测试进程。不得手建 symlink/源码 overlay 或复用用户 Profile。

执行前提供这些环境变量：

- `ARKME_DSH_CHECKOUT`：未修改的目标 DSH checkout。
- `ARKME_PACKED_PROFILE`：已通过官方 CLI 安装不可变 tgz 的 Profile。
- `ARKME_TEAM_E2E_ORIGIN`、`ARKME_RECORD_E2E_ORIGIN`：仅允许 127.0.0.1 的隔离服务。
- `ARKME_ACCOUNT_FIXTURE_PORT`：Team 配置引用的本地身份 fixture 空闲端口。
- `ARKME_TEAM_E2E_SIGNING_KEY`：仅与本地 Team/Record 配置一致的合成凭据，不用真实环境 secret。
- `ARKME_E2E_TLS_KEY`、`NODE_EXTRA_CA_CERTS`：临时 localhost TLS key/cert，不关闭证书校验。
- `ARKME_E2E_SCREENSHOT`：可选截图文件；仅包含测试账号和测试消息。

从目标 Harness 目录执行：

```sh
pnpm exec vitest run --config "$ARKME_PLUGIN_CHECKOUT/vitest.team-channel-e2e.config.mts"
```

测试会在本地服务创建/复用合成官方团队、审批合成成员、发送与编辑测试消息、移除合成成员，不能连接真实环境。当前验证的目标为官方 `0.1.5-rc.2`，真实 macOS Chrome；没有声称 Windows/Linux 原生环境已验收。

覆盖独立来访者隔离、幂等重试、审批防绕过、共享读取、实际 UI 回复和样式、相同 Record 修改、回执受众裁剪、撤权视图清空、切换账号和粘贴真实通道链接。完整跨仓证据与索引成本在同任务 meta change。


## 合并前审查修复

前轮审查修复覆盖：接受后的稳定请求恢复、取消终态解锁草稿、明确未接受的参数拒绝可修改草稿、所有 preparing 请求可取消、连续回复冲突再次回读、编辑冲突保留输入并显式读取/确认新版本、仅所有者显示屏蔽操作。未新增业务状态、配置、Tools 或公共 SDK。

扩展真实浏览器 E2E：在页面加载后由其他成员回复，再于确认期间插入第二条回复；两次均显示最新正文并等待显式确认。编辑时模拟另一设备先保存，确认保留本机草稿、读取最新版本后再保存。服务端 Record 的真实错误码也由该链路验证。

最终验证使用任务源码打包的不可变 tgz，经官方 CLI 安装；完整插件套件、类型检查、构建与真实 DSH E2E 结果记录在同任务 meta 的 pre-merge-review.md。IM 独立本地验收从同次 E2E 产生的真实 RabbitMQ 通知进入生产 HandleMessage/Hub/Gin HTTP SSE，未把它描述为已部署整套 IM 服务或系统级离线推送。

再次审查补充：同一来访者成为成员后，会话视图与草稿标识包含侧别；切换收件箱/咨询立即清空旧侧选择并废弃旧查询。真实浏览器先复现切换竞态，再经重新打包及官方安装通过：两侧草稿互不覆盖。还验证第二个来访者隔离、空会话不进入收件箱、旧链接重置失效、既有会话保留及暂停拒绝新发送。最新证据见同任务 meta 的 final-merge-review.md。

## 2026-09-23 页面布局与交互收口

团队仍是通用独立功能。官方团队和用户自己创建/加入的团队使用同一页面和权限逻辑；联系作者仅定位 `arkme_cn`，没有客服业务分支。Contacts 的团队标题旁使用已有 `ArkmeActionMenu` 加号菜单，继续打开原创建、加入或消息链接表单。

团队详情按资料 → 成员 → 对外消息设置自然排列并统一滚动，消除原两行 grid 把第三个子区域挤到页面底部的问题。所有区域使用相同内容宽度与边距。成员可复制消息链接；所有者才能控制开关、审批和重置。第一次开启及危险操作的既有确认语义保留。设置刷新期间保留当前团队成员页面，失败/账号切换仍按原授权链路清理。

新增纯 UI 验证 `tests/e2e/team-layout.e2e.mjs`：官方 DSH + 独立 Profile 中安装的不可变 tgz + 合成身份和 Team DTO。它验证实际页面布局、窄窗对齐、菜单 Escape/三种原表单、复制、开关和成员权限；不能替代上文真实 Team/Record E2E。变量沿用 `ARKME_DSH_CHECKOUT`、`ARKME_PACKED_PROFILE`、`ARKME_E2E_TLS_KEY`、`NODE_EXTRA_CA_CERTS`，另可用 `ARKME_E2E_CAPTURE_DIR` 保存截图。从 DSH checkout 执行：

```sh
pnpm exec vitest run --config "$ARKME_PLUGIN_CHECKOUT/vitest.team-layout-e2e.config.mts"
```

能力矩阵：UI 为本次覆盖面；Tools / SDK / Host owner 为 N/A（没有新增业务查询、命令、路由或持久化能力，继续调用既有 Team App owner）。不改变 README、版本、产品配置或 DSH 源码。Flutter 与插件联合验收及原截图问题映射见同任务 meta 的 `team-layout-fix-20260923.md`。

## 2026-09-24 消息与个人快记语义

团队消息复用现有会话布局、富文本/附件内容、输入控件、重新编辑上下文和菜单。发送者显示自己的头像，图片复用图库和独立预览窗口；Team 通过媒体授权接口注入资源，不制造 Chat 身份。菜单浮层不占消息行布局，选择后关闭，页头只提供当前真正可用的选项。

已发布消息仅允许作者“删除”，调用 Record 全局删除/最近删除恢复；未发布请求仍可取消并保留草稿。新 UI Host 私有协议使用 delete/cancel/home.visibility，移除未发布的 withdraw，不扩展 Tools/公共 SDK。团队生成的 Record 仍参与作者自己的搜索、日历、统计等业务；首页开关按当前账号、当前团队会话生效，不扩散到其他成员或会话。

最新代码链路、测试结果、结构成本与未覆盖环境见同任务 meta 的 `message-record-parity-review-20260924.md`。本轮由用户负责测试分支合并和重启，没有执行部署。

## 2026-09-28 会话交互复用修复

本轮按已确认的体验问题修复客户端实现，Team 权限、会话关系、幂等发送和 Record owner 不变。没有新增 Host API、Tools、SDK、配置或数据库结构，也没有接入原生 PC。UI 为本轮消费面；其他能力面 N/A：继续使用已有 Team App owner，不新增业务能力。

| 已确认问题 | 实现与验证 |
| --- | --- |
| 发送成功后等待列表回读，回读失败时看不到成功消息；发送期间无法写下一条 | Flutter 使用现有 `SendDraftOptimisticSubmitCoordinator`；插件从普通会话提取 `ConfirmedSendRetentionOwner`。发送立即呈现本地待确认内容，回执先落列表，再进行授权回读；原请求与下一条草稿分离。断网、重复提交、重进页面、取消、冲突及回读失败有回归。 |
| 相同头像按消息行重复读取 | Team 使用现有 `ArkmeUserAvatar`、`useArkmeAvatarImage` 和 `InMemoryArkmeAvatarImageStore`，只注入 Team 图片读取 port；显示标识与可轮换授权引用分离。20 个并发引用合并为 1 次读取，换账号清空旧缓存。 |
| 移动端查阅弹层另做一套，且等待网络后才显示 | 群聊与 Team 共用 `JotmoMobileReadReceiptList`、成员行和 touch-move sheet；数据 owner 保持独立。弹层立即显示，支持原位重试；关闭后立刻重开时，过期结果不能覆盖当前请求。外部用户仍只看到不可点击的未读点，已读后消失。 |
| 移动端首屏失败无法恢复 | 复用会话状态展示，提供页内重试；恢复后沿用原输入组件。没有加入常驻加载条。 |
| 点击附件先等待原图再打开，发送预览资源重复维护 | 移动端立即打开现有媒体预览，由预览组件解析 Team 媒体；插件上传预览沿用附件 tile 和消息内容组件。上传临时 URL 在取消附件、授权资源接管或卸载时释放。 |

验证结果：插件完整套件 8,923 通过、15 跳过；末轮发送回归 19 通过，头像/附件相关 50 通过。打包构建和类型生成通过。Flutter Team 套件 74 通过，独立自适应指标/窗口策略 29 通过，原群聊查阅回归 19 通过；修改文件 analyze 无问题。Flutter 窄屏/宽屏、表情与收起、查阅弹层截图已检查。

最终运行包 SHA-256：`84574f6844162a7dd1880863036a0ff9f6d2b90fecede5ab29d4124def5e6083`。经官方 CLI 安装到全新隔离 DSH_HOME/Profile，使用未修改的 DSH 0.1.5-rc.2 和真实 Chrome 运行 `team-layout.e2e.mjs` 通过。签名更新 6 轮，发送前后头像读取均为 2 次，70 次画面采样未发现原头像闪动；原头像/图片 DOM、图片读取次数、输入节点与位置保持稳定。覆盖阅读点/共享浮层、内联重新编辑、同页及独立窗口图片预览、窄窗/暗色布局。

本轮浏览器用合成 Team/身份响应，不能等同于真实测试服与 Vivo 新包的设备验收。用户当前实例、测试分支和测试服部署未重启或修改；更新后的 Vivo 安装验收由用户更新客户端后进行。配套移动端提交为 `759cc50765`，两个仓库均使用 `codex/c20260922-team-message-channel`。


## 2026-10-08 移除独立消息的回复确认

其他成员回复不影响自己发送新消息。Team SendQueue 不再调用 send.confirm，也不要求读完新回复后继续发送。历史 reply_conflict 任务仍沿原 client UID、冻结正文和附件检查点恢复；取消意图只继续取消，权限拒绝和幂等内容不一致仍停止。旧服务持续返回该原因时按现有退避重试，需要 Team 服务包含 d2ccd02 的独立消息追加语义，不能通过更改原请求或新建 UID 绕过。编辑同一条 Record 的版本保护保留。

本次沿用 TeamSendQueue/FileTransfers 的账号隔离与持久化，没有增加存储 owner、DSH 扩展点、配置或插件版本。能力面：UI 删除确认交互；Host 在原内部队列恢复历史状态；Tools/SDK 不增加新能力（该次改动为现有 App 发送逻辑收口，不新增公开命令或授权范围）。类型检查与完整插件测试通过（10,221 通过、15 跳过），旧任务、旧服务持续返回、无 operation 返回、取消恢复、下一条草稿及编辑版本保护均有回归。打包运行验收详见同任务 meta 的 reply-confirmation-removal-20261008.md。
