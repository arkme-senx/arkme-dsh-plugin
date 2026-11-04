# 团队群与客户群来源接入

本任务沿用已有团队加入面板、团队第二栏目录、群消息及输入框。个人代表团队发言、团队正式入群和内部名单群分别保留各自的业务合同。Host 只适配不透明引用与投影，当前资格、历史范围、幂等回执均由后端 owner 判定。

## 能力矩阵（实施前建立，随验证更新）

| 能力 | UI | Tools | SDK | 共用 Host owner |
| --- | --- | --- | --- | --- |
| 团队入群、结果恢复、审批与退出 | 既有 TeamGroupJoinPanel、群成员管理；接真实回执与当前资格 | 受现有业务 grant 管理的团队群查询/命令工具；显式 requestUid 和动作 | 公开团队群输入/输出类型与能力探测、账号范围和 AbortSignal | TeamAppService 的团队群操作 |
| 团队工作区群入口 | 既有团队第二栏目录；服务端混排，来源缺口明确展示 | 团队工作区分页工具 | 公开 workspace 分页合同 | TeamAppService 的 workspace 操作 |
| 客户来源群卡片 | 既有客户消息视图中的来源卡片；打开原群，回复默认原群；显式私信保持原准入 | 来源卡片/来源消息读取及原群回复，最小不透明引用 | 公开来源卡片与来源消息合同，复用群消息能力 | TeamAppService 来源操作 + ChatService 群消息 |
| 代理群读写与附件 | 既有群消息/输入/媒体组件，固定团队身份 | 复用正式 Chat tools，sourceRef 显式携带访问范围 | 复用 Chat SDK，按调用传递范围，dispose 不留全局身份 | SourceService 账号/环境加密引用 + ChatService |

浏览器、模型及 SDK 不接收后端签名 access_ref、上游 Token 或内部定位字段。sourceRef 内的代理子引用用现有 EncryptedReferenceCodec 封装；每次真正访问由后端复核，不用本地正向权限缓存。消息 key 仍为原群/原关系；展示、草稿、订阅和发送恢复按访问身份及代次隔离。

验收证据待实现后填写：owner/Client 合同测试、仓外 SDK consumer、未修改官方 DSH 的真实工具发现调用、不可变 tgz 的隔离安装与实际页面场景。未验证项不计完成。


## 已实现的接口边界与当前验证

- 发布中的统一时间线 v1/v2 仍保留原来源集合；代理工作区 Host 使用 v3，增加团队成员系统通知，游标版本不可互换。浏览器继续使用现有统一消息展示模型。
- TeamGroupJoinPanel 将本次申请的 requestUid/expectedRevision 按账号、原群访问范围和稳定 Team key 保存在本机；关闭重开或引用轮换可核对、重试同一申请。写入本机失败时不发送。它不是授权事实，后端永久回执和当前资格分别判断；not_found 不导致偷偷生成新申请。
- 团队群、来源客户的偏好复用 TeamEntryPreferenceService；无 scope 的原 Tool/SDK 仍用 v1，工作区使用 scope:workspace/v2。群有独立稳定目标，来源序号不会冒用私信 seq。所有消费者复用同一后端 owner。
- @团队在原自动补全和草稿中携带独立 teamMentionRef，绑定账号、环境、群访问范围及目标团队入群代次。发送前从当前参与团队复核；不把 Bot、真人、代表身份 TeamRef 当作提及凭证。历史 Record 重新编辑保留原类型和 UTF16 区间；新身份仍经当前校验。
- 附件的 group source 引用走已有媒体门户和 Record source stream，Range/HEAD、批准版本、精确 occurrence 与附件绑定持续验证；无 source attachment ref 时不回退裸 URL。

定向插件回归已通过 114 项；另外申请关闭重开、引用轮换、not_found 后同请求恢复与提及共 21 项通过。Team owner 真实 Mongo 当前 254 项通过，工作区/偏好定向 16 项通过；Chat 目录新 lookup 的真实 Explain 命中既有唯一群序号索引。最终完整验收、真实隔离 tgz/DSH 页面、仓外 Consumer 尚未完成，不能视为可交付。
