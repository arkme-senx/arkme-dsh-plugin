# 目录读取恢复：最终分支审查

2026-09-09。继续原任务分支 `codex/c20260909-dsh-read-recovery`，不新建业务目录、不合并目标分支、不发布生产。

## 审查范围与基线

- 插件完整分支相对 `origin/dev 4ff14178c2fb44ec932fbd963a08ec6c7e4c3a8c`，已在原分支无冲突合入该基线；不仅审查上一轮 UX 补丁。上游主题选择、通话菜单和成员名称改动纳入全量回归，不算作本任务新功能。
- Chat 相对 `origin/master d5786e6bec2399e4a209a71a497ac234d63c649c`；本轮没有新增服务端改动。
- Flutter 相对 `origin/pre-release 1de25ef0ca4c508a2b12744ef79c64469e8856dc`；仅既有兼容测试提交，`lib` 无差异。
- meta 相对 `origin/master f28fa725db7787d85b231895b27f39d2523835fd`；维护本次同一个 OpenSpec change。

## 审查 / 修复循环

| 确认的问题 | 触发与用户影响 | 最终修复与证据 |
| --- | --- | --- |
| P2：合并扫描丢失刷新语义 | 普通快照超过30秒后开始扫描，显式刷新加入该扫描；新页正确但旧游标仍有效，与刷新合同不符 | `DirectorySnapshotStore` 将刷新意图合并到同一 scan，成功后精确失效同 key 旧快照；不新增扫描或第二套缓存。确定性测试先红后绿 |
| P2：不同消费面矛盾参数校验不一致 | SDK/Tool 拒绝 refresh+cursor，公共分发却可能交给 Team/Audio owner 各自忽略，导致“刷新”的真实含义不一致 | `readDirectoryPage` 在 owner 分发前统一拒绝；五栏目测试确保业务 owner 没有被调用。直接调用 ContactDirectoryService 的既有保护保留 |
| P2：联系人详情取消链断开 | UI 已传 AbortSignal，Host 的 profile/world/open-chat 分发却漏传；关闭详情后纯读恢复可能继续占资源 | 仅补传到已有参数，不改变业务接口，不自动重放写操作。Host 信号回归先红后绿；无 signal 的原测试保持身份裁剪断言，只更新可选参数调用形状 |

复审修复后再执行全量测试。第一次全量仅旧 Host 调用形状断言因新增可选 signal 失败；修正该断言后第二次全量通过，没有删除业务断言。最终源码修复只涉及公共分发、Host 参数转发、快照 owner；其余是针对性测试及证据文档。

## 场景 → 实际代码 → 验证

| 场景 / 边界 | 主链路与不能混淆的语义 | 验证 |
| --- | --- | --- |
| 打开、展开五栏目 | `ContactDirectorySurface` → Host `directory.list` → `readDirectoryPage` → 各自 owner | 最终 tgz 的实际 DSH 页面；五栏目 SDK 和官方 Session/ToolRuntime 调用 |
| 群聊列表、分页、计数 | `SourceService` → Chat list；群聊 partial 是分页进度，不是联系人缺源 | 真实 Chat SDK 分页、Mongo list/display、页面展开 |
| 联系人首次读取、去重、私聊补充 | `ContactDirectoryService.loadMergedContactDescriptors` → contacts + direct union | 真实 Chat/Mongo，双源与资料页读取、同目标去重和部分失败测试 |
| 真空列表、缺源空列表、畸形响应 | 只有完整空结果可显示原“暂无联系人”；技术失败不能成为权威空集合 | reducer/Host/owner 测试；真实缺源故障保留原行；Auth 畸形 items 不负缓存 |
| 身份成功但资料短暂失败 | Chat 拥有身份，Auth 拥有公开资料；`ServiceRuntime.registeredRead` → Coordinator | 资料失败两次后成功、三次耗尽后保留旧姓名、非可重试错误不吞；联系人详情经真实 Host 分发 |
| 普通翻页、搜索、后页选中项 | IO 滚动边界只驱动可见正常栏目；搜索继续必要完整遍历；成员全集完成后才可判不存在 | 组件测试与61 Bot 实际页面；无“加载更多”；隐藏/重复 observer、搜索不完整、刷新选择回归 |
| 快照30秒新鲜度 / 30分钟分页保留 | 签名游标绑定账号、section、snapshot；最多四份，不跨快照拼页 | 31秒后续页、容量淘汰、账号/revision fencing、普通读与刷新竞争测试 |
| Bot / Audio / Team | Bot 用独立快照；Audio 的整体 projectionState 不套联系人逐页健康；Team 用 OpenAPI 独立凭据 owner | 三个真实业务适配器、技术故障恢复与未知业务拒绝测试；上游为 fixture，不称远端验收 |
| 切号、登出、短 token 刷新 | session owner / scope epoch / UI generation；旧结果不归入新账号，短 token 更新不当切号 | runtime、snapshot、UI 测试；真实 Host 使用两个合成账号验证旧游标拒绝 |
| 一名观察者取消 / 最后一名取消 | Coordinator 和 snapshot 共享只读，最后观察者离开才取消；详情 signal 不断链 | 单飞、取消、dispose、Host 转发测试 |
| 原业务写入、加入、创建 | 只登记纯读恢复；Team 写后在原 scope 失效旧 flight；不复用读恢复重放写 | runtime、Team、Host 与目录写测试；本轮未修改服务端写逻辑 |
| 短竞争、持续竞争、限频、Redis 异常 | Chat guard：原 key/token 的单执行租约 → 原5rps预算 → handler；等待750ms，最多128实例等待者/8用户等待者 | 真实公开路由区分 concurrency/rate，真实 Redis race/旧 token/IO deadline；无共享业务结果 |
| 取消、续租丢失、迟到准入 | datastore adapter 取消 work context，compare-token 有界清理；不误删别人的租约 | 既有确定性迟到、续租失权、取消与 Redis 测试复跑 |
| 未读页、全量 badge、静音/通知关闭 | repository 仍完整扫描轻量事实，复用 `includeUnreadItem`；只返回页装饰，不以分页代替通知 baseline | 29项 Mongo 定向，真实 list/unread E2E；Record 实际停机后目录仍可读 |
| 服务端先发、旧 Flutter | HTTP200/code1002/message/data不变，新增可选 error；Flutter 仍按旧 code/data 分支 | 原 pre-release 解析代码逐条核对，173项合同/未读测试；未知 error 枚举不改变旧行为 |
| SDK / Tool 的权限边界 | 公共 SDK feature 检测；官方 ToolRuntime 发现并调用同一 owner；opaque ref 不作为后续写授权 | 包外 SDK Consumer，真实 Chat 联调中的五栏目 Session/ToolRuntime；未暴露 token/原始身份数据 |

