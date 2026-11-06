# 原消息评论与局部引用汇总

私聊/群聊的评论角标使用 Chat 当前用户可见的完整直接评论数。局部引用下划线使用当前 `available` 引用的完整去重锚点；同一片段被引用 125 次时，引用数是 125，绘制锚点可以只有一个。历史 `edited` 引用继续由原评论详情展示，不画在新正文上。嵌套评论归真实直接父消息。

Host `sourceMessageExtensionSummaries(sourceRef, actionRefs, signal)` 只接收原读取返回的签名引用，一次最多 40 个；它解签并核对同一聊天的确切出现位置，调用 Chat 新增独立批读。不会从已加载回复或详情第一页推导完整结果。`accessible=false` 表示当前不可访问，`complete=false` 表示未知，均不展示旧数量/锚点；成功的零或减少会替换旧结果。

读取复用来源绑定的 Chat 请求入口，携带选定来源的代理访问凭证；权限拒绝不会回退为个人身份查询，也不会复用个人身份的结果。

| 消费面 | 入口与语义 | 验收 |
| --- | --- | --- |
| UI | 原评论角标、原下划线和原详情/分页；可见消息批读，失败可重试 | owner/store/UI 合同及隔离浏览器场景 |
| Tools | `arkme_message_comments_summary`，business/hybrid 只读；签名 source/message ref | 官方未修改 DSH 临时 Profile 的真实会话发现、未登录拒绝与合成 reader 调用 |
| SDK | `sourceMessageExtensionSummaries`，公开类型 `ArkmeMessageExtensionSummaryItem` | 仓外 Consumer 从不可变包编译和调用；`messageExtensionSummariesV1` 探测与旧 Provider 明确失败 |
| Host | ChatService 单一授权与读取 owner，ArkmeService 委托 | 签名来源/出现位置测试、跨聊天拒绝；后端真实 Mongo 与权限/故障验证 |

`chat_extensions` 是无正文失效提示，只发给私有回复接受者。插件核对接收连接账号/生命周期后使当前汇总失效，不生成假消息或公开序号。现有焦点、可见刷新和重连流程重新读取权限；切换账号/来源或失效后，旧异步结果丢弃。没有新增集合、索引、持久计数、开关或配置。普通发送、原引用创建、个人标记和个人评论原合同保持不变。

本地验证记录和包哈希保存在任务交付产物。合成 owner/浏览器场景不等同于生产账号验收；未合并/部署时不得称已在线生效。
