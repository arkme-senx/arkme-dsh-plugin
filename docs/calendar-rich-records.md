# 日历快记正文统一

基线：official/dev 25be63ca942c95ee5350cd676d8a73ed6e4c8f77。源码 owner 仅插件；客户端、Harness、运行环境发布不变。

点击日期 → calendar.records → CalendarService 权限过滤 → MediaService 按页批量解析媒体 → RecordService 共用内容投影 → ArkmeMessageContent → 既有详情抽屉。保留旧摘要字段，新增可选 content；旧响应仍可显示文字。

| 能力面 | 实现和验证 |
| --- | --- |
| Host | 同一 CalendarService，先过滤锁定/无权正文，再按页解析媒体；失败保留正文并标记媒体不可用；取消传播到读取和媒体批量请求。 |
| UI | 正文复用 ArkmeMessageContent，单击卡片正文或键盘 Enter/空格进入既有详情，媒体按钮保留独立预览/播放；切日期关闭详情，返回保留列表与焦点；刷新按钮用于读取/媒体失败恢复，读取失败不冒充空列表；复用现有分块窗口控制离屏媒体挂载。 |
| Tools | 原 arkme_record_calendar_read 返回相同 content 安全投影；无存储地址或凭据，注册与权限不变。官方 DSH 0.1.1-rc.2 的真实 Agent/ToolRuntime 已发现并成功执行，后端为独立 HTTPS fixture。 |
| SDK | 原公开 calendarRecords 返回可选 content 和 textFormat，类型已由公开 SDK 导出；缺少 content 时兼容旧服务；仓外 Consumer 从 tgz 安装包公开 SDK 导入，类型检查及真实 Host HTTP 调用通过。 |
| Client/Harness | N/A：不改原生桥、运行环境、装配或生命周期；不替换常驻实例。 |

每页 UI 20 条，Host 最大 50 条；本次不引入逐条详情请求、后台轮询或独立缓存。正文保留既有 4000 字摘要，完整内容投影上限 40000 字，超限明确标记截断。媒体继续使用账号作用域的不透明 mediaRef。不宣称性能提升或真实账号验收。

## 验证记录

- `pnpm typecheck` 通过；`pnpm build` 通过；`pnpm pack` 使用原版本 0.1.53 生成独立制品。
- 六个相关文件合计 224 项通过；随后补充刷新恢复，三个日历文件合计 16 项通过（与前者重叠）。覆盖富内容、隐私过滤、批量媒体失败、不透明引用、SDK/Tool、日期切换、长文点击和返回焦点。
- 全量 548 个文件：536 通过、5 失败、7 跳过；6312 项通过、44 失败、9 跳过。未修改 dev 的对应五文件复跑为 43 失败、60 通过；改动分支同组复跑也是 43 失败、60 通过。43 项来自既有 localStorage 测试环境和架构清单不匹配，首轮另一项 emoji 光标用例单独复跑通过；未改动这些无关文件。
- 官方 DSH 使用独立 DSH_HOME、独立 Keychain 前缀和本地 HTTPS 合成数据；通过正式 plugin add 安装 tgz，真实会话读取 `arkme_record_calendar_read`，确认 contentBlocks/Markdown/mediaRef 且无存储 URL/凭据泄漏。
- 仓外 Consumer 从已安装制品的公开 SDK 进行类型检查，并经实际同源 Host HTTP 接口成功执行 capabilities/calendarRecords。
- macOS 独立浏览器验证日期列表、Markdown、长文完整正文、详情、关闭返回焦点、图片显示/预览及媒体失败反馈。媒体字节使用测试 fixture，不能替代真实账户、签名 URL、Windows/Linux 或已安装客户端的业务验收。
- 客户端仓只读识别，主 checkout 为 master；无 Client、DSH、runtime-service 源码修改，无运行环境发布，不替换常驻 Arkme。

1344 个打包条目；代码及 sourcemap 不含任务目录或测试环境路径。最终制品重新安装后，官方 DSH Tool 与仓外 SDK 复验通过。
最终排版复核制品 SHA-256：`d28c59508a26961f9757c39a76af87bbe1beb91b23d890eeee5ac1958c232f72`。

## 日历交互对齐补充

