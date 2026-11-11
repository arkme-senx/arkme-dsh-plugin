# 隔离插件诊断转交 DSH
已确认原型：诊断下方并排显示「复制诊断信息」「发送给 Deepseek Harness 排查」，窄屏换行。
点击后新建 DSH 会话，将与复制相同的诊断及排查提示填入原生输入框，等待手动发送。
沿用现有账号、工作区和草稿保护；成功后收起提示并展示 Harness，失败保留诊断和可重试操作。
## 执行步骤
- [x] 给原生草稿桥接增加可选文本；测试原草稿保留、重试、能力缺失、无自动发送。
- [x] useAskDsh 增加文本入口；测试账号切换、重复点击、失败重试。
- [x] 接入诊断提示和中英文文案；测试展开、复制同源、成功跳转。
- [x] macOS / Windows 浏览器执行真实组件及草稿桥接集成验证并截图；运行相关回归。

## 验证结果（2026-11-10）
- macOS Chrome 与 Windows Edge 浏览器运行同一集成夹具通过，截图覆盖展开诊断、390px 窄屏、已填入的新会话。
- 覆盖文案、系统剪贴板读回、复制内容与输入内容一致、创建新会话、保留旧草稿、重复点击、失败重试、发送次数为 0。
- 夹具使用真实 Notice / useAskDsh / createHarnessDraftBridge；会话服务和输入框为隔离替身，不代表已登录正式客户端的端到端验收。
- TypeScript noEmit 和相关单测通过。
- 未提交、推送或发布。

复现：仓库根执行 `node scripts/qa/quarantine-ask-dsh/build.mjs /tmp/arkme-ask-dsh-qa`；
将 scripts/qa/quarantine-ask-dsh/test.mjs 复制到输出目录后在该目录执行 `node test.mjs`。
Windows 将 app.js 与 test.mjs 复制到同一目录，Node 24+ 执行 test.mjs（默认使用已安装 Edge）。
