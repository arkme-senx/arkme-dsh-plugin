# 团队与普通会话的转发目标统一

## 问题与结果

桌面插件中，团队消息转发把团队目标追加在普通会话后；普通会话转发则完全没有团队目录。现在两种入口共用 `UnifiedForwardDialog` 和同一份目录投影，复用第二栏的普通会话、群互动缓存、草稿活动时间、团队分组和置顶偏好。外部团队直接选择，我方团队展开后选择具体对话；搜索可以命中团队及访客。明确移除的入口不显示，旧缓存缺少可见性元数据时保留可用目标。

两种入口共同保留最多 5 个对象、多选、附言、本人主题、分页和失败反馈。附言、来源选择、身份与各目标请求 ID 在首次提交后冻结；已确认目标使用原回执，未确认目标使用原命令重试。权限查询结束时再次核对目标是否仍存在。部分失败时保留弹窗，取消失败对象后重试也不会重复投递成功对象。

范围是桌面插件中的普通私聊/群聊/个人快记与团队消息转发。Flutter 客户端、DSH/Codex 本机文本和录音原文等独立来源适配器未纳入本次修改。

## 版本与职责

| 仓库 | 开发基线 | 本次分支/提交 |
| --- | --- | --- |
| arkme-dsh-plugin | origin/dev `bded75094a64149df348e6b3461830dc9fe7ab37` | `codex/ts1104-06-统一团队转发目录` |
| jotmo-team | origin/develop `55d8d32` | `codex/ts1104-07-团队转发普通消息来源` / `01605fe5e0ab3b7751b923fc9c59ca4d62a949d3` |
| jotmo-record | origin/develop `d4780229f7ef6687b14bf8c0d8446656aaf46b13` | `codex/ts1104-08-团队转发普通来源快照` / `62ef577b8ccb2065a533e61b1d46052199fc0ab1` |

插件现有 `source.forward-messages` 增加与 `targetSourceRef` 互斥的 `targetConversationRef`。Host 校验账号、来源签名和目标引用，只提交 Record/Chat 原始选择器，不从预览拼装正文。

Team 现有 `/api/v1/team/conversations/messages/forward` 增加与 `sources` 互斥的 `record_sources`，每批 1–100 个目标来源，拒绝重复 occurrence、混合来源数组和伪造的个人 owner。旧团队消息的指纹格式保持原样。Team 沿既有权限、接受事务、冻结密文、回执与恢复流程写目标消息。

Record 的既有内部 `forward/prepare` 接收 `record_sources`，复用普通来源转发的当前权限、正文、媒体和独立副本逻辑。它只准备内容，不创建临时个人快记，不把 Team/Chat 主事实写进客户端，也不允许客户端直接注入转发 payload。普通消息的读取权限仍由 Record/Chat owner 决定。

## 验证

- 插件：最终 12 个测试文件、518 个场景全部通过；类型检查、完整构建、服务架构检查，以及侧栏、共享弹窗、搜索、排序、附言、签名引用、账号切换、拒收、缓存、目录刷新、异步目标移除和稳定重试回归。
- Team：完整 `internal/teammessaging`、`pkg/recordclient` 的竞态检测；最终修改后重新运行普通来源、旧团队来源、真实 Mongo 并发重试与跨团队转发目标用例。新增真实 Mongo 用例以 8 个并发请求验证同一命令只产生一条 occurrence。
- Record：在真实隔离 Mongo 副本集上运行 `TestTeamRecordForward`、`TestTeamForward`、`TestArticleForward`、`TestRecordSourceForward`，并以 `-race` 复跑；根包 Completion 架构边界和 API route contract 检查通过。
- 隔离依赖：自行启动的 `mongodb://127.0.0.1:27449/?replicaSet=forward1104`；各测试生成独立数据库并清理，不使用生产数据库。聊天权限传输测试使用本机隔离 HTTP，覆盖拒绝读取的失败路径。
- 本次没有部署、发布、生产写入或向真实联系人发送消息。完整多服务发布链路和线上滚动升级未实测。
- 真实账号点击验收尚未完成：连接已安装的即我客户端/浏览器时，Computer Use 初始化及 CUA 会话均超时。自动化与隔离回归不代表已安装客户端或生产环境验收通过。

## 上线及回退

先部署 Record，再部署 Team，最后发布插件；先在测试环境验证普通私聊 → 外部团队、普通私聊 → 我方团队具体会话、团队 → 普通会话、团队 → 团队，并用真实账号实际点击核对目标顺序和接收结果。

新客户端遇到旧后端会被拒绝，不应降级为拼装正文或另发一条消息。发布前需让 Record 与 Team 的新来源合同均可用。旧客户端的 `sources` 合同和已有请求 ID 继续有效；没有新增存储结构或数据迁移。

回退先回退插件，核对已接受但尚未确认的新协议请求后再考虑后端回退。旧 Team 后端无法解释新 `record_sources` 请求，过早回退会让这些请求暂时无法重试；保留原请求身份及既有冻结消息，不删除记录或重新生成目标 ID。
