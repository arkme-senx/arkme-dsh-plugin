# 团队本人入口偏好

Owner 为 Team；仅团队文件夹与带访问侧会话。PC 保留现有菜单/预览，Host 受权解析引用后访问 Team，原始 ID、凭据和冻结 wire command 不进入模型/浏览器。

| 消费面 | 接口与权限 | 验证 |
| --- | --- | --- |
| UI | team.app.entries query/list/change；当前账号，菜单即时投影，失败可核对；预览不读、不恢复 | Host/Client/widget 与两设备服务合同 |
| Tool | 本人偏好查询；明确 human-write grant 后设置指定入口与期望版本 | 正式工具注册、输入/输出/拒绝测试及隔离 DSH 调用 |
| SDK | 协议探测、opaque target、版本/操作 ID、公开类型 | 仓外 consumer、错误与生命周期 |
| Host owner | 三面共用 TeamAppService/入口偏好 owner，冻结操作 ID/CAS；账号核对 | 共同语义测试与真实 Team 集成 |

本机旧数据只用于一次性 create-if-absent 导入。未知文件夹水位不重置为当前水位；本人默认云行优先。主键/索引由 Team 管理，插件不维护另一份云事实。DSH 不修改，插件版本不变，最终安装测试使用不可变 tgz。

目录 owner 将首屏外置顶补取缓存与普通分页窗口分开，统一参与已读、撤权和账号隔离；回执不丢弃正在发现的置顶，补取不逐轮扩大普通分页。权限拒绝清除旧预览，不等同个人移除。明确打开历史入口以会话成功序号判定激活，可以恢复发布活动初值为零的旧文件夹；挂载和空窗口不写恢复。

## 验收结果（2026-10-28）

- UI：官方 DSH 0.2.1-rc.2 + Chrome，真实右键菜单、置顶重载、只读预览不推进已读、移除、空窗口保持移除、未来访客首条发布恢复；窄菜单目标在异步目录更新后重试定位。
- Tool：正式 Session 中可发现；确认前不写入，后续真人消息授权后成功；错误参数被 schema 拒绝，插件来源消息不能替代确认。
- SDK：`tests/consumers/team-entries/consumer.ts` 作为仓外 Consumer 从已安装 tgz 编译，调用公开 SDK/Host，验证协议探测和缺失能力拒写。请求方法无持有资源，AbortSignal 管理取消。
- Host：UI/Tool/SDK 共用 TeamAppService 内的 TeamEntryPreferenceService；持久命令重启重放、账号隔离、云优先导入、游标封装、缓存上界及保存失败已测。
- 真服务：`tests/e2e/team-entry-preferences-services.mjs` 与 meta 的 `scripts/e2e/team_entry_preferences_services.py`，连接独立 Team/Record/IM、Mongo/Redis/RabbitMQ/MySQL。PC 置顶由手机真实 runtime 读取；手机取消置顶经 IM 在 PC 页面收敛。手机菜单/手机与平板 pane 在独立 widget 套件验证。账号身份及无关搜索为本地替身，不代表实际手机或 Windows/Linux 验收。
- Node 24 全量通过，插件版本保持 3.0.35。最终安装使用按 SHA-256 固定命名的 tgz，包含空格路径；根 README、版本/lock 元数据和 DSH 源码未改。

复现入口需要显式提供本地隔离环境：`ARKME_TEAM_ENTRY_READY` 为 runner 的 ready.json，另提供 DSH_HOME、ARKME_DSH_RUNTIME、ARKME_PLAYWRIGHT_ANCHOR、ARKME_E2E_TLS_KEY、NODE_EXTRA_CA_CERTS、ARKME_FLUTTER_BIN、ARKME_FRONTEND_REPO。先通过官方 `dsh plugin --profile web add -w <immutable.tgz>` 安装，再运行上述 mjs。只使用自己创建的依赖及 Profile，结束由 runner 清理其容器与服务。

## 最终打开链路复核（2026-10-29）

团队卡片、通过链接发消息和联系作者复用 `team-entry-navigation`，与原 Panel 共享一次 `team.app.open`。只有明确打开且获准返回已有发布历史，才恢复本人入口；成员链接仍进入原收件箱，访客链接仍进入原对话。原布局、菜单、加载、错误与重试按钮保持原样。单纯挂载、预览和空窗口不产生恢复意图。

可选恢复在现有账号命令队列中先预留顺序，再等待打开/历史核对；用户后续移除不会被慢打开覆盖。离开账号范围（包括 A→B→A）或在打开完成前取消时不恢复；同账号 token 刷新保留有效操作。打开错误沿用 Panel 反馈，原重试按钮重新表达明确打开意图。没有新增持久状态、后台队列、接口、配置或数据结构。

新增 `team-entry-opening-lifecycle.test.tsx` 通过真实 UI、导航与偏好 owner（仅 HTTP 替身）验证卡片→成员/访客、官方入口失败→重试、重新挂载不恢复；队列与导航单测验证慢打开/后移除、取消、空窗口及账号范围变化。
