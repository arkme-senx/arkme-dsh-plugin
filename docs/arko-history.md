# Arko 历史读取

Intelligent 是消息正文与可见权限的唯一事实 owner；ArkoService 统一提供 Host、UI、Tools、SDK 读取。历史读取不会创建 Arko 会话或恢复 Run。搜索为逐请求一致的实时分页，已扫描正文后来变化时需要重新搜索。

## 公开消费合同

SDK 使用 `@senguoyun/dsh-arkme/sdk` 的 `createArkmeSdk()`，先探测 `capabilities().features.arkoHistoryReadsV1`；类型从同一入口导出。所有调用接受 AbortSignal，取消即释放本次读取。每次调用重新校验账号作用域，无常驻 SDK 订阅需要清理。

```ts
import { createArkmeSdk } from '@senguoyun/dsh-arkme/sdk'
const sdk = createArkmeSdk()
const page = await sdk.arkoSearch({ keyword: '字面正文', role: 'assistant', limit: 20 }, signal)
// 零匹配也可能有下一页；续页保持 keyword、role 和时间范围不变。
const match = page.items[0]
if (match) await sdk.arkoContext({ messageRef: match.messageRef, before: 20, after: 20 }, signal)
const exported = await sdk.arkoExport(signal)
const downloadURL = sdk.localFileUrl(exported.fileRef, true)
```

`arkoMessages` 是 keyset 分页；`arkoSearch` 返回片段和不透明消息引用；`arkoContext` 返回原文和独立的双向历史窗口。startAtMillis/endAtMillis 是历史排序时间的左闭右开范围。消息显示时间保留既有 send_at 优先规则，orderAtMillis 用于历史顺序和日历；两者不同会在定位与详情中说明。搜索片段不用于替代正文。Arko 不暴露 reasoning。

`arkme_arko_history` 正式注册到 business/hybrid 工具集合，action 为 query/search/context/export。它是只读工具，无写入 grant。工具正文预览有明确 textTruncated 标记；完整原文通过导出文件读取。工具不返回上游凭据、存储路径或内部查询参数。

## 下载与消息操作

Jotmo 后端不生成文件，不全量缓存历史。导出先分批读取并释放每批 DB 事务，再传输正文；结束前在一次只读 RR 中核对已发送的全部源事实（含原正文）与完整可见集合，匹配才确认完成，不匹配要求重试。用户设备的插件负责生成 Markdown，收到并校验完整完成帧后才发布下载引用。NDJSON 版本为 arko-export-v1，顺序为 start、item、complete。count、bytes、sha256 覆盖每条 item 的原始 UTF-8 JSON 行，包含 LF，禁止重新序列化后计算。Host 验证后才发布账号/Profile 绑定、限时的生成文件引用。最终一致性核验失败、缺失 complete、摘要/数量不匹配、取消、账号切换或磁盘失败均不发布产物。生成文件独立于附件上传限制和队列。

新历史消息操作使用短凭证，包含正文及必要展示事实的摘要。操作时通过 ArkoMessageActionReader 批量重读当前 owner，重新校验归属、场景、状态和摘要；内容变化时要求刷新，不能静默改成另一份正文。最多 100 条同次读取，不做逐消息 SQL/HTTP，不持久化正文副本。历史 QA 的可展示、可转发与 Agent 可复制链接权限分别判断。旧已发布读取与其他消息 owner 的操作协议保持原合同，新入口无 offset 全扫描回退。

## 能力覆盖与验收入口

| 能力面 | 入口与权限 | 验证 |
| --- | --- | --- |
| UI | 最新历史、搜索、月历、原文定位、完整导出；当前账号只读 | 页面交互、Run/滚动隔离、草稿与当前会话发送、真实 DSH 页面验收 |
| Tools | arkme_arko_history；business/hybrid 正式集合 | 官方 ToolRuntime 和真实 SessionStore 中发现、调用、失败 Schema |
| SDK | arkoHistoryReadsV1、公开类型和 AbortSignal | 不可变 tgz 的仓外 TypeScript Consumer 编译与调用、缺失能力拒绝 |
| Host | ArkoService、MessageActionService 共享 owner 权限与接口 | 有界读取、短凭证批量复核、流完整性、账号切换、磁盘失败与上传隔离测试 |

主要测试：tests/services/arko-history.test.ts、tests/arko-history-action-references.test.ts、tests/arko-history-sdk-tools.test.ts、tests/tools/arko-history-runtime.test.ts、tests/arko-history-tools.test.tsx、tests/arko-message-detail.test.tsx、tests/generated-artifacts.test.ts。

服务端复用 messages/sessions/qa_ref 和现有索引；无新表、集合、索引、明文搜索副本、持久导出任务或新增配置开关。DSH 使用公开 WebServer 路由扩展点，未修改官方运行时。macOS 已做本地包验证，Windows/Linux 实机运行仍需对应环境验证。
