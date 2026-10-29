# 团队历史能力

本能力只处理当前 Team 对话。日历、搜索、人物列表、分析及导出入口共享正式 Team history 合同；普通 Chat 统计、个人 Record 搜索、实时 timeline 各自保持其业务 owner。

| 消费面 | 合同 | 对应验证 |
| --- | --- | --- |
| Host | 当前账号前后检查；会话、人物、结果、词来源使用不透明引用；当前权限/版本检查；授权分块下载 | team-history-host、team-history-download |
| UI | 服务端稳定分页；日期/人物/类型筛选；词频与活跃桶来源；定位原消息；进度、取消与失败恢复 | team-conversation-tools；真实浏览器 live-stack |
| Tools | 正式注册与能力发现；12 个安全等价操作；下载描述不包含二进制正文或内部定位 | team-history-sdk-tools；官方 DSH 会话 driver |
| SDK | 公开类型、能力探测、账号/Profile 作用域；AbortSignal；可继续的导出块读取 | 仓外 team-history-sdk-consumer；安装产物的真实 HTTP driver |

`TeamHistoryOptions.contentKind` 区分 `text/visual/image/video/audio/voice/file/link/long_article`。普通音频附件仍是文件，voice 依赖内容 owner 的语音角色；人物按稳定身份引用筛选，不按昵称匹配。日界线由 IANA timezone 和左闭右开时间范围确定。

搜索命中是有界纯文本预览，不能作为编辑、引用或媒体授权的完整正文。点击沿既有 locate 读取当前消息；backend cursor 不复用 beforeSeq。历史快照失效会清空摘要并提示重新查询。初始索引准备和新消息追加使用服务端覆盖进度，不在客户端扫描旧 timeline。

导出先等待服务端完整文件证据，再按当前账号逐块读取。Host 检查块哈希、递增 offset、总字节与最终 SHA-256；下载路由沿现有 loopback/origin 边界，失败中断传输。文件不包含服务端媒体签名地址或内部 owner 信息。

真实跨服务验收入口为 `tests/e2e/team-history-live-stack.mjs`。它要求通过环境变量提供官方 DSH CLI、最终 tgz、隔离服务 environment.json、输出目录和 Playwright 依赖锚点；仅身份登录和目录展示使用合成数据，Team/Record 搜索、任务、来源和文件下载均调用生产 HTTP handlers。安装使用新的 DSH_HOME/Profile，不修改官方 DSH 源码或用户常驻 Profile。

用户指定 dev 基线；根 README、插件版本和 lockfile 不在本任务修改范围。操作系统相关能力的验收范围以实际运行环境为准。
