# 自动 AI 用户控制

基线为用户指定的 `dev`。快记想法、聊天想法、安排识别默认开启；个人档案与目标默认关闭，Record 是授权唯一事实源；Managed AI 是计费唯一事实源。正常分析即使没有产出也按实际用量计费。关闭阻止新的模型调用，已发出的调用可能完成并计费。个人档案首次开启包含历史材料，其余功能仅处理本轮开启后的材料。

| 能力面 | 入口与授权 | 验证状态 |
| --- | --- | --- |
| Host owner | CapabilityService；当前账号、授权版本 CAS、失败不盲重试 | 已验证 |
| UI | 用量与额度 → 自动 AI；逐项同意扣费后开启 | 已验证 |
| SDK | capabilities 探测 + query/update；启用须来自用户交互并确认收费说明 | 已验证 |
| Tools | 查询与显式确认后关闭；安全等价入口不允许模型自行开启持续扣费 | 已验证 |

Tools 的开启方式是引导用户进入交互设置页，而不是让模型替用户同意持续消费。关闭使用现有 explicit-user-write grant 和确认上下文。三个消费面共用 Host owner，不传递凭据或账号内部定位信息给模型。

本次不主动修改插件版本，不修改 DSH。验证使用官方 `dsh-v0.1.5-rc.2`（`fb2c4b9e698e30edb738bca4cf0618587db7d203`），通过 `dsh plugin add` 安装 `pnpm pack` 生成的 tgz 到全新 profile。

- `tests/e2e/automatic-capability.e2e.mjs`：真实 DSH turn 调用查询工具，真实 Record HTTP/Mongo 逐项验证默认状态，再显式关闭并验证重新开启、UI 明示费用后开启、SDK 模拟另一设备关闭、旧版本更新返回冲突、页面重获焦点刷新。认证和非本场景外部 API 使用本地 TLS fixture，没有修改官方 runtime。
- `scripts/verify-automatic-capability-consumer.mjs <packed-profile>`：仓外带空格目录，公开 SDK 类型检查与运行态验证授权/CAS/不支持/取消，不引用私有源码。
- Tools 的显式关闭由 `tests/tools/automatic-capabilities-runtime.test.ts` 覆盖，模型没有直接开启扣费能力的工具。
- `tests/automatic-capabilities-ui.test.tsx` / `tests/services/capability-service.test.ts`：确认前不写、账号切换、CAS 冲突、失败不假成功、档案开关/激活分步失败可重试。
- PC 浏览器验收覆盖控制行为；个人档案真实生成与积分结算由跨仓 Flutter/Record/Core/Intelligent/MySQL circuit 验证。未将 PC 缺少档案结果页表述为完整结果展示支持。

本轮实机为 macOS；未宣称执行 Windows/Linux 实机测试。运行 E2E 需要 `ARKME_DSH_CHECKOUT`、正式 tgz 安装后的 `ARKME_PACKED_PROFILE`、真实 Record fixture 的 `ARKME_RECORD_E2E_ORIGIN` 与本地 TLS fixture（`ARKME_E2E_TLS_KEY` / `NODE_EXTRA_CA_CERTS`），然后从官方 DSH 仓运行 `pnpm exec vitest run --config <plugin>/vitest.automatic-capability-e2e.config.mts`。

最新 `dev` 合入后的正式安装复验发现 `social-action-guard` 的动态 import 令浏览器 factory 引用相对 `.cjs` 分块，官方 DSH 的命名模块加载器无法解析，导致 Harness 页面无法启动。现所有浏览器 factory 设置 `codeSplitting: false`，不修改 DSH；`tests/package-contents.test.ts` 对真实构建产物解析 AST，检查全部 factory 没有未注册的相对 require/import。此检查与正式安装回路共同防止源码单测通过但交付包不可用。
