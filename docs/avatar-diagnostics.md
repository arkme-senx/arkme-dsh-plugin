# 头像失败诊断日志

诊断标记：`[ArkmeAvatarDiag]`。仅追加失败日志，不修改头像展示、缓存、并发限制或重试策略。
需要发布包含本改动的插件后才生效；不自动修改本机已安装包。

## 下次复现时

先保留日志、记录发生时间和目标用户，再重启客户端，避免丢失故障现场。
macOS 生产版日志位于 `~/Library/Application Support/Arkme Harness/`：

- `logs/desktop-startup.log`：Browser 头像加载失败，由桌面壳捕获 renderer console。
- `logs/harness.log`：Host 资料请求、头像引用和图片读取失败。
- 账号隔离实例的 Host 日志可能位于 `dsh-containers/<scope>/logs/harness.log`，具体以启动日志中的实例路径为准。

先筛选 `[ArkmeAvatarDiag]`，再按发生时间、`viewerUserId` 和 `targetUserId` / `referenceTargetUserId` 对账。
例如 1D3E 的目标用户 ID 是 `21698`。批量资料失败的目标位于 `targetUserIds`。

| event | 含义 |
| --- | --- |
| `profile_fetch_failed` | 批量资料请求失败，尚未生成头像引用 |
| `profile_missing` | 成功响应漏掉了请求的用户资料 |
| `profile_avatar_rejected` | 非空头像值被地址安全校验拒绝 |
| `private_avatar_seal_failed` | 私聊头像引用生成失败 |
| `image_read_failed` | Host 最终无法读取用户头像 |
| `image_load_failed` | Browser 头像共享缓存收到加载失败 |

`trigger=load` 表示普通加载，`revalidate` 表示重验证；不代表新增重试。
`hasCachedImage=false` 表示这次失败没有旧图片可保留，可能显示默认头像。
`durationMillis` 包含排队时间。`httpStatus` 是 Host 错误状态，`upstreamStatus`（存在时）是底层服务或图片下载的 HTTP 状态。
引用中的 `referenceViewerUserId` / `referenceTargetUserId` 只是解析出的诊断提示，不参与授权校验。

日志以单行 JSON 输出，避免桌面桥接把字段变成 `[object Object]`。不记录原始头像引用、签名 URL、图片内容、昵称、token、错误全文或堆栈。
正常图片加载、未设置头像及合法 phone_avatar 默认头像不记录错误；共享并发读取只记一次，旧账号请求在切换后的预期取消不记 Browser 错误。

已确认的恢复慢机制仍保持原样：首次加载失败后，相同引用的普通渲染不触发重试；周期维护约 10–12 分钟。
本次日志用于确认真实复现的首次失败阶段，不预先认定为超时或鉴权问题。
