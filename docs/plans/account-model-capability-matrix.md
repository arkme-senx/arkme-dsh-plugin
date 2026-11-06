# D1105 账号模型与统计能力矩阵

| 能力 | UI | Tools | SDK | Host owner |
| --- | --- | --- | --- | --- |
| 设置与能力查询 | 现有模型设置 | 本人安全投影 | accountModels + accountModelsV1 | AccountModelService |
| 偏好/停用 | 现有 CAS 表单 | 当前人类确认后 CAS | 类型化命令，账号 scope | 同一 AccountModelService |
| 绑定云端凭据 | 现有自提供表单输入 Key | 发起 credential_entry_required，指向同一表单；不接收或输出 Key | 受信任 consumer 可调用 saveAccountModel；秘密不进入工具 | 同一账号执行 owner |
| 连接器 | 原 Host 安全存储/本机选择 | 安全状态与绑定指引 | 安全结果，无 connector secret | AccountModelConnector |
| 自备/本机用量 | 现有使用记录 | 同查询与不透明游标 | accountModelUsage | AccountModelService |
| 积分统计/时段明细 | 现有弹窗 | 同截止、同精度查询 | aiPointsStatistics/Range | AiPointsService |

2026-11-06 最终上线前复核进行中。分支 `codex/c20261105-hpk01-account-models`，已同步 dev `9927c3aa`；原始基线 `321c94946458723afa21a6f765cd86b99ff5ed01`。不执行目标合并或发布。

本轮 Node 24 tgz SHA256：`50cefcb32c4d55387c8185b2f89c055292c87b989da40018d3aa7ff9905a0f50`。经未修改的官方 npm DSH 0.2.1-rc.2 CLI 在新建、路径含空格的独立 Profile 实际安装激活。7 个 Tool 的发现/grant/调用、写操作人类确认、仓外 SDK strict 编译和调用均通过。原偏好页面保存不同全局/场景模型，刷新保持；原使用记录筛选和展开明细通过。完整分片结束后仍需串行重建并核对候选内容。

已安装原生 adapter 真实调用白链 Chat/Messages、DeepSeek Chat/Responses/Messages 共五次，均成功并获得 Token 回执。另以零平台余额账号真实调用一次、重放两次，仅一条用量；跨账号模型使用被拒绝。账号来源五次已知回执合计输入 148、输出 71；UI 的 DeepSeek Responses 单例为输入 38、输出 2。赠送 5、充值 1、可用 6 积分保持，八张计费表逐表内容摘要完全不变。身份签发、钱包种子和额外无 usage 调用是 fixture，Mongo/MySQL/执行 owner 与六次供应商请求是真实实现。

原录音页面再经 Host/HTTP/Audio/RabbitMQ/worker/结算通过，余额不足零派发、双击单受理、继续与摘要/时间线分别验证；该 circuit 的供应商是合成响应。账号身份仍复用现有 session owner 的已确认身份，同步捕获原生调用开始时的 scope；SDK dispose 取消未完成读取。

集成树 typecheck 通过；完整分片曾因资源协调中止，已完成片出现超时/性能失败和一次与并行构建争用同一 lib 的验收调度错误，待隔离复验，不能标为通过。macOS 为实际安装验收；现有安全存储支持 macOS/Windows，Windows 实机尚缺证据，Linux 单测 CI 不代表 Linux 登录运行平台。

工作区本轮证据：`analysis/hpk05-release-review-20261106`；Meta active change 的 `review-release-20261106.md` 补充新问题、修复和运行边界，原 `review-20261106.md` 保留完整场景到代码映射。本轮修正 Relation 已解析官方选模被旧策略覆盖的问题；脚本改为原子发布并支持已有回执核验，不重复派发付费调用。
