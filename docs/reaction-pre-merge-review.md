# 表态合并前两轮审查

目标分支：官方 dev `9e2d2142`。当前任务已合入该基线的聊天输入/消息渲染优化，保留 `renderedMessageRows` 缓存及原回到底部逻辑。审查范围为本分支完整差异，以及已部署的 Record 表态 owner、Chat 可读性合同和既有 World 权限适配。无生产部署，无数据库清理、回填或格式迁移。

## 第一轮：实现、owner 和数据边界

确认并修复：

1. 表态参与者名为“我”时，原展示逻辑只用字符串判断自己的占位身份，可能替换别人的资料。修复为必须匹配当前用户 ID，姓名不再充当身份标识。正常服务端姓名不被旧本机资料覆盖。
2. 会话累计挂载超过 200 条消息时，原订阅按挂载顺序占满读取容量。修复为只为可见区域及邻近区域订阅；离开区域释放订阅但保留有界缓存。显式跳转提前准备目标，避免在屏外等不到读取。没有放大批次、并发和缓存上限。
3. 短语读取和保存并发时，旧读响应可能覆盖已确认的新版本。保留最大已确认 revision，沿用原 owner 和 CAS，不新增第二份持久状态。
4. 旧目录测试按 button 取会话行/检查 disabled，和允许独立橙色入口的 treeitem 结构不一致。测试改为语义选择器及 aria-disabled，继续验证置顶、移除、普通点击和预览互不干扰。

## 第二轮：业务场景逐项映射

| 场景 | 实现链路 | 验证证据 |
| --- | --- | --- |
| 私聊、群聊、发给自己添加/取消 | Sidebar → PreviewStore → Host ReactionService → Record Set | reaction-preview-store、reaction-host-sdk-tools；Record service/mutation tests |
| 同一记录不同会话的表态隔离 | 签名 source/action ref → Chat reactionTarget → Target(chat, relation) | Host target contract；Record Target/Access/Query tests；不把记录内容和消息归属混用 |
| 世界不显示表态入口 | Sidebar 挂接消息能力；World 页面无新增表态组件 | 完整 diff 核对；遗留的通用 World 权限适配不是新页面入口 |
| 同词不同颜色、组合手势 | expressionIdentity 与后端 Expression.Key | reaction-phrases、reaction-label-content、reaction-preview-ui |
| 同词同色保存/保存并表态 | Phrases.create 显式重复分支；不把使用已存短语变成编辑 | reaction-preview-ui |
| 删除确认、失败恢复和空库 | LibraryStore + Phrases.remove；revision 0 才使用默认库 | reaction-phrases、reaction-preview-ui；Library CAS tests |
| 拖动顺序、取消拖动 | useReactionPhraseDrag 固定槽位；Library CAS | reaction-phrase-drag、phrase-layout-motion |
| 首次加载/连续挂载/查询中加入 | PreviewStore prepare/watch/refreshAgain | reaction-preview-store |
| 切换会话不清空已确认表态 | 有界 inactive snapshots；更新签名 ref | reaction-preview-store |
| 长会话超过 200 条 | watchVisibleReactionTarget；显式跳转 prepare | reaction-visible-target；conversation-send-directory |
| 发送普通消息不重载全部表态 | 稳定 target.id 订阅；最新 dev 消息行缓存 | conversation-send-directory 的发送、输入和 40/400/1000 消息测试 |
| 断网、重复点击、不确定写重试 | 显式 active、同 request_id、revision 冲突 | PreviewStore tests；Record mutation/idempotency tests |
| 切号/切环境时旧请求返回 | AbortController + accountKey 二次检查 | reaction-preview-store、reaction-host-sdk-tools、reaction-history-loading |
| 名称、备注、群昵称、名片 | Chat 成员备注与 profile 分开投影；ID 判断身份 | reaction-group-nickname、reaction-actor-card、reaction-preview-ui |
| 只提醒别人对自己的消息表态 | Record RecipientID/ActorID 和当前可读性过滤 | Record notifications tests；reaction-notifications |
| 多人同条、多条消息、后来追加 | 消息聚合预览；逐 actor 精确 revision | reaction-notifications、reaction-notice-presentation |
| 停留消息页面仍保留提醒 | beginViewing 只由橙色点击触发 | reaction-visible-notification、reaction-notifications |
| 点击头像/会话名不消除橙色提醒 | 独立预览按钮；普通目录导航保留 | chat-preview-navigation、reaction-notice-presentation |
| 一次点击跳转当前/缓存/隐藏会话 | conversationTarget revision、viewport restore 让位 | conversation-send-directory |
| 消息整体灰色及新表态/新参与者灰色 | 独立 message backdrop 与 reaction highlights | reaction-preview-ui、reaction-locate-layout |
| 跳转滚动和失焦不消耗提示时间 | afterMessageVisible/visible reaction observer | reaction-locate-layout、reaction-visible-notification |
| 原来的回到底部/动效 | 未修改 ArkmeConversationBottomControl | diff 核对；相关现有会话测试 |
| 我的一天只展示自己的操作事实 | Record.History actor filter → useReactionHistory | Record privacy/history tests；reaction-day-timeline |
| 头像、原发送者、同日时间、沿用布局 | HistoryContext → 原有 DayTimeline 组件 | reaction-history-avatar、reaction-day-timeline、personal-day-calendar |
| 已取消表情删除线 | ReactionAction 包括图片的删除线样式 | reaction-day-timeline |
| 原始来源定位、单个表态颜色区分 | openReactionHistory → 相同定位入口与 expressionIdentity | reaction-day-timeline、reaction-preview-ui |
| 已取消表态仍定位原消息 | 原消息独立高亮，不依赖表态组存在 | reaction-locate-layout；conversation-send-directory current/other |
| 权限消失、隐私锁、旧名单 | 后端读前/后权限与 policy；UI 无权限清数据 | Record privacy/access tests；reaction-host-sdk-tools、reaction-preview-ui |
| 会话移除时橙色入口/双击 | 第二轮发现并修复：子入口同步 disabled，双击检查移除状态 | reaction-notice-presentation、chat-directory-pin-ui |
| Tools/SDK 不绕过业务权限 | 同一 Host owner；read/write Tools 分离、显式写授权 | reaction-host-sdk-tools、tools registrar/catalog |

