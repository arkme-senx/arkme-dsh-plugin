# 完整日回顾接入

基线：用户指定的 dev（初始2aaa17d7，任务已对齐92d0fcc5）。Host 以 Intelligent 为任务 owner，五源读取和积分由后端负责。浏览器不收集生成材料，不保留唯一提交证据。

| 能力面 | 入口和合同 | 验收 |
| --- | --- | --- |
| UI | 日历日总结／时间轴，账号隔离的 Host 提交记录，明确核对／恢复、三态新鲜度、未知时间 | 交互和失败路径测试通过；官方 DSH 独立 Profile 真实页面验证日总结、时间未知、继续任务及撤权清空 |
| Tools | arkme_day_review_read、arkme_day_review_generate；写入声明 explicit-user-write；原文用不透明引用读取，不返回 owner locator | Schema/owner 一致性通过；正式 DSH 会话发现、读原文及无人工确认禁止写入通过；确认后执行另有 ToolRuntime 回归 |
| SDK | calendarDayReview 能力探测；有类型的 state/create/reconcile/resume/result/prompts/evidence；沿 SDK 现有 AbortSignal 和订阅 unsubscribe 生命周期 | 从安装 tgz 公开导出的仓外 TypeScript consumer 编译与实际 Host 调用通过 |
| Host owner | CalendarDayReviewService 统一权限、接收回执与来源读取；StateStore 先原子保存完整请求，再发出请求，准确回执后清除 | 持久重启、错回执、账号变化、断网测试 |

独立实例验收使用不可变 tgz、未修改的官方 DSH 和临时 Profile，不替换常驻实例。已按用户要求提交推送任务分支；未合并、发布或部署。

验收使用官方发布版 DSH 0.1.1-rc.2 与确定性隔离上游，未使用线上凭据或真实模型。原生 Harness 聊天嵌入页另报既有 remote.session 服务缺失；日历页面及 scoped Agent/ToolRuntime 可以运行。本次未修改官方 DSH 或借机修复该非日回顾兼容问题。详见 meta 开发交付记录。

## Flash 与界面收敛复验

日历主布局、三视图、五源勾选和提示词编辑器未改。撤回常驻积分说明和未知新鲜度提示；继续生成仅出现在原失败状态区。刷新当前历史/原文会通过既有接口重新验证，成功保持阅读，撤权清正文。仍保留必要的未知时间、撤权提示和导入通话原文详情，不宣称前端零变化。

41项日回顾测试、12030项全量测试通过（20项跳过），typecheck/build通过。最终tgz SHA256为 `04e95a23ce532b421118cce8756aee86b694ca89382ed4444fdf6ec4bfe817fa`，新Profile官方DSH安装、实际UI和仓外SDK/Tools复验通过。UI和SDK使用真实本地Gin/Mongo/MySQL链路与确定性模型边界；真实Flash模型另在后端生产生成链路用合成资料验证，二者证据不混同。详细当前结论见meta的 `2026-10-16-calendar-day-review-flash-and-ui-review.md`。
