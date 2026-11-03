# Codex 私有 OSS 内容合同

本次只替换存储与 Host 数据接线，页面布局、按钮、交互路径及 CSS 不变。既有 UI、Tools 和 SDK 继续通过同一个 TeamCodexService/TeamCodexCloud owner 读取逻辑事件。

- 来源与任务元数据由 /sync 提交，消息正文仅在 Host 进行有界 gzip，经过 content/prepare → 私有 OSS PUT → content/commit 后才确认本地 outbox。
- 同一轮输入与前 4 条过程回复共用一个块，后续每 4 条过程回复为独立块，最终/中断回复独立封块。原始 Codex journal 仍是本机事实来源。
- content/list 返回索引和短期授权，Host 校验完整归属、大小、SHA256、解压上限和消息身份，恢复原有事件结构。OSS GET 授权可不含 headers；签名 URL/头不进入 UI、Tools 或 SDK。
- 列表只读会话摘要；本人队列返回 queueSummary 数量、等待数与状态。打开详情时事件页附带本人完整队列，所有者之外不返回队列和图片清单。
- 任务列表第二页起使用服务端 next_cursor；保持现有上一页/下一页交互。并发上传/下载上限 2；原文/压缩上限 8/5 MiB；消息单条 256 KiB；outbox 待上传正文预算 512 MiB；队列详情缓存 64 条/16 MiB。
- 上传失败、未知提交结果和进程重启保留稳定身份，只有确定 ACK 才推进；切号时取消传输并在下载后重新确认账号。没有额外灰度或业务配置。
- 旧云端正文路由已移除。TEST 历史由一次性运维清理，不实现旧 Mongo 内容回退或双写；本机原始数据不删除。

能力面：UI、Tools、SDK 的逻辑事件接口保留；Host 唯一持有账号校验、压缩、授权与下载；客户端继续消费标准插件 artifact，无 Electron/DSH 上游修改。本人队列细节从列表移到同一详情请求，不新增操作入口。

验证包括真实 Mongo/HTTP 跨仓、完整插件回归、TEST 3016/3020 权限隔离、真实 Codex 过程/最终回复与私有图片，以及 CODEX_CONTENT_REAL_TEST_FIXTURE 显式启用的真实 TEST Host 消费测试。无该临时凭据文件时真实 TEST 用例跳过，不读取用户账号数据。
