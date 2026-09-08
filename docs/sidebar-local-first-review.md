# 侧边栏合并前场景审查

审查对象：PR #381 的 `codex/c20260908-sidebar-local-first`。起点为 6eb6943，修复提交 e2e2b19；与目标 dev 5581c82 合并后，再完成缓存 Bot 引用修复；最终运行代码为 c0ac896。客户端读取官方 master 02f86d2，仅用于隔离验收，没有客户端源码改动。

## 结论与证据口径

本轮不是仅检查 diff 或依赖原有绿灯：先复现失败，再修复，再运行相关回归及完整套件。下表覆盖本对话已明确的场景，以及本次改动直接改变的读取、持久化、实时投影与正常业务操作链。测试通过只证明所列断言，不等同于所有平台、所有服务状态或任意数据规模都已经实际验收。

后端合同核对了 Chat 后端 的 `gin/api/chat_list.go`、`internal/chat/models.go` 中的 ChatUnreadSnapshot、成员更新/解散入口，以及插件既有 ConversationListPreferenceService。后续按用户要求固定这个基线，不再追踪 dev 的继续推进。没有更改后端接口或复制后端权限判断。

## 已确认问题与修复

| 问题 | 原因与处理 |
| --- | --- |
| Bot 隐藏状态重启后丢失 | Bot visibility 放在 metadata；源会话的后续空增量覆盖了它。改为按 Bot 引用合并，明确删除再清除。 |
| 已读被旧目录响应恢复 | 只比较消息序号无法表示已读进度。使用后端 read_seq，接收 read-ack，持久化到对应源摘要；不使用 unread 数量取最小值猜测已读。 |
| 切账号覆盖待写增量 | 单个待写槽被新账号覆盖。改为按账号合并，单写入者串行冲刷，最多保留 8 个待写账号。 |
| 同步期间偏好变更丢失 | 扫描中直接忽略失效事件。合并为一次后续扫描，保留原 owner 和取消边界。 |
| 新连接拿到旧通知基线 | raw baseline 已结束而后续工作未结束时仍复用结果。后续连接重新建立基线；图片预热不进入通知等待链。 |
| 陈旧可见性引用残留 | 查询期间 sourceRef 已更新仍接纳旧引用。只接纳当前源引用及未被本地更新覆盖的结果。 |
| 头像清除语义混用 | 稀疏实时字段与权威空头像走相同合并。分离装饰确认与实时 upsert，群头像、头像数组都可正确清除。 |
| Bot 头像未持久化 | 原来只缓存 profile image。Bot image 的网络读取使用自己的引用验证；历史字节只按当前账号缓存键读取，普通消息图片保持原逻辑。 |
| 磁盘故障导致头像不可用 | 成功下载后，派生缓存失败又抛出整个读取。缓存故障保留可用图片及最后成功缓存。 |
| 不必要的头像 SQL 扫描 | 未到磁盘预算也扫描全部引用以选择淘汰项。预算以内直接完成，超限时才查询，并保护 Bot 元信息中的头像引用。 |
| 新 Bot 不出现在侧边栏 | 有 Host projection 后直接跳过所有可见性查询。补查 Host 尚未覆盖的新条目，稀疏 Bot 快照增量合并。 |
| Bot 置顶迁移与即时操作 | 旧 Browser 置顶会被 Host 空数组覆盖，新 Bot 尚未进入 Host 列表时置顶失败。逐项迁移，写成功后消费旧记录；缺少条目时从 Bot owner 确认。 |
| 移除操作提前隐藏 | 临时反馈集合参与最终条目过滤。移除成功前保留条目，错误后继续可操作。 |
| 退出/解散群后残留条目 | 原来依赖列表全量替换；增量合并后该机制失效。成功回执产生独立 removedSourceKeys，贯穿 Host、Browser、SQLite；迟到响应不复活，权威重新入群结果可恢复。 |
| 缓存 Bot 引用跨重启失效 | 原 Bot v2 引用是当前进程注册表句柄，不能直接作为持久操作目标。恢复为独立的、账号绑定的目录查询引用，调用时从 Bot 服务重新确认当前目标；原 v2 的过期/注销规则保持。 |
| SDK 修改 Host 内存 | 返回值共享缓存对象。读取和事件边界复制快照。 |
| 取消、焦点和截断不明确 | 调用者取消只脱离等待；虚拟分块保留焦点并提供无 IntersectionObserver 回退；Tool 截断显式标记并给出枚举方式。 |

## 场景到实现与验证的映射

下表中的测试路径均位于 tests/；Host 为 services/conversation-directory-service.ts，DB 为 local-database.ts，Store 为 client/chat-directory-store.ts，Navigation 为 client/ArkmeVirtualWorkspace.tsx。均指当前插件仓 src/ 下的真实实现。

