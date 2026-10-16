# 自动 AI 用户控制

基线为用户指定的 `dev`。快记想法、聊天想法、安排识别默认开启；个人档案与目标默认关闭，Record 是授权唯一事实源；Managed AI 是计费唯一事实源。正常分析即使没有产出也按实际用量计费。关闭阻止新的模型调用，已发出的调用可能完成并计费。个人档案首次开启包含历史材料，其余功能仅处理本轮开启后的材料。

| 能力面 | 入口与授权 | 验证状态 |
| --- | --- | --- |
| Host owner | CapabilityService；当前账号、授权版本 CAS、失败不盲重试 | 已验证 |
| UI | 用量与额度 → 自动使用额度；逐项同意扣费后开启 | 已验证 |
| SDK | capabilities 探测 + query/update；启用须来自用户交互并确认收费说明 | 已验证 |
| Tools | 查询与显式确认后关闭；安全等价入口不允许模型自行开启持续扣费 | 已验证 |

Tools 的开启方式是引导用户进入交互设置页，而不是让模型替用户同意持续消费。关闭使用现有 explicit-user-write grant 和确认上下文。三个消费面共用 Host owner，不传递凭据或账号内部定位信息给模型。

本次不主动修改插件版本，不修改 DSH。验证使用官方 `dsh-v0.1.5-rc.2`（`fb2c4b9e698e30edb738bca4cf0618587db7d203`），通过 `dsh plugin add` 安装 `pnpm pack` 生成的 tgz 到全新 profile。

- `tests/e2e/automatic-capability.e2e.mjs`：真实 DSH turn 调用查询工具，真实 Record HTTP/Mongo 逐项验证默认状态，再显式关闭并验证重新开启、UI 明示费用后开启、SDK 模拟另一设备关闭、旧版本更新返回冲突、页面重获焦点刷新。认证和非本场景外部 API 使用本地 TLS fixture，没有修改官方 runtime。
- `scripts/verify-automatic-capability-consumer.mjs <packed-profile>`：仓外带空格目录，公开 SDK 类型检查与运行态验证授权/CAS/不支持/取消，不引用私有源码。
- Tools 的显式关闭由 `tests/tools/automatic-capabilities-runtime.test.ts` 覆盖，模型没有直接开启扣费能力的工具。
- `tests/automatic-capabilities-ui.test.tsx` / `tests/services/capability-service.test.ts`：确认前不写、账号切换、CAS 冲突、失败不假成功、档案开关/激活分步失败可重试。
- PC 浏览器验收覆盖控制行为；个人档案真实生成与积分结算由跨仓 Flutter/Record/Core/Intelligent/MySQL circuit 验证。最新 dev 已增加 PC「探索 → 个人档案 / 目标」结果页；入口复用同一授权控件，Host 执行前再次检查授权，读取失败时保留结果可读。

本轮实机为 macOS；未宣称执行 Windows/Linux 实机测试。运行 E2E 需要 `ARKME_DSH_CHECKOUT`、正式 tgz 安装后的 `ARKME_PACKED_PROFILE`、真实 Record fixture 的 `ARKME_RECORD_E2E_ORIGIN` 与本地 TLS fixture（`ARKME_E2E_TLS_KEY` / `NODE_EXTRA_CA_CERTS`），然后从官方 DSH 仓运行 `pnpm exec vitest run --config <plugin>/vitest.automatic-capability-e2e.config.mts`。

最新 `dev` 合入后的正式安装复验发现 `social-action-guard` 的动态 import 令浏览器 factory 引用相对 `.cjs` 分块，官方 DSH 的命名模块加载器无法解析，导致 Harness 页面无法启动。现所有浏览器 factory 设置 `codeSplitting: false`，不修改 DSH；`tests/package-contents.test.ts` 对真实构建产物解析 AST，检查全部 factory 没有未注册的相对 require/import。此检查与正式安装回路共同防止源码单测通过但交付包不可用。

## 2026-10-15 合并前修复

- Explore 的个人档案/目标不再绕过授权直接启动。关闭或无法确认设置时只读已有内容，固定入口打开现有额度管理与确认控件；暂停、纠正和删除已有内容不依赖启用分析。
- 档案续跑复用当前 run；从其他设备关闭后，旧页面的启动/续跑请求也会重新检查 Record 授权。没有新增模型可调用的“开启”工具。
- 档案和目标使用既定模型，不再提供无效模型选择；档案数据范围不展示或接受微信导入。Core 地址沿用基线已有配置。
- `tests/explore-service.test.ts` / `tests/explore-ui.test.tsx` 覆盖上述入口、授权变更、依赖故障、已有结果和数据范围；共享 CapabilityService 继续覆盖 Tools / SDK 的既有授权约束。
- 全套测试中 79 项失败在未修改的同 SHA `origin/dev` 归档中全部复现（聊天测试 70、社交导航 7、世界导航 1、Host 静态门禁 1）。本次不修改其聊天业务逻辑；不能把这批基线门禁视为通过。

本轮验收：相关 99 项测试、类型检查、正式构建与包内容检查通过；新 tgz 经官方 DSH 0.1.5-rc.2 安装后，真实浏览器完成查询 Tool、SDK 授权冲突、额度管理与 PC 档案开启链路。Record 使用隔离真实 HTTP/Mongo；Core 激活响应与认证使用本地 TLS fixture，未调用线上模型。仓外 SDK Consumer 类型和运行验证通过。跨仓个人档案生成/续跑/结算由独立 Flutter + Record + Core + Intelligent 回路验证。
