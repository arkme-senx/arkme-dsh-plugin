# 长文共享、转发与人物内容

## 能力与 owner

| 消费面 | 入口 | 共同 owner / 生命周期 |
| --- | --- | --- |
| UI | 现有长文库三分类、人物侧栏及仅当前会话 | SearchService / ChatService；关闭和切账号取消请求 |
| SDK | `listArticles`、`personRecordsPage`、既有消息转发 | `articleLibraryV1` / `personRecordsV1` 探测；支持 AbortSignal，不建立后台订阅 |
| DSH Tool | `arkme_articles_list`、`arkme_person_records`、既有转发 Tool | business/hybrid，read Tool 无写 grant；转发沿用明确用户写入 grant |
| Host | `articles.list` / `search.scene`、`source.person-records.page` | 同一服务适配器，不另持共享或消息权限 |
| Client/Harness | 既有插件装配 | 不新增原生桥、进程、端口或安装协议；生产制品和真实桌面验收另行记录 |

## L02

Record 的 `content_payload.forward_records.items[].display_kind` 是可选独立显示事实，不能改 template_kind 伪造。普通转发保持原 create 合同，不附加新字段。长文向自己、默认分类、主题转发时，先读取 `/api/v1/records/forward/capability` 的版本 1、nested_display_kind 和 article_snapshot 回执，再调用 `/api/v1/records/article-forward/create` 或主题同名路径。

新写入仅传 source selector（record UID、精确 owner、可选 chat session + relation），服务端重新核验权限、读取完整 Markdown 和媒体库存。客户端摘要不作为副本正文。目标 Record UID 是幂等身份，未知结果必须使用同一 UID 重试；服务端已接受的副本不再依赖原文权限。缺少能力时拒绝该长文写入并提示升级，普通转发继续。

## L01

`articleScope` 使用 recent/shared_by_me/shared_with_me；共享分类必须收到匹配的 `applied_article_scope`，不会将旧服务忽略字段的结果伪装成成功。当前支持形式是 `chat_original`：有效私聊/群聊中的原文发送关系。个人主题归属、仅复制链接和独立只读转发副本不证明原文共享。

服务端按 owner+record UID 去重并返回相关有效共享数量/最新活动；方向按关系发送者判断。每个共享结果生成当前账号和自身 Chat 来源绑定的 messageActionRef，详情/媒体/转发继续走当前来源权限。共享分类不把当前用户 UID-only 隐私缓存套给其他 owner 的同名记录。

## P01

新云端 `/api/v1/chats/members/records/aggregate` 使用全局 cursor，不混用不同来源 before_seq。按 attach_at、chat_session_uid、rel_uid 倒序；事件是会话+relation。重复互动投影不会进入该查询，真实跨会话重发保留。返回各消息自己的来源和操作引用，正文先出，不等待精确总数和头像。

新接口 404/501 时，UI 保留原最多两路并发的会话发现+逐源分页组合；临时失败不会改成不支持。`supported` 仅表示聚合协议可用；coverage=current_chat_relations 不表示全历史归档完整。UI 沿全局cursor继续读取，不以500条作为历史终点；普通续页携带最近加载的至多500个事件引用，引用JSON同时限64KiB，为Host默认128KiB请求留余量；失效事件触发已加载全部引用按500条/64KiB一批串行复核，明确撤权移除，暂时失败保留并重试，无后台轮询。

## 验证口径

测试分别记录类型/单元/官方 DSH SessionStore+ToolRuntime 调用、仓外 SDK Consumer、不可变包安装、隔离 Mongo、真实本地 HTTP 联调、真实桌面及部署。前几项不能替代真实账号双端业务验收；同工作负载测量未覆盖的网络和 Browser 渲染阶段不作性能承诺。
### 长文窗口与列表失效复核（2026-10-27）

列表保留用户已加载的分页窗口，来源提示只复查包含该来源的页；账号范围的内容/权限提示复查已加载页并原位更新，不将结果重置为第一页。复查串行，与正常分页互斥；100ms内提示合并，排队集合不超过已加载来源/页的范围，隐藏分类仅标记待复核，关闭/切换取消请求和定时器。失败保留已加载内容并重试同一复查，明确失权以服务端新结果移除；页数不是授权缓存，不以缺席其他页的结果推断删除。滚动锚点随原位替换恢复。

独立长文/长文库 renderer 使用现有 `/arkme-self/api/events` WebSocket，仅将 timeline-changed、record projection、chat policy 与重连/reconcile 转为内容/权限提示。不装载主窗口的未读、目录、通知或消息准备副作用；每个账号绑定窗口一个连接，失效或销毁关闭，账号切换后的旧回调丢弃。原文详情沿现有来源授权重读，明确失权清正文/媒体并关闭；独立转发快照不借此取得原文权限。

能力面：本次为 UI 状态、既有事件及既有查询消费修复，Host 查询、后端合同和原生桥均无新增。Tools/SDK 无新增业务能力，沿既有 articles.list/person-records 合同；客户端源码不改，使用现有独立窗口桥。去掉额外“正在打开长文…”文字，保留重复点击保护；布局/CSS、每页20条及触底加载保持不变。
