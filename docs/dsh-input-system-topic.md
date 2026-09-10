# DSH 输入系统主题

## 类型与体验

topic.kind=3 表示 DSH 输入系统主题；kind=2 是原内部 Agent 容器，继续隐藏。record.creation_source=3 是记录的生产来源，不决定主题能力；主题类型不依据标题或 UID 推断，同名普通主题不受限制。

DSH 主题沿既有主题目录、详情和记录读取链路展示，带系统标识，不提供直接输入、改名、隐私、层级、磁铁、置顶或位置等被禁止的主题操作。插件普通主题尚无首页设置 UI，因此系统主题底部也只显示归档说明，不提供专用开关或读取设置。服务端领域 owner 同时校验，不能通过绕过 UI 修改受保护属性。记录本身的正常编辑、删除和移出不等同于修改主题，不扩大禁止范围。

新主题默认 show_in_home=false；重复归档复用稳定容器身份，保留用户开关。存量值不迁移，历史记录不清理，用户可以自行关闭首页展示。首页复用 home/feed；默认分类仍是 uncategorized，两者不是同一个列表。

## 归档边界

本次不改变归档算法：继续消费 DSH 的 user/message、source.kind=user 事件，提取文本，按会话与事件序号生成记录标识，沿原有写入与重试链路归档。插件仍只归档文本，没有新增文件或多模态能力；Record 请求沿用既有字段合同。

事件来源不等于人工提交证明，程序产生的 user 消息仍可能被收录。严格人工归因不属于本次交付，不通过文本判断、浏览器手势监听、时间窗口匹配或第二套来源状态机近似实现。插件不要求 DSH 本体修改，不依赖专用人工提交接口，不会因缺少该接口而关闭原有归档。

## 首页策略能力

| 消费面 | 入口 | 权限与失败边界 |
| --- | --- | --- |
| UI | N/A：普通主题没有对应设置入口，系统主题同样不提供 | 纯只读说明，无设置请求；已有策略不重置，仍可在即我移动端设置 |
| SDK | topicHomeVisibility(sourceRef, showInHome?, signal?) | features.topicHomeVisibility 探测；账号作用域的不透明引用 |
| Tools | arkme_topic_home_visibility | 读取不确认；设置沿现有 explicit-user-write 确认机制 |
| Host | topic.home-visibility → SourceService | 仅提交 show_in_home，不附带名称、隐私等字段；Record owner 最终校验 |

Tools/SDK 共用既有首页策略 owner；UI 入口移除不删除通用接口或改变持久化语义。测试入口见 tests/e2e/README.md；不可变包在未修改的官方 DSH 中验证，身份服务 fixture 与真实生产登录验收分开报告。
