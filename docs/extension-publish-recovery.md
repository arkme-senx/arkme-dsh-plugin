# 发布状态与恢复

发布失败后保留 `publish_session_id`。未发布扩展在市集 inspect 中不可见，不能用 inspect 的 404 判断发布会话不存在，也不要靠换版本重新上传来恢复。

`arkme_extension_publish_status` 不传参数时分页列出当前账号的发布记录；传 `publish_session_id` 时查询单个会话。此工具不启动校验或 AI 审核。

`status` 保持既有版本生命周期；`execution_state` 表示当前执行事实：`running` 正在执行，`failed` 已失败，`interrupted` 执行中断或旧会话缺少执行记录，`published` 已发布。错误通过 `error_code`、`error_message` 和校验错误字段返回；原请求失败时也保留回执，不把 `validating` 查询结果当成功。

恢复使用 `arkme_extension_publish_resume`，必须选择记录中的准确会话、展示确认问题，并在后续直接人类确认后执行。恢复沿用原包身份、版本、摘要和上传对象，不需要原 Cordis 源对象仍驻留。不会自动重试写请求。确认问题显示有效时长；过期可重新准备。

“我的扩展 → 发布记录”提供刷新状态与恢复发布。冷却期间显示等待时间，只有服务端 `can_resume=true` 才提供恢复按钮。列表独立于已发布目录，进程重启后仍可查询。

Browser SDK 的公开入口：

```ts
import { createArkmeSdk } from '@senguoyun/dsh-arkme/sdk'
const sdk = createArkmeSdk()
const controller = new AbortController()
const features = (await sdk.capabilities(controller.signal)).features
if (features.extensionPublishRecovery) {
  const page = await sdk.extensionPublishSessions({ signal: controller.signal })
  const session = page.items[0]?.publish_session_id
  if (session) await sdk.extensionPublishStatus(session, controller.signal)
  // 仅在当前明确人类操作下调用：
  // await sdk.resumeExtensionPublish(session, controller.signal)
}
// consumer 卸载时 controller.abort()
```

旧 Provider 缺少能力位时拒绝新接口。旧发布服务缺少 `publication_capabilities.publish_recovery` 时拒绝列表与恢复写入，提示升级服务；不以重发发布替代恢复。账号归属由认证 Host 和发布服务共同校验。

服务端发布任务最长执行 90 秒、持久执行租约 120 秒；插件对完成/恢复请求至少等待 100 秒，主动取消仍立即生效，其他接口维持原超时配置。恢复仅用于已进入校验的未终结会话，截止为上传期限后 24 小时且不越过会话保留期。上传缺失需在原上传期限内补齐；材料缺失且上传已过期时禁止继续恢复。拒绝、撤销、过期或删除的版本不能复活。恢复仍执行完整校验及审核，不保证审核通过。

部署顺序：审核服务 → 发布服务 → 插件。部署本身和真实生产会话恢复是独立操作；代码及隔离验收不等于生产问题已恢复。

发布服务在约 2 秒仍未完成时返回 HTTP 202 和 `execution_state=running`，不代表已发布。Host 仅在本次明确发布或恢复操作后，以 2 秒间隔、最多 50 次、总预算 100 秒查询持久状态；终态、读失败或取消时停止。查询不生成审核，不会重发 complete/resume；普通 status/list 始终单次读取。客户端断开不取消已经受理的服务端任务，可重新打开发布记录查询。

## Confirmation and package diagnostics

See [execution modes](extension-execution-modes.md) for the read-only confirmation countdown, expiry/reprepare flow and aggregated V2 capability diagnostics.