## 架构判断和剩余验证边界

持久化仍由 Record 单一 owner 持有；短语与隐私设置分开 CAS，表态写入与幂等回执共事务。UI 的拖动、灰色提示、请求取消仅为有限生命周期状态，不引入第二套业务状态机或迁移兼容层。没有系统提示词修改。

已完成的自动检查和用户此前逐项复测不能证明所有环境下绝无问题。尚未进行本轮新制品的 macOS 实机验收，也未把 SDK/Tool 合同测试称为桌面真实模型会话验收。完整仓库 Windows 测试的基线对照及最终构建结果在 PR 中列出。

## 最终自动验证

- 相关 26 个测试文件首轮 617 项通过；随后补充移除会话期间禁用提醒的回归测试，全量运行中这 26 个文件的 618 项全部通过。
- TypeScript 类型检查、声明生成、插件构建、可执行入口校验、tgz 打包通过。Chat 与 Record 的表态相关后端测试通过；本 PR 不包含后端代码。
- 不可变 tgz 经官方 DSH CLI 安装到全新 Profile；包清单检查未发现本机路径或临时目录。三个专用 Windows 测试客户端均加载最终 client revision `b942ada54c06`，Host 确认三个原测试账号仍在 test 环境且已登录。此项证明安装、启动和账号保持，不代替新制品完整交互验收。
- 当前分支全量：8896 通过、156 失败、13 跳过；官方 dev 9e2d2142 同环境基线：8768 通过、157 失败、13 跳过。155 项失败相同，不能认定全仓绿色。
- 当前额外失败为未修改的连接诊断异步持久化测试；该实现及测试相对 dev 无差异，单独复测该文件 17 项全部通过。保留全量失败记录，不以复测替换原结果，也不将其宣称为已修复。
- 缺少正式 DSH 模型会话对新增 Tools 的真实发现/调用验证，因此合并请求保持草稿，不能将合同测试等同为完整交付验收。