| 场景 | 入口到数据结果 | 验证依据 |
| --- | --- | --- |
| 无缓存首批显示 | sources.list(localFirst) → Host.read → firstPage → Store.applyHostPage → Navigation | services/conversation-directory-service.test.ts：阻塞第二页、头像、写盘仍返回20条；客户端阻塞/放行响应验收 |
| 首次与后台无 loading | Navigation 直接显示已到达条目，失败/重试独立 | arkme-virtual-workspace.test.tsx；真实桌面20帧静默检查 |
| 暖缓存完整目录 | Host.activate → DB.readDirectoryCache → snapshot | local-database.test.ts；Host 完整缓存恢复测试；桌面92条/6 Bot读取 |
| 头像、置顶、隐藏重启恢复 | 账号行、元信息、图片字节分别恢复 | local-database.test.ts；前次真实离线证据保留，本轮新增 Bot 隐藏增量回归 |
| 20条自动遍历超过10页 | Host.startScan 固定页大小并自动游标循环 | Host 测试240条/12页 |
| 缺席保留 | 稳定源键增量合并，不按页缺席删除 | Host 缓存缺席及 Bot 缺席测试 |
| 重复/无效游标 | 扫描失败并保留已成功页面 | Host 重复游标测试 |
| 后续页失败与重试 | phase=failed；保留已展示数据；原重试入口 | Host 后台失败测试、Navigation 失败入口测试 |
| 实时数据早于缓存响应 | Store 按 revision 处理迟到快照，补缺项但不覆盖新项 | chat-directory-store.test.ts |
| 旧消息与新置顶同时返回 | latestSequence 与 policy.update_at 分别比较 | Host merge 测试、chat-directory-store.test.ts 的置顶版本测试 |
| 已读发生在列表返回前 | Host.pendingReadAcks → 按源身份应用 | Host 首屏前 read-ack 测试 |
| 已读后同水位旧刷新 | readSequence 单调保护，继续持久化 | Host read-ack 后刷新测试 |
| 恢复旧消息后未读增加 | read_seq 未推进时允许同消息序号下计数增加 | Host restored unread relations 测试；后端 ChatUnreadSnapshot 合同 |
| 免打扰与普通未读 | projectArkmeChatAttentionFromMuted；保留原通知 owner | chat-directory-store.test.ts、services/chat-realtime-service.test.ts |
| @我、消息撤回/重编辑 | 原 Timeline owner 与通知/已读投影保持分离 | conversation-send-directory.test.tsx、chat-directory-store.test.ts、services/chat-realtime-service.test.ts |
| 扫描中隐藏/找回 | 偏好版本保护 + 单次补偿扫描 | Host 失效事件测试、conversation-directory-visibility-lifecycle.test.ts |
| 引用更新期间查询返回 | currentRefs 和 mutation revision 过滤 | Host 旧/新 sourceRef 查询乱序测试 |
| 移除成功/失败 | 偏好命令回执 → Host确认 → UI更新；失败仍可重试 | chat-directory-pin-ui.test.tsx 的成功/失败交互 |
| 联系人找回会话 | 原 ConversationDirectoryVisibilityService.restoreSource/restoreBotConversation | conversation-directory-visibility-lifecycle.test.ts |
| 退出群/解散群 | GroupService 成功回执 → forgetSource → removedSourceKeys → DB删除/Store移除 | services/group-service.test.ts + Host、DB、Store 显式移除回归 |
| 退出后的迟到页面/实时数据 | 旧扫描 revision 不能覆盖移除；实时数据需要权威目录复核 | Host、Store 群移除测试 |
| 再次入群 | 后续权威列表返回该身份，解除移除并恢复行 | Host、Store authoritative rejoin 测试 |
| 新 Bot 打开即展示 | 新条目补查可见性；不因 Host 快照暂缺而消失 | chat-directory-pin-ui.test.tsx 的 New Bot 真实组件测试 |
| 新 Bot 立即置顶 | pinBot 缺项从 Bot owner 确认，再持久化 | Host newly created Bot 测试 |
| Bot 隐藏增量持久化 | DB Bot visibility 按引用合并 | local-database.test.ts 的 source-only delta + reopen |
| 旧版 Bot 置顶升级 | migrateBotDirectoryPreferences 逐项确认/消费 | bot-directory-preferences.test.ts：部分失败、重试、不重复迁移 |
| Bot 明确删除 | removedBotRefs；清除对应本地置顶/隐藏，不用快照缺席猜测 | Host forgetBot + bot-chat-directory-projection.test.ts |
| Chat Bot 与独立 Bot | 仅同 opaque chatSourceKey 的 Chat Bot 投影普通会话未读；独立 Bot 保留 Record 归属 | bot-chat-directory-projection.test.ts、arkme-bot-service.test.ts |
| Bot 活动与预览新旧顺序 | 独立比较 Bot 消息时间，保留较新内容，不混用源序号 | bot-chat-directory-projection.test.ts、Host.rememberBots |
| 普通 Bot 列表不启动侧边栏 | rememberBots 仅处理已激活的目录 owner | arkme-bot-service.test.ts 的精确请求序列回归 |
| Arko/发给自己不串账号 | 原入口取数据后按 captured userId 投影 | Host late special/visibility account 测试；arkme-persistent-sidebar.test.ts |
| 账号切换时旧页返回 | owner generation + AbortController | Host reset/旧账号页测试 |
| 切账号时仍有待写数据 | 按账号 coalesce，保存原 userId 后串行写入 | Host delayed disk + switchUser 回归 |
| 单个读者取消 | 只移除自己的等待，其他读者和后台扫描继续 | Host aborted caller/shared first page 测试 |
| 本地置顶写失败 | 回滚本地投影并返回明确错误 | Host disk-full pin 测试 |
| 新旧通知连接 | 原 ChatRealtimeService 校验连接/账号代次；已完成基线不供后续连接复用 | services/chat-realtime-service.test.ts；Host later connection 测试 |
| 头像下载、落盘失败 | 媒体 owner 保留最后成功字节，缓存失败不破坏下载结果 | services/media-service.test.ts 的 cache read/write fault |
| Bot 离线头像及账号授权 | 当前账号 DB 行可读取历史字节；网络读取仍验证进程引用，不复用过期上游 URL | services/media-service.test.ts 的离线、异账号测试 |
| Bot 缓存引用重启后使用 | BotService.restoreDirectoryBots → 账号签名的目录查询引用 → openDirectoryBotRef → 当前 Bot list → 当前 target | services/bot-service.test.ts：重启、旧句柄仍过期、目标从 Subject 变为 Chat、篡改/异账号/已删除拒绝 |
| 稀疏头像与权威移除 | 仅 hydration 确认清除；消息增量不代表删除 | Host sparse avatar / removed group avatar；Store Host-delta 清除 |
| SDK 快照可变性 | 受控输出复制 | Host consumer mutation 测试 |
| SDK/Tools 边界 | provider capability、公开 SDK、原 grant/正式 ToolRuntime | tools/directory-runtime.test.ts、tools/registrar.test.ts；桌面真实 Host 调用 |
| Tool 有界结果 | truncated 与普通游标枚举提示 | tools/directory-runtime.test.ts：80条缓存只输出20条 |
| 大列表与键盘焦点 | 20行分块、相邻窗口、选中/聚焦保活；无 IO 时完整可达 | arkme-directory-window.test.tsx |
| 普通收发、富媒体、群操作 | 业务命令 owner 不变；派生缓存错误不改变已成功命令结果 | conversation-send-directory.test.tsx、services/group-service.test.ts、完整测试套件 |