## 本轮执行结果

- 插件全量：477文件通过、5跳过；5520项通过、7跳过。跳过项含必须显式指定环境的验收，另行运行对应 live 用例。
- typecheck、build、pack 通过；未改版本号、根 README 或 DSH 源码。
- 相关修复 + 真实 Chat 联调：105项通过，含官方 Session/ToolRuntime→真实业务 owner→Chat/Mongo/Redis，以及资料详情→Host。
- Chat `go test ./gin/... ./internal/... ./pkg/...` 通过；未配置 Mongo 的原生测试跳过，不冒充真实 DB 证据。
- 显式本地 Mongo 定向29项通过；真实公开路由/list/unread E2E 6项通过。慢场景 `TestChatListDoesNotDependOnRecordService` 单独启用并通过，确实停止/恢复本任务 Record 容器。
- 真实 Redis `-race ./pkg/datastore ./gin/response -count=1` 通过；backend guard failures=0/warnings=0。
- Flutter 173项通过。第一次默认 pub 因本机失效代理失败；复跑使用 `--no-pub` 的现有依赖。无 Flutter 源码、锁文件或运行时变更。
- 最终 tgz：`dsh-arkme-premerge-final.tgz`；SHA-256 `329bd22e9fcc9845eebfff3a5bc2a112e2782fdfd9c96fca384c8413c4c0f746`。在原隔离 Profile 通过官方 plugin CLI 安装；非 link/source overlay。
- 最终包浏览器验收通过，配套 live 用例1项通过：五栏目展开；Bot 首屏50条，停留超过30秒后滚动自动补到61条，没有“加载更多”按钮；搜索第61条仅返回该行；联系人详情显示正确昵称和备注。注入 direct 来源持续失败后，原2名联系人仍保留、总数显示未知，不出现“暂无联系人”；恢复接口并刷新后恢复完整计数2且提示消失。本次故障注入只作用于隔离夹具，不涉及线上用户。
- 本地日志前缀 `/tmp/dsh-final-review-`：`plugin-full2`、`plugin-typecheck`、`plugin-build`、`live`、`mongo`、`race`、`chat-e2e`、`record-outage`、`flutter`、`backend-guard`、`install`、`browser`。源码库保留复跑入口，不把本机临时路径作为产品运行依赖。

## 发布裁决边界

本轮确认的代码问题均已修复并复验。保留原“先 Chat，后插件”的发布顺序，无迁移、灰度开关或中间兼容态；回退不需要回滚业务数据。

这不等于“整个系统已无条件可上线”。此前报告的完整 Mongo sweep 11项失败与 Flutter landing controller 4项失败，未在本轮通过修改无关业务强行清零；旧对照不能冒称最新目标基线全绿。Auth/Bot/Audio/OpenAPI 真正远端、生产用户4 trace、Windows/Linux 实机也未在本轮验证。联系人世界、发消息、音视频等未修改的旁支未在本次浏览器夹具开放，不以目录/资料验收替代这些能力全量验收。若以上属于此次发布的必选门禁，发布结论仍需保留阻断，不能用单测数量代替真实验收。
