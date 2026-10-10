# 消息窗口缓存与校准

私聊、群聊的统一时间线由 `UnifiedChatTimelineService` 统一负责。Browser UI、`arkme_source_read` Tool 和公开 SDK `readChatTimeline` 共享授权、窗口校准、缓存提交与错误语义。桌面客户端继续使用既有 Harness/Browser module 合同，无新增原生桥。

## 数据与一致性

- 缓存位于配置的 `fileStateDirectory/timeline/chat-timeline-v2.sqlite3`，由单一 Worker 持有；账号、环境和会话共同隔离数据。
- 正文按稳定事件身份去重，窗口存事件引用与服务端 coverage。正文版本、请求 ticket、账号 epoch 和会话失效围栏共同阻止旧响应覆盖新状态。
- coverage token 随窗口引用保存，不随共享正文串到其他窗口；完整校准发生删除时持久化会话围栏，拒绝删除前发出的迟到请求。
- `reconcile: true` 在 Host 内遍历 refresh 页，并可通过 `newerCursor` 追赶尾部；读取完整后一次事务提交，再读取已提交投影返回。空过滤页继续跟随服务端 cursor，重复 cursor、超时、取消和容量超限显式失败。
- `gap` 保留其覆盖范围内已有正文和窗口 token，不表示同步完成；只有校准覆盖且来源已就绪的缺席才删除对应引用。来源 `not_applicable` 清除该来源的缓存引用，终态 Realtime hint 先隐藏旧正文。
- Realtime 登记失效，既有可见窗口刷新负责读取真相；没有新增全账号历史轮询。发送与 outbox 继续由原 owner 负责。
- v1 文件保留，v2 缓存可重新建立；草稿、发送队列和 canonical Record 库不参与缓存迁移。回退旧版本时仍可使用其原缓存。

## 公开调用

能力发现增加 `features.durableChatTimeline`。SDK 对 `reconcile` 和 `anchorId` 请求检查该能力，旧 Host 显式返回不支持。

| 参数 | 语义 |
| --- | --- |
| `cacheOnly: true` | 读取本地已提交窗口；未命中返回 `chat-timeline-cache-miss`，不会冒充空历史或自动发网络请求 |
| `anchorId` | 仅限本地读取，选择实际覆盖该事件/行身份的缓存窗口；不拼接不相邻页面 |
| `mode: 'refresh', reconcile: true, windowTokens` | 在 Host 内完成当前窗口校准；不接受外部 refresh cursor |
| `newerCursor` | 仅用于 reconcile，将尾部追赶纳入同次提交 |
| `limit` | 远端每页 1–100 条，完整本地/校准结果最多 2,000 条 |

返回 `cache.origin` 区分 `local/network`，`cache.persistence` 区分 `committed/unavailable/deferred`；`revision` 是本地提交顺序，`stale` 表示窗口晚于提交发生失效。它们均不是服务端 seq、已读 ACK 或多来源同步 checkpoint。普通单页 refresh 返回 `deferred`，不会被记为完整校准。存储失败时网络读取仍可返回 `unavailable`，UI 会提示；Worker 故障后本次 Host 生命周期保持此降级，重启可恢复缓存。

## 阅读位置与展示

- UI 先读取锚点覆盖的本地窗口，再后台校准同一范围；保存稳定行身份、像素偏移和底部跟随状态。
- 账号和窗口分别隔离；主窗口与独立会话窗口使用不同 viewport namespace。localStorage 只保存阅读位置，不保存消息正文或凭据。
- 显式定位优先于缓存锚点。历史 token 失效时，只有具备可信 record owner 的消息才通过 around 重定位；不能定位时保留阅读状态并提示，不擅自跳到最新。
- 统一聊天按 40 条分块，最多 5 个可见块加 1 个恢复目标块；离屏媒体与反应子树卸载，动态高度由 ResizeObserver 记录。选择文本时暂缓替换可见块，选择结束主动恢复更新。原非聊天列表保持原结构。
- 主列表与预览共用 Host 和窗口组件；预览不触发会话激活或已读确认。

## 性能与生命周期上限

| 资源 | 上限/释放 |
| --- | --- |
| 完整窗口 | 2,000 事件、500 token、4 MiB；远端最多 500 页、总 deadline 不超过 30 秒 |
| SQLite | 256 窗口、64 MiB 正文和窗口 metadata 预算；最多 32,768 数据库页；WAL 自动 checkpoint、8 MiB journal 回收目标；关闭时 truncate checkpoint |
| Worker | 每 Host 1 个；最多 32 pending、64 MiB 估算排队字节、单命令 8 MiB 估算/100,000 遍历节点、5 秒等待；卸载按 FIFO 关闭或超时终止 |
| Host 已知会话 | 512 条；账号切换/卸载清理，旧任务不能发布 |
| Realtime 失效 | 最多 512 个待处理身份，重复 hint 合并后串行写 Worker；本地读取等待失效落盘，溢出时禁用本次 Host 缓存避免展示已撤权正文 |
| UI 内存 | 20 会话且正文估算不超过 32 MiB，LRU 淘汰 |
| Viewport | 每 namespace 40 会话、每账号最多 40 namespace、单 envelope 64 KiB；250 ms 合并写，pagehide/unmount flush |
| DOM | 长窗口最多 240 消息，observer/RAF 随卸载释放；选择文本时暂缓窗口切换 |

上述字节预算是数据结构预算，不等于整个进程 RSS。SQLite 页索引与 WAL 有额外空间；`max_page_count` 是物理数据库硬边界。缓存未变化时只更新 ticket/touch，避免重写所有窗口 metadata；写入、JSON 序列化和数据库清理均在存储 Worker 完成。Host 仍有有界投影、跨 Worker admission 计数及网络响应处理。

稳定事件锚点使用 `entries(scope,event_id)` 索引；旧版 item 身份回退只扫描一次 canonical 正文。gap 保留通过事件身份去重，避免正文解析次数随重叠缓存窗口数相乘。相关负载、边界和审查结果见 [性能复查记录](local-timeline-performance-review.md)。

## 验证入口

1. `NODE_OPTIONS=--no-experimental-webstorage pnpm test --maxWorkers=2 --testTimeout=30000 --hookTimeout=30000`：完整回归，包含缓存版本/撤权/重启、原子失败、账号/取消/Realtime、UI 阅读位置和正式 DSH ToolRuntime 会话调用。仓库的录音导入与日历滚动整合测试可能超过默认 5 秒，使用 30 秒执行上限；功能断言保持不变。完整测试自身会重建 lib，须与独立 build/pack 串行。
2. `pnpm typecheck`、`pnpm build`：构建会验证编译后的 Worker 在带空格目录完成 commit/read/close。
3. `pnpm pack --pack-destination <artifact-directory>`；通过官方 `dsh plugin --profile <isolated-profile> add <artifact.tgz>` 安装。
4. `node scripts/verify-unified-timeline-consumer.mjs <isolated-profile-directory>`：仓外 SDK Consumer 编译、调用、取消与能力不支持路径。
5. `tests/fixtures/timeline-cache-window-entry.tsx`：真实浏览器合成 2,000 条不同高度消息，检查切换、正文刷新、重新加载、锚点和挂载行数。

以上使用隔离 fixture。真实账号数据、已安装桌面客户端以及 Windows/Linux 目标环境仍需各自验收，不以 macOS 本地测试代替。