## 复杂度与边界

未新增依赖、定时轮询器、第二个目录扫描 owner 或独立同步状态机。保留的状态分别表达账号代次、扫描/首屏完成、已确认读游标、偏好 mutation、明确成员移除和待写增量；这些事实不能合并成一个“更新版本”。新增成员移除字段是成功业务回执的投影，不是靠分页缺席推导的删除。

目录仍有20,000行/32 MiB持久化预算，头像256 MiB、单图8 MiB；待写账号最多8个，超限显式拒绝缓存排队，本地置顶不得伪装保存成功。以上是保护上界，不表示已完成上界账号的长期压力验收。测试未连接生产账号执行发消息、退群、解散或修改服务端隐藏/置顶；对应写场景通过真实实现和受控服务边界测试验证。Windows/Linux 本轮未实机运行，不声明跨平台零回归。

## 最终验证记录

- 固定审查基线：5581c826f01f39467a7cd2f6e6e6bc54ac00b348；未继续追随 dev 推进。本报告映射 45 个场景。
- 最终完整套件：433 个测试文件通过、4 个文件跳过；4786 项通过、6 项跳过。另有客户端同版本官方 Session ToolRuntime 对真实 Host 的验收测试通过1项。
- typecheck、构建、Windows helper 产物静态校验、pack、diff-check 通过；版本、依赖与根 README 相对固定基线没有本任务修改。
- 不可变验收制品：sidebar-review-8ffd7652c6c49ec5.tgz，12,030,891 字节，SHA-256 `8ffd7652c6c49ec5919227a614cfa315c6c121a233f6660d6186c75c4b2c169c`。运行时代码未包含本机源码路径。
- macOS 隔离客户端：首次目录响应恢复92条源会话、6个 Bot，6个 Bot 均使用缓存目录查询引用；完成服务端同步后仍为92条/6 Bot。
- 仓外 Consumer 通过公开 SDK 入口完成目录读取及本地 Bot 置顶/恢复往返；缓存 Bot 引用通过真实 Host 成功打开当前 Bot 会话（该目标返回0条消息）。
- 使用客户端同版本的官方 DSH Session ToolRuntime 0.1.1-rc.2 发现并执行目录 Tool：缓存92条、输出20条、明确标记截断。
- 实际页面：首次请求被阻塞时0条会话且无 loading/骨架；放行后展示，连续20帧后台同步无加载提示。
- 制品在带客户端完整同版本 Harness 模块的隔离 Profile 验证。首次裸 Profile 缺少 Host peer 的启动失败与补齐日志保留；正式验收采用完整 Host 装配。
- 冷暖耗时沿用前次报告，仅作为历史结果；本轮没有将历史数字当作重新测量的数据。

已复现的问题均已修复；当前分支所列场景中未发现剩余的已确认业务阻断项。合并判断以本报告的场景、版本与验证环境为界，Windows/Linux 实机及上界规模的长期压力测试仍未完成。
