# D1105 账号模型与统计能力矩阵

| 能力 | UI | Tools | SDK | Host owner |
| --- | --- | --- | --- | --- |
| 设置与能力查询 | 原模型设置 | 本人安全投影 | accountModels + accountModelsV1 | AccountModelService |
| 偏好/停用 | 原 CAS 表单 | 当前人类确认后 CAS | 类型化命令，账号 scope | 同一 AccountModelService |
| 绑定云端凭据 | 原自提供表单输入 Key | credential_entry_required 指向同一表单，不接收或输出 Key | 受信任 consumer 可 saveAccountModel，秘密不进入返回值 | 同一账号执行 owner |
| 连接器 | 原 Host 安全存储/本机选择 | 安全状态与绑定指引 | 安全结果，无 connector secret | AccountModelConnector |
| 自备/本机用量 | 原使用记录 | 同查询与不透明游标 | accountModelUsage | AccountModelService |
| 积分统计/时段明细 | 原消费弹窗 | 同截止、同精度查询 | aiPointsStatistics/Range | AiPointsService |

2026-11-06 最终复核：分支 codex/c20261105-hpk01-account-models 已集成 dev 9927c3aa；原始基线 321c94946458723afa21a6f765cd86b99ff5ed01。代码与本机可执行门禁通过，未执行目标合并或发布。保持版本 3.0.54，没有改 DSH 源码、根 README 或 lockfile，也没有新增移动端管理页。

完整八分片在运行源码 6b3eeb0a 上执行：1529 个文件、16870 项通过、39 项跳过、0 失败，未放宽超时或性能断言。其后只增强不入包的验收脚本、仓外 consumer 和本文件，增强部分均实际执行通过；生产运行源码未改变。typecheck、完整测试后的串行 build/pack 通过，最终 tgz SHA256 为 50cefcb32c4d55387c8185b2f89c055292c87b989da40018d3aa7ff9905a0f50，与前轮候选全部文件内容/模式乃至 tgz 字节一致。

经未修改的官方 npm DSH 0.2.1-rc.2 CLI，在全新、路径含空格的 hpk06 Profile 安装。3845 个已安装文件与最终 tgz 逐项匹配。七个 Tool 均有实际调用：五个读取/绑定指引，偏好与停用两个写操作分别验证当前人类确认、确认前不写、确认后 CAS。仓外 consumer 只导入公开 SDK，strict 编译、实际绑定/停用/偏好/两类统计及 dispose/能力拒绝通过，绑定秘密没有进入返回值。

新身份基线 Intelligent 1dcc0cc7、Audio 0b1e347b、Relation 09fc3eeb 已集成并复验。所有实际 HTTP 消费者仍运行正式身份客户端、中间件和 SSE lease；只有身份签发服务是 loopback fixture。审查修复了 Relation 官方选模被旧策略覆盖，以及新流式 writer 未透传 ResponseController 导致积分慢请求 deadline 失效的问题；未增加表/集合/索引、开关、状态或官方积分回退。

已安装原生 adapter 实际调用百炼 Chat/Messages、DeepSeek Chat/Responses/Messages 共五次，另以零平台余额账号真实调用一次、重放两次。账号原生回执合计输入 148、输出 65；UI 的 DeepSeek Responses 为输入 38、输出 14。赠送 5、充值 1、可用 6 保持，八张计费表行数/内容摘要逐表完全不变，跨账号模型使用被拒绝。

原自提供表单实际新增与编辑留空 Key 保存，已保存密钥不回显；全局、DSH、录音摘要、录音时间线分别选不同模型，刷新后逐项与后端核对。原使用记录筛选/展开、官方积分日期/类型/明细同截止下钻均通过；页面操作后再查确认没有额外供应商调用或积分变化。原录音 UI 经 Host/HTTP/Audio/RabbitMQ/worker/目录/结算再次通过，余额不足零派发、双击单受理、继续与摘要/时间线分别验证；该 circuit 的供应商响应是合成边界。

身份签发、钱包和历史账单种子、部分旧调用是 fixture；业务 owner、Mongo/MySQL/MQ 和上述六次供应商请求是真实实现。用户 Key 的 Token 观测与已结算官方积分仍走原有两个入口，不伪造统一账单或供应商费用。

macOS 为实际安装验收；Windows 实机仍待目标环境验证。现有安全存储仅支持 macOS/Windows，Linux 单测 CI 不代表 Linux 登录运行能力，不将本机结果外推为全平台生产验证。生产配置未在本任务读取或部署。

工作区证据：analysis/hpk05-release-review-20261106；Meta active change 的 review-release-20261106.md 记录最终结果，review-20261106.md 保留完整场景到代码映射。原始失败、中止、基线控制和最终通过结果均保留。
