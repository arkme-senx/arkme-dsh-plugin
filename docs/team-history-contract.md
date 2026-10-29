# 团队历史能力

本能力只处理当前 Team 对话。日历、搜索、人物列表、分析及导出入口共享正式 Team history 合同；普通 Chat 统计、个人 Record 搜索、实时 timeline 各自保持其业务 owner。

| 消费面 | 合同 | 对应验证 |
| --- | --- | --- |
| Host | 当前账号前后检查；会话、人物、结果、词来源使用不透明引用；当前权限/版本检查；授权分块下载 | team-history-host、team-history-download |
| UI | 原搜索与分析控件；月份/成员筛选；真实词频与活跃桶来源；人物富媒体记录；定位、进度、取消与失败恢复 | team-conversation-tools；真实浏览器 live-stack |
| Tools | 正式注册与能力发现；12 个安全等价操作；下载描述不包含二进制正文或内部定位 | team-history-sdk-tools；官方 DSH 会话 driver |
| SDK | 公开类型、能力探测、账号/Profile 作用域；AbortSignal；可继续的导出块读取 | 仓外 team-history-sdk-consumer；安装产物的真实 HTTP driver |

UI 保持同事已实现的入口、侧栏、主题与布局。搜索只保留关键词输入，空白不查询，结果沿用三行摘要与整行定位；关闭重开保留关键词。分析沿用成员下拉框、月份、全部时间与 24/168 桶；历史人物元信息自动分页填入下拉框，不增加手动步骤，不在 UI 新增日期区间或类型控件。搜索与分析的筛选状态独立，重新打开分析恢复初始状态。词频原占位接入既有词云/列表组件与来源消息。

月份按本地 IANA 时区转换成月初（含）至下月初（不含）。分析仍统计全媒体；公开 API/SDK/Tools 可按自身业务选择内容类型。`TeamHistoryOptions.contentKind` 区分 `text/visual/image/video/audio/voice/file/link/long_article`。普通音频附件仍是文件，voice 依赖内容 owner 的语音角色；人物按稳定身份引用筛选，不按昵称匹配。日界线由 IANA timezone 和左闭右开时间范围确定。

搜索命中是有界纯文本预览，不能作为编辑、引用或媒体授权的完整正文。搜索、桶/词来源与人物记录的点击统一沿既有 locate 读取目标附近的授权窗口，滚动和高亮交互不变，不逐页翻到目标；backend cursor 不复用 beforeSeq。历史快照失效会清空摘要并提示重新查询。初始索引准备和新消息追加使用服务端覆盖进度，不在客户端扫描旧 timeline。

人物记录页先按稳定身份取历史摘要页，再调用已有 `team.app.preflight` 为当前页批量获取相同消息版本的完整内容，继续复用原富媒体气泡。身份缺失、版本变化或权限失败立即清空结果；不会扫描 timeline 或退回按昵称过滤。

必要的服务端生命周期差异只有索引/任务进度、稳定分页、快照失效后的重查与导出取消恢复；不另造业务面板。导出保留原文件名形式（访客名、团队对话与日期），下载路由只接受安全的 Markdown 展示名称，此参数不参与授权和文件选择。

导出先等待服务端完整文件证据，再按当前账号逐块读取。Host 检查块哈希、递增 offset、总字节与最终 SHA-256；下载路由沿现有 loopback/origin 边界，失败中断传输。文件不包含服务端媒体签名地址或内部 owner 信息。

真实跨服务验收入口为 `tests/e2e/team-history-live-stack.mjs`。它要求通过环境变量提供官方 DSH CLI、最终 tgz、隔离服务 environment.json、输出目录和 Playwright 依赖锚点；仅身份登录和目录展示使用合成数据，Team/Record 搜索、任务、来源和文件下载均调用生产 HTTP handlers。安装使用新的 DSH_HOME/Profile，不修改官方 DSH 源码或用户常驻 Profile。

用户指定 dev 基线；根 README、插件版本和 lockfile 不在本任务修改范围。操作系统相关能力的验收范围以实际运行环境为准。
