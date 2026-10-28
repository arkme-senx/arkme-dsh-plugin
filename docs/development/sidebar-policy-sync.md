# 侧边栏跨端策略同步

基线：official/dev b0e1e58cf8311b13d971139882685570a1a49873。

通知只提示失效；账号作用域内的 ConversationDirectoryService 负责定向查询、合并、持久化与有界失败恢复。偏好 revision 与置顶 policy update_at 分别校验，不使用消息序号代替。Browser 消费既有 directory-update，不传递原始实体身份。

| 能力面 | 本次范围 |
| --- | --- |
| Host | 修复既有置顶、移除同步；不新增远端接口、写操作或公开业务能力 |
| UI | 既有目录增量、可见性和未读投影；Chrome 中隔离 DSH 实例验收 |
| Tools / SDK | 不新增操作；既有查询与写入仍复用同一 Host owner，兼容契约回归 |
| Client / Harness | 客户端源码不变；使用未修改的官方 DSH 0.1.5-rc.2 安装本任务 tgz |

保持普通会话与 Bot 移除身份语义；Bot 本地置顶及 DSH 会话归档不改为新的跨端能力。首次启动、重连、未知条目与容量退化复用完整目录对账。查询失败保留旧画面和待刷新状态，不当作成功；账号切换和卸载释放请求、定时器与队列。

验证记录（2026-09-20）：

- 最小基线通过；新增回归在原实现上复现 visibility 查询失败仍标记 complete。
- 最终 `NODE_OPTIONS=--no-experimental-webstorage pnpm test --maxWorkers=4`：687 个测试文件通过、8 个跳过；8290 项通过、12 项跳过。相同参数下原始基线为 8262 项通过、12 项跳过，本次新增 28 项。
- 本机 Node 25 默认 Web Storage 与测试 DOM 冲突；未加参数时失败，原始基线也能复现。仅在测试进程关闭该实验特性，未改源码、依赖或测试配置。
- `pnpm typecheck` 通过。定向刷新覆盖 20／2000 条真实分页夹具、100 条重复通知合并、50 条批次、1000 条队列容量退化、最多 5 次补查、过期响应、分页并行、账号切换和卸载。
- 并发消息导致可见性结果被跳过、或会话引用更新时，保留旧画面并标记待对账；复用单 owner 的完整补查，确认状态后才报告 complete。追加 6 项回归覆盖定向／旧通知、引用更新、后续恢复和持续冲突下的 5 次补查上限；不会直接强写过期结果。
- Browser 保留原失效事件的订阅兼容性；新增可选 `refresh: none` 表示 Host 已负责补查。挂载组件测试确认消费 `directory-update` 后更新置顶及可见性，不再调用额外目录读取；旧 Host 事件仍走旧回退。
- 以上证明功能和请求数量边界，不作为真实网络延迟、长期运行或 Windows/Linux 验收结论。真实账号手机与 Chrome 双向置顶／移除、断网重连仍须实际操作验证。

安装与运行：

- `pnpm build` 与 `pnpm pack` 通过；不可变 tgz SHA-256：`daf5b29207c43b6b3d14f5564cbe7c1e42c06efced64751144e65097261ee42b`。包内未发现本机路径、测试目录、数据库或临时日志；版本保持 0.1.69，未发布。
- 官方 DSH 0.1.5-rc.2 通过 `plugin --profile web add <tgz>` 安装；实际 Host、Browser、SDK 文件逐字节匹配 tgz。全新带空格的 DSH_HOME、独立 Profile／Keychain 和随机本地端口，自动更新关闭。
- Profile 的 `config` 覆盖必须包含所选环境的完整配置，不能只写 Keychain／更新字段；当前实例使用测试服，补修包加载后已核对 `auth.status` 为 `authenticated`、`test`，原有登录得以保留。
- Chrome 实际展示 Arkme 0.1.69 的已登录侧边栏，实例和页面均保留。尚未完成真实手机双向同步操作，因此不声称该场景通过。
- Arkme 客户端和 DSH 参考仓 tracked 文件未改；没有替换常驻客户端或发布制品，PR 只交付插件源码。
