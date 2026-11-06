# D1105 账号模型与统计能力矩阵

| 能力 | UI | Tools | SDK | Host owner |
| --- | --- | --- | --- | --- |
| 设置与能力查询 | 现有模型设置 | 本人安全投影 | accountModels + accountModelsV1 | AccountModelService |
| 偏好/停用 | 现有 CAS 表单 | 当前人类确认后 CAS | 类型化命令，账号 scope | 同一 AccountModelService |
| 绑定云端凭据 | 现有自提供表单输入 Key | 发起 credential_entry_required，指向同一表单；不接收或输出 Key | 受信任 consumer 可调用 saveAccountModel；秘密不进入工具 | 同一账号执行 owner |
| 连接器 | 原 Host 安全存储/本机选择 | 安全状态与绑定指引 | 安全结果，无 connector secret | AccountModelConnector |
| 自备/本机用量 | 现有使用记录 | 同查询与不透明游标 | accountModelUsage | AccountModelService |
| 积分统计/时段明细 | 现有弹窗 | 同截止、同精度查询 | aiPointsStatistics/Range | AiPointsService |

2026-11-06 合并前复核完成。分支 `codex/c20261105-hpk01-account-models`，已同步最新 dev `e2ca7421b`；原始基线 `321c94946458723afa21a6f765cd86b99ff5ed01`。

Node 24 构建的最终 tgz SHA256：`0e3303b0654f187bc727e89cd76d9f8469bab0bd759b8414b1c68af0744911b8`。通过未修改的官方 npm DSH 0.2.1-rc.2 和新 Profile 实际安装、激活并验收 7 个 Tool 的发现/grant/调用与写操作人类确认；独立包外 consumer 通过公开 SDK strict 编译和实际调用。实际页面验证原偏好保存、未知用量和积分同截止下钻，连接真实 Gin JWT/Mongo 账号执行与用量/MySQL 积分 owner；身份签发、结算种子和供应商响应为隔离 fixture。原录音页面另经 Host/HTTP/Audio/RabbitMQ/worker/结算真实链路通过，余额不足零派发、双击单受理、继续与摘要/时间线分别验证。

账号身份复用现有 session owner 的已确认身份，同步捕获调用开始时的 scope；SDK dispose 取消未完成读取。本次相关 219 项通过，opt-in 录音 circuit 另行启用通过；typecheck/build、包安装与仓外消费通过。完整宽扫尚有大页面 timeout 等未全绿结果。后端另以授权凭据完成白链/DeepSeek Chat 与 Responses 的真实执行重放和两供应商复盘验证，不与页面 fixture 边界混淆。Windows/Linux 实机待目标环境验收，不将 macOS 本地通过外推为所有平台通过。

工作区最终审查记录：`analysis/hpk01-premerge-20261106/最终审查与交付.txt`；Meta active change 的 `review-20261106.md` 记录场景到代码和测试映射。初始实现与复核修复均提交推送到任务分支，没有合入目标或部署。
