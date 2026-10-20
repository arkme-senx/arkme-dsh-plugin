# 日回顾模型自选能力矩阵

新增能力仅作用于日历多源日回顾，录音总结/时间轴保留原业务 owner。复用录音现有模型弹窗和下拉控件的视图实现，不复用其权限或计费。

| 面 | 实现与验证范围 |
| --- | --- |
| Host | CalendarDayReviewService 统一目录、账号围栏、不可变提交、回执匹配与恢复 |
| UI | 原生成按钮打开共用模型弹窗；默认 DeepSeek V4.1 Flash（官方）；取消不创建任务；确认才生成 |
| SDK | dayReviewModels / createDayReview(modelCode)，沿现有 provider 能力发现 |
| Tools | 原读取工具增加 models 操作，原生成工具增加 model_code，保留 explicit-user-write grant |

候选：qwen-flash、qwen3.8-flash、deepseek-v4-flash。DeepSeek 使用官方渠道，明确不使用百炼 DeepSeek。目录与创建均由后端重新校验已发布模型，失败任务继续原冻结模型；重新生成才可以改选。新增功能不改变历史版本选择器。

验证记录（2026-10-20）：

- Node 24 全量 1098 文件 / 12911 测试通过，16 文件 / 21 测试按原设置跳过。最终默认缺失与弹窗排版修正后，相关 UI / 录音回归 106 测试通过；typecheck、build、pack 通过。
- 正式包 SHA-256 `ab637751b2d160071526995aeb4901dc50e4bebd7217ca4002d855582988cab0`，通过官方 CLI 安装到带空格路径的新 Profile。使用未修改官方 DSH 0.1.5-rc.2（fb2c4b9e698e30edb738bca4cf0618587db7d203），不是开发 link 安装。
- UI 在实际浏览器验证默认官方 DeepSeek、取消不创建、确认受理、状态轮询、日总结与时间轴同时可读。隔离后端是本分支真实 HTTP / Mongo / MySQL / 积分链，仅素材和供应商输出为可控测试资料；另外三模型真实供应商测试独立完成。
- 仓外 Consumer 通过公开 SDK 导出编译，模型目录和生成调用成功；缺少页面 Origin 的生成请求保持拒绝，合法同源请求完成生成。没有给外部 Consumer 私有模块或凭据。
- 真实 DSH Agent 会话发现并读取模型目录；生成工具先返回 confirmation_required 且不创建，隔离会话模拟用户确认后按原参数完成生成。保留原会话确认链，没有跳过 grant。
- Host 合同测试覆盖当前账号、默认目录缺失、旧后端不支持、不可变选型、失联重放与错回执；目录关闭某模型不影响旧任务冻结选型。

安装验收 Profile 使用 pnpm 11 的 hoisted / autoInstallPeers=false，让官方运行时提供其 peer packages；未修改插件依赖或 DSH 源码。当前公开 registry 中旧 DSH peers 的自动安装解析可能失败，记录为旧运行时安装条件，不将其误报为本业务回归。

本轮没有部署生产或替换常驻实例。macOS 实测；未声称 Windows/Linux 运行验收。本改动不涉及原生进程、路径、凭据或平台代码。

