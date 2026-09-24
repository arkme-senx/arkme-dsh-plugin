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

## 2026-09-23 三端体验收口

用户侧统一称“Arkme 3.0”，充值页说明与 APP 共用积分。现有充值流程不变；APP/旧 Flutter PC 只提供查询、消费与官网下载指引，不扩展支付渠道。

| 能力面 | 本轮增量与验证 |
| --- | --- |
| UI | 模型菜单增加独立折叠计费说明，查看不改变选择；消费按可信 Agent operation_uid 聚合，展开仍显示调用级准确费用；无标识的 Arkme 请求保持独立 |
| Tools | 原 arkme_ai_points / arkme_ai_points_consumption 保留共享 owner；正式包的注册 Tools 在真实会话作用域读取同一账本，未新增计费或写入工具 |
| SDK | 公共 aiPointsConsumption 保留 operationUid；完整业务组可超过20个调用，仍最多20组；包外 SDK consumer 已经官方运行时验证，错误账号作用域仍拒绝 |
| Host owner | AiPointsService 统一契约校验/账号边界；报价来自 Intelligent point_pricing，不按Token遥测、模型昵称或UI倍率重算价格 |

747个测试文件、8828项测试通过（11文件/15项按原配置跳过），类型检查与构建通过。新增分组、报价及“查看不选中”回归。正式 `.tgz` 通过官方 CLI 安装至全新隔离 profile，官方 DSH `dsh-v0.1.5-rc.2` 源码未改，已通过含 UI/Tools/SDK/真实HTTP/真实MySQL 的跨仓链路；真实供应商和支付仍使用隔离边界，未作线上验收。

完整本轮记录位于 meta：`docs/analysis/2026-09-23-ai-points-ux-delivery.md`。没有改插件版本、根 README 或发行配置。

## 2026-09-24 消费月份交互修复

对照 `origin/dev`（8b6be0d）及 `origin/master`（052ac40）的 `ArkmeTokenUsageBreakdown`，基线使用原生 `select`；积分页的 `input type="month"` 会把年月文字点击解释成分段编辑。现恢复基线下拉选择及同一套样式，文字和箭头区域均可展开。默认列出最近 24 个月，“更早月份”每次扩展 12 个月，不改变当前账期、不发查询，也不限制历史记录范围。月份按上海时区确定，切换后继续由原有请求 owner 取消旧请求、隔离旧月份结果。

| 能力面 | 本轮范围与证据 |
| --- | --- |
| UI | 月份选择交互；42 项相关测试、类型检查和构建通过。隔离浏览器组件页面验证文字/箭头点击、键盘切换、取消及扩展历史；未替换用户常驻 DSH |
| Tools / SDK | N/A：仅替换 UI 控件，未新增业务能力或修改公共接口 |
| Host owner | AiPointsService 及账本查询契约不变 |
