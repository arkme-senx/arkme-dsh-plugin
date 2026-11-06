# D1105 账号模型与统计能力矩阵

| 能力 | UI | Tools | SDK | Host owner |
| --- | --- | --- | --- | --- |
| 设置与能力查询 | 现有模型设置 | 本人安全投影 | accountModels + accountModelsV1 | AccountModelService |
| 偏好/停用 | 现有 CAS 表单 | 当前人类确认后 CAS | 类型化命令，账号 scope | 同一 AccountModelService |
| 绑定云端凭据 | 现有自提供表单输入 Key | 发起 credential_entry_required，指向同一表单；不接收或输出 Key | 受信任 consumer 可调用 saveAccountModel；秘密不进入工具 | 同一账号执行 owner |
| 连接器 | 原 Host 安全存储/本机选择 | 安全状态与绑定指引 | 安全结果，无 connector secret | AccountModelConnector |
| 自备/本机用量 | 现有使用记录 | 同查询与不透明游标 | accountModelUsage | AccountModelService |
| 积分统计/时段明细 | 现有弹窗 | 同截止、同精度查询 | aiPointsStatistics/Range | AiPointsService |

2026-11-05 已完成本地实现与隔离验收。插件基线 `321c94946458723afa21a6f765cd86b99ff5ed01`，分支 `codex/c20261105-hpk01-account-models`。

Node 24 构建的最终 tgz SHA256：`1f2222e280e2ed56e0e32a70a196c0a7f840c04f28d42be0509519710e65679b`。通过未修改的官方 npm DSH 0.2.1-rc.2 和新 Profile 实际安装、激活并验收 7 个 Tool 的发现/grant/调用与写操作人类确认；独立包外 consumer 通过公开 SDK strict 编译和实际调用。实际页面验证原模型表单、偏好、未知用量和积分同截止下钻。验收 driver 使用隔离业务 fixture，不代表真实供应商调用。

账号身份复用现有 session owner 的已确认身份，同步捕获调用开始时的 scope；SDK dispose 取消未完成读取。相关测试、生命周期和包内容测试通过，完整宽扫尚有大页面 timeout 等未全绿结果。真实供应商、Windows/Linux 实机待目标环境验收，不将 macOS 本地通过外推为所有平台通过。

工作区交付记录：`analysis/hpk01-implementation-20261105/最终交付与验证.txt`，原始证据：同目录 `evidence/`。未提交、推送或部署。
