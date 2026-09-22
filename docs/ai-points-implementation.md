# AI 积分接入

基线：用户指定 origin/dev（114ad18），任务 worktree；不修改 DSH、根 README 或版本号。

本次积分 API 只读取账户及已结算消费。会员发放与模型收费分别由 Backend 和 Intelligent 持有；插件不估算余额，不从 Token 遥测推导扣费。

| 能力面 | 实现入口 | 验证状态 |
| --- | --- | --- |
| UI | 用量与额度 → AI 积分、扣费明细；充值保留人民币支付价格 | 已完成，相关单测及官方 DSH 正式 tgz 链路通过 |
| Tools | 当前登录账号 AI 积分及消费查询，只读，不发放、不充值 | 已完成，相关单测及官方 DSH 正式 tgz 链路通过 |
| SDK | aiPoints 能力探测、类型化账户与分页明细，支持 AbortSignal | 已完成，相关单测及官方 DSH 正式 tgz 链路通过 |
| Host owner | AiPointsService：统一账号作用域、契约校验和错误语义 | 已完成，相关单测及官方 DSH 正式 tgz 链路通过 |

不扣积分的后台业务不进入此页面。Token 只出现在已扣费请求的展开明细。存储、语音等独立额度沿用原 owner 与计量单位。

验收使用官方 `dsh-v0.1.5-rc.2` / `fb2c4b9e`，源代码未修改；独立 profile 通过官方 CLI 安装 tgz。因官方 peer 范围 `>=0.1.5` 不匹配已发布 rc 包，测试 profile 按目标官方版本固定其同套依赖，未改插件版本/依赖或用户常驻环境。8 场景覆盖正常、异常、恢复；真实 UI、公共 SDK、注册 Tools 读取同一账本。余额不足文案统一为积分；同账号请求并发冲突提示等待，不自动重试扣费。

更完整的测试矩阵与基线限制见 meta 的 `docs/analysis/2026-09-22-ai-points-verification.md`。
