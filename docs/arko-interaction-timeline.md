# Arko 统一互动时间线

Arko 直接聊天与其他来源的 AI 结果按实际完成时间混排。外部互动复用既有灰色单行，显示来源、摘要及跳转入口。重试更新同一结果，评论续答具有独立身份。Record、Chat 及结果 owner 分别裁决当前访问权限；读取不触发生成或计费。

## 能力矩阵

| 能力 | UI | Host | Tool | SDK |
| --- | --- | --- | --- | --- |
| 分页查询互动 | Arko 时间线 | arko.interactions | arkme_arko_interactions | arkoInteractions |
| 精确结果定位 | 既有详情及建议弹窗 | arko.interaction.open | arkme_arko_interaction_open | arkoInteractionOpen |
| 展示缓存 | 恢复窗口和位置 | arko.timeline.cache | arkme_arko_timeline_cache | arkoTimelineCache |

三种适配器共享 ArkoTimelineService。公开 SDK 沿用 feature discovery、AbortSignal 和既有 dispose 契约；dispose 取消托管导出与存储观察，普通单次读取由调用方的 signal 控制。Tool 读取缓存无需写入确认；保存缓存复用正式 Tool 的用户确认机制。

## 缓存与权限

用户确认的行为是“保留窗口和位置，摘要复核后显示”。进入页面、重新获得焦点、可见性变化、断网/重新联网及源 invalidation 均清除本次验证状态并复核已有引用。未复核行显示等高占位，不向 DOM 或无障碍标签输出缓存来源名称和摘要。确认拒绝后移除；网络故障清除本次验证状态，保留占位和重试入口；重新联网后再次复核。请求代次和账号边界阻止迟到响应恢复已撤销内容。已打开的建议弹窗也绑定本次结果引用，证明失效或结果替换即关闭，不自动恢复旧正文。

展示缓存按环境和账号隔离，schema 为 2，旧展示副本可丢弃。缓存独立于待发送恢复及回执数据；采用私有文件权限、原子写入、完整磁盘封装的 8 MiB 上限（超限写入保留上一可读副本），最多持久化 2,000 条聊天及 400 条互动。仅对已确认消息与页面变化节流保存，输入和流式 token 不触发持久化。授权状态仅存在页面内，不持久化。

引用加密携带结果身份与观察到的 revision。knownRefs 在 revision 不变时只取当前权限证明；变化时重新获取摘要。revision 本身不是授权凭证。重新进入或权限失效后，对保留窗口按最早完成时间重读；窗口下界沿用实际物理扫描位置 oldestScannedAtMillis，独立于当前可见行，避免最早行撤权或窗口全空后丢失历史范围。该分页位置持久化为 interactionStartMillis，缓存截断时随保留范围重新计算；observedRefs 最多 400 个，仅避免重复传输未变化正文，不作为查询选择器。knownRefs 仍是最多 100 个指定条目的独立复核。由此窗口内重新获得权限的旧结果可以补回，而不触发生成。源 owner 临时失败使整页失败，不推进游标或冒充删除；普通直接聊天仍使用自己的读取链路。

## 导航与结果语义

只有 chat scene 5 使用既有建议弹窗，填入原会话草稿，由用户决定发送。scene 1 主动回答、群公开/私密回答及个人两业务槽位进入既有原文详情。details 刚授权的精确结果通过页面内 jump 传给 RecordThoughtContent，以账号、来源、record owner、根 UID 和 thought ID 精确定位；续答通过 replyId 定位。历史只读结果没有 replyTargetRef，不能当作当前可写槽位。既有详情父组件共享本次选中的授权结果与计数，正文异步重挂载不会因导航请求已消费而丢失该结果；关闭详情即随其生命周期释放。

Target.occurredAtMillis 始终表示结果完成时间；可选 sourceAtMillis 为 owner 确认的源时间，导航优先使用它。thought 表示选中的结果，suggestion=true 才表示建议弹窗。来源 UID、owner、详情组件和草稿交互沿用原实现。原文 owner 沿用现有 RecordOwnerId：Bot 的 int64 别名超出 JavaScript 安全整数范围时保持十进制字符串，不能当作当前账号 ID 或强转 Number。

## 后端与数据准备

Intelligent 提供 POST /api/v1/arko/interactions/query 及 /api/v1/arko/interactions/details。每页最多 20 条物理候选，按完成时间和稳定身份排序；拒绝访问的空页仍返回物理游标。先批量授权元数据，再按观察到的 revision 批量读正文；并发替换返回可重试错误。普通聊天想法读取不增加 Agent SQL 依赖。

chatthought 在 cb/cv/db/dv 中仅保留一份成功正文；fa/frv/fgen 保存完成时间、源版本及代次，iu 仅作索引归属。新代开始或失败保留上一成功结果，当前 Content/Display/ReplyTarget 仍要求 ready。撤销已完成代或源失效会清除该结果。已经清除且未保留的历史正文无法凭空恢复。

不新增集合或 SQL 表。Mongo 三个索引服务于个人结果、聊天结果、续答的账号/完成时间读取；SQL migration 28 仅为 Agent 增加账号/场景/状态/完成时间索引。Mongo 索引由 Intelligent 初始化自动补齐并复用等价键；SQL 28 延续既有版本迁移链路。CMD 仅迁移历史数据，默认 dry-run、单批最多 100 条、使用 checkpoint/CAS；普通请求不执行 DDL、不双读旧字段、不增加开关或轮询 worker。

发布按后端实现文档完成 owner 依赖及必要历史迁移。启动异步初始化 Mongo 索引并校验既有 SQL 迁移就绪；失败只使新互动接口暂不可用，普通 HTTP 不受该初始化阻塞。回退保留已有结果及新增索引，不自动执行 down/drop。本任务开发不代表测试服或生产发布。

## 验证边界

覆盖完成排序、同毫秒分页、空权限页、源编辑/删除/退群、自动能力、代次竞争、已加载缓存复核、迟到响应、账号切换及精确导航。后端使用隔离 Mongo/MySQL 和独立 Record/Chat 测试进程；页面另有 opt-in 连续链路验收，实际生产组件经 Host dispatch、JWT/Gin、Mongo/MySQL 和独立 Record/Chat owner；身份与历史结果使用隔离夹具，普通直接聊天元数据使用合成传输。不可变 tgz 在未修改的官方 DSH 独立 Profile 中验收 Tools，并通过仓外公开 SDK Consumer。实际账号全产品与其他操作系统运行情况须分别记录，不能用本地组件证据替代。
