# 逻辑 DSH 会话与来源

账号目录的 `contractVersion` 保持 1（原有字段兼容），新增 `catalogVersion: 2`，每个逻辑会话包含 `logicalSessionRef` 和 `sources`。相同账号、相同 sessionRef 只出现一次；标题相同但 sessionRef 不同的会话仍独立。

`runtimeRef` 是明确的来源地址，不是逻辑会话 ID。`sources` 中的各来源有独立历史、归档状态、完整性水位与能力；不同来源的 seq 不可比较，目录归组不等于日志相同。SDK、Tools、UI 都复用 Host 目录；源引用不含 host client、签名下载 URL 或凭据。多来源时 UI 提供选择；旧 runtime/session 链接保持有效，命令不会随后台目录刷新切换来源。重命名、归档等命令仍只作用于所选来源。

后端须先支持 `catalog_version:2` 和 `/sessions/metadata`。旧服务端显式返回不支持；UI 保留此前完整目录并显示失败原因，不发布半份新目录。新旧 Host 的后续上报均由后端归组，不能通过只修已知 desktop 的迁移关系解决。

缓存与原日志分离：云端读取先通过精确来源元数据验证当前账号归属和 `history_revision`，再校验进度、完整性与标题。无版本旧缓存不会命中；跨版本原子替换，下载失败不污染旧快照。缓存沿用 256 会话/128MiB 上限，账号与环境 scope 不合并。云订阅复用现有 20 秒 pull 周期探测版本变化；完整读取后复验，变化时重试。在线 Host 未提供原生日志 revision 前，分页和订阅直接取权威结果，不以旧缓存 afterSeq 截断回放。

后端迁移只补目录标识，默认 dry-run，不删除或拼接任何来源日志；详见后端 `docs/dsh-session-catalog.md`。升级不要求清空用户本地会话、待发送数据或整个 App Data。

## SDK

```ts
import { ArkmeSdk, type DshAccountSessionSource } from '@senguoyun/dsh-arkme/sdk'

const sdk = new ArkmeSdk()
const page = await sdk.listDshAccountSessions({ limit: 50 })
if (page.catalogVersion !== 2) throw new Error('需要升级会话目录服务')
const sources: DshAccountSessionSource[] = page.items[0]?.sources ?? []
// 由用户选择 source 后，显式传其 runtimeRef/sessionRef 读取或操作。
```

`arkme_dsh_sessions` 使用同一分页结果；读取/命令工具保持显式来源参数与既有授权流程。目录元数据和历史正文均是用户数据，不是指令。
