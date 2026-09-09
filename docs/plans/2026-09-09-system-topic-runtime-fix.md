# 系统主题读取与布局修复

## 范围

只修主题体验、浏览器读取及本地事件传输；不实现人工输入来源识别，不改 DSH 本体，不新增配置、版本或持久化字段。主题归档和已有快记重编语义不变。

## 原因与设计

- 底部原先是无布局容器的文本和原生 checkbox；设置尚未读到时还会把未知值画成 false。现在复用 Arkme theme，使用完整 footer、说明、间距和独立的读取/错误状态，未知值不显示假开关；源切换重建设置实例。
- 交互读取原先没有包含浏览器排队时间的截止期限。列表、时间线、主题开关读取复用同一 30 秒可取消 read helper；时间线空列表读取失败有显式重试。写请求不自动重试、不被该 helper 超时取消。
- `source.timeline` Host 分发漏传已有 request signal，现在将浏览器断开传递到同一个服务 owner。
- 隔离 Chrome 可复现：同源六条 SSE 持续占用 HTTP/1 连接时，普通读取根本未到达服务器；释放一条后立即恢复。旧插件每页持有自己的 SSE，叠加 Harness HMR 会占满池。仅设置超时不能解决该路径。
- 插件事件通道改走官方 `webServer.registerUpgrade` 的 WebSocket，保留同源/回环访问约束、原事件 schema、隐藏页通知、断线后的已有 reconcile 和账号卸载清理；ping/pong 回收失联连接，浏览器端统一重连。事件通道仅下发消息，拒绝客户端业务命令；不保留 SSE 过渡分支。
- 上游 IM/Agent 的 SSE 是不同的业务链路，未改动。Harness 自己的 HMR 连接也未改动，因此不能声称消除了任意数量 Host 标签页下的所有 HTTP 资源限制。

原截图发生时的网络现场未完整留存；上述连接池阻塞路径已复现，但不将它宣称为原截图唯一可能的触发原因。

## 能力面

| 消费面 | 变化与验证 |
| --- | --- |
| UI | 设置布局、读取截止期限/取消/重试、本地事件传输；真实 Chrome 包验收 |
| Tools | 无新业务能力；原首页开关 Tool 通过官方 DSH 会话发现和调用验证 |
| SDK | 无新业务能力；既有首页开关 SDK 与 UI/Tool 共用原 owner，跨仓验收 |
| Host owner | 不新增业务查询/命令；原时间线传递取消信号，事件只换浏览器传输 |

## 验证证据

- 插件全量测试：5480 通过、6 按现有规则跳过；最后局部复验包含传输、取消、Host 和设置行为。
- `typecheck`/`build` 通过；正式 `.tgz` 安装到全新带空格目录的 Profile，安装的 Host/Client bundle SHA-256 与构建产物一致。
- 使用未修改官方 DSH `d347e703`（0.1.3-alpha.1），通过既有跨仓 runner 启动真实 Record API/Mongo/Redis、隔离身份 fixture 和 Chrome。
- 三个同源页面均实际收到 WebSocket reconcile；主题读取不再被插件 SSE 占用卡住。人工阻塞时间线时检查 skeleton 下 footer 的高度、宽度及开关位置，并截图验收；注入读取失败后点击“重新加载”恢复。
- 原始归档、只读主题、首页策略经 UI/SDK/Tool 持久化、已有快记重编及重编后无新增入口均通过。
- DSH tracked 源码无改动；未替换或重启用户常驻实例，未使用真实账号做业务写入。

复验入口为 `scripts/run-dsh-input-e2e.sh`，见 `tests/e2e/README.md`。可选 `ARKME_E2E_SCREENSHOT` 指定本地验收截图输出路径。不把本地依赖路径、端口、凭据或调试状态写入产品配置。

## 最新开发基线复核

以普通 merge 合入 `dev@1fdae5e`，它已经包含 `master@537a8b0` 的发布内容。原有开发 PR 目标仍为 dev，本次不调整 PR 目标、不发布。包版本 0.1.50 来自合入的上游发布提交；任务相对 dev 不改版本、根 README 或 lockfile。

六个冲突文件逐项收口：`arkme-service.ts` 与 `types.ts` 保留双方能力声明；`ArkmeSidebar.tsx` 同时保留通话详情和系统主题能力；事件 Host 保留上游 `providerInstanceId` 并通过 WebSocket 传输，客户端保留实例代次、旧事件拒绝、重连补读和聚焦恢复；事件测试保留这些断言，不恢复旧 SSE 实现。

| 边界场景 | 代码 owner | 复核 / 验证 |
| --- | --- | --- |
| 同名普通主题不能被误判 | `topic-policy.ts`、`dsh-agent-input-source.ts` | 容器 kind 与记录 creationSource 分离；policy/search 单测 |
| 新增、转发、拖拽、子主题与重编 | `ArkmeSidebar`、source-tree、SourceService → Record mutation guards | policy、drag、conversation、真实 Chrome 无输入与重编验收 |
| 首页开关只更新偏好 | UI / SDK / Tool → ArkmeService → SourceService → 原 Record policy API | 原字段不重放；真实 SDK/Tool/UI 共用持久化验收 |
| 读取超时、换主题、关闭界面 | read-deadline → Host request signal → SourceService / ChatService | timeline 与 preference 信号转交测试、过期读取取消、UI 重试 |
| 已提交偏好写入时关闭设置 | SourceService 写入仍完成并刷新投影，不附加 UI 读取取消信号 | 新增读/写取消语义测试，旧 policy payload 测试仍验证无 title/privacy 字段 |
| 多标签、Host 重启、重连、旧事件晚到 | `ArkmeRealtimeEvents`、`connectArkmeRealtime`、原 realtime client owner | 三同源页面真实 reconcile；新实例低 revision、旧实例拒绝、同实例有序、慢 provider lookup、重连补读测试 |
| 跨域与资源释放 | 原回环/Origin 校验、receive-only WS、Cordis disposer | 跨域 403、客户端业务帧拒绝、unsubscribe/close、账号卸载测试 |

本轮发现的偏好读取取消断点由两条失败测试先复现，再补通 Host → facade → source owner；写入保持原来的持久完成语义，不自动重试。最终不可变包通过官方 CLI 安装到带空格的全新 Profile，压缩包内 Host/Client bundle 与实际安装内容一致。真实 Chrome + 官方未修改 DSH + Record/Mongo/Redis 验收通过，身份与无关 Chat 是隔离 fixture，不是生产账号验收。

最终包 SHA-256：`38e0002555c3ea2d6cc879ac152a36486de43372085177d66a4cebca480981f4`。不将开发构建目录作为产物校验锚点：部分全量测试会重新 bundle，验收以压缩包和实际安装内容为准。

最终复跑结果：487 个测试文件通过、6 个按现有规则跳过；5635 个测试通过、8 个跳过。TypeScript typecheck、构建/打包、正式包跨仓 E2E 均通过。审查中新增的取消测试曾失败，修复及既有断言的可选 signal 参数对齐后，全量再次通过；没有通过删除业务断言或新增 skip 消除失败。

发布边界：未修改 DSH 本体、未替换常驻 Profile、未操作生产数据。Windows/Linux 和原安卓现场未在本轮运行，不能把 macOS 隔离 Chrome 的结果当作这些环境已验收。严格人工提交来源识别和历史误收录清理仍不在本次范围。