移除单独的查看详情与加载更多按钮。列表复用触底哨兵模式（当前滚动容器、底部 120px），每页仍为 20 条；请求防重入，刷新/切换日期/卸载取消旧分页，关闭列表或打开详情时停止观察，失败停止自动请求并通过原刷新入口恢复。卡片保留媒体/链接独立交互及键盘入口。纯 UI 交互变化，未扩展 Host、Tools 或 SDK 能力。

相关 10 项测试覆盖正文/键盘详情、媒体链接隔离、焦点恢复、触底单次分页与结束后停止观察。继续原任务 worktree，远端 dev 已前进 1 个提交，未改写当前未提交实现。

本次复验：typecheck/build/pack 通过；全量 537 文件通过、4 文件失败、7 跳过，6316 项通过、43 项失败、9 跳过，失败仍属先前已确认的无关基线问题。macOS 任务客户端已重启并完成页面加载，实际 HTTP 前端包摘要与本地构建一致；本次点击/触底真实账户体验由用户验收。

## 加载与来源主题展示补充

参考客户端桌面日历的 RecordCardTopicInfo，在正文下方显示接口已有的 topicTitle（无主题不造 badge）；复用现有数据，不新增 Host 请求或 SDK/Tool 字段。该 badge 是来源展示，点击沿用当前卡片详情入口。首屏加载在列表区域水平/垂直居中，更新与分页加载水平居中。相关 12 项测试通过。

## 聊天来源 badge 修复

真实账号当天前 50 条响应均没有 topicTitle，旧适配器全部标为 unknown。日历来源必须兼容 record_core.origin_kind=3/4 与 origin_container_ref，不能仅看 topic_core/chat_core。CalendarService 按页去重会话 UID，交给既有 SourceService 账号作用域目录解析；同一批最多遍历 20 页（每页 50 会话），复用缓存，不逐条扫描。主题标题优先，无主题时展示会话名称；来源解析失败不丢正文，显示来源暂不可用。受保护记录不参与来源解析，取消传播。

新增可选 source 为既有 ArkmeSourceItem 安全投影，UI、calendarRecords SDK 与 calendar Tool 共用同一 Host 结果；无新增外部写入。来源批量解析与搜索复用 SourceService，搜索原有单项入口保持兼容。

聊天 badge 复验：相关 219 项与 typecheck/build 通过；实际账号当天 50 条均解析到来源（43 私聊、7 群聊），打包后的仓外 SDK 经当前 Host 同样确认 50/50 有来源名称。当前客户端前端 bundle 摘要与构建一致。

## 来源头像补齐

真实响应原先 50 条来源均缺少头像字段，UI 也仍使用聊天图标。CalendarService 对去重来源复用 hydrateDirectoryPage 补齐用户头像与群头像；失败保留来源名称。badge 复用 ArkmeDirectorySourceAvatar，沿用既有头像读取、缓存、懒加载及群成员拼图规则。相关服务/头像/日历 166 项通过；补充真实 img 与群头像 slot 渲染后，UI/头像 21 项通过，typecheck 通过。

## 分页、详情来源与跳转修复

底部哨兵持续可见时，每次重建观察器不再自动请求下一页：跨请求保留触发锁，仅离开底部再进入时重新允许加载；换日期/刷新重置。详情通过可选 sourceBadge 展示与列表相同的 badge/头像（包含转发详情）。badge 独立按钮调用既有 selectSource，阻止卡片点击冒泡并关闭日历；有主题摘要时由 Host 生成主题 source，缺失可导航来源时禁用按钮，不能把主题标题错误导航到聊天。

新增交互检查覆盖 observer 重建仍可见、重新进入底部、列表/详情跳转、群头像保留及转发详情 badge。

本轮 203 项相关回归与 typecheck 通过，覆盖日历交互、Host 主题来源、通用详情/相关快记/转发详情。当前任务客户端继续保留原 App Data，更新后由用户进行真实滚动与会话跳转验收。

## 实时会话更新保留私聊头像身份

chatSourceFromBundle 原先未投影 private_counterpart.user_id，实时替换目录缓存后缺少 peerUserId，日历无法补齐尚未缓存的头像。公共转换处补齐有效的正整数用户 ID，复用原有批量头像加载，不新增请求路径。回归覆盖实时缓存替换后日历头像补齐及非法 ID；先确认原实现失败，再验证相关 218 项、typecheck/build 通过。当前任务客户端保留原 App Data 重启，HTTP bundle 与构建一致；真实日历响应中目标私聊 peerUserId、avatarRef 均存在，image.read 成功。新消息实时到达后的 UI 场景仍由用户验收。
