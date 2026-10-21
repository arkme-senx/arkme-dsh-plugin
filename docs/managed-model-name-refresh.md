# 托管模型名称自动刷新

Intelligent 的现有模型目录接口提供当前展示名称；调用 ID、执行路由、能力与计价仍由原发布目录决定。DeepSeek 直连与百炼账号/业务空间各自查询本渠道的官方元数据，不互相推断版本。

DSH 客户端会缓存完整模型目录。插件在首次目录请求后每 60 秒检查一次原接口，仅在展示内容变化、首次失败后恢复或旧目录过期时，通过公开注册 handle 的 `replace()` 原子替换同一个 Adapter，通知客户端失效缓存。没有新增业务路由、模型 Tool 或 SDK 查询接口；它们继续使用既有模型发现能力。

- 未使用目录前不读取凭据、不轮询；撤销路由期间暂停检查。
- 每次检查解析当前凭据，不缓存 Access Token。
- 相同目录、有效旧目录期间的重复失败不发送额外失效通知。
- 卸载和手动解除注册会清除定时器、取消在途目录读取；晚到结果不会写回或通知客户端。
- 在途模型调用保持原 Adapter 与执行事实，刷新不选择模型或改写历史。

能力覆盖：UI 为现有模型菜单及已选名称；Host owner 为既有 ManagedModelCatalog。Tools/SDK 没有新增独立业务能力，不增加消费入口。后台名称获取失败沿用既有目录的有限旧数据和错误反馈。

## 验证

单测运行 `pnpm exec vitest run tests/managed-ai-adapter.test.ts tests/managed-ai-catalog-refresh.test.ts`。覆盖实际公开 Adapter 事件、名称变化、首次失败恢复、过期、无变化、撤销、卸载、取消和凭据轮换。

真实浏览器验收使用 `tests/e2e/managed-ai-catalog-refresh.e2e.mjs`，沿用 `vitest.managed-ai-e2e.config.mts`，额外设置 `ARKME_MANAGED_AI_CATALOG_REFRESH=1`。准备与现有 Managed AI E2E 相同的未修改官方 DSH checkout、通过官方 CLI 安装不可变 tgz 的独立 Profile，以及本地 HTTPS 合成数据夹具证书；无需真实供应商密钥或数据库。

在官方 DSH checkout 执行插件 Vitest，设置 `ARKME_DSH_CHECKOUT`、`ARKME_PACKED_PROFILE`、`ARKME_E2E_TLS_KEY`、`NODE_EXTRA_CA_CERTS`、`DSH_SNAPSHOT=replay`，可选 `ARKME_E2E_SCREENSHOT`。测试使用真实生产 60 秒检查周期，验证已缓存的浏览器目录自动更新、菜单与已选名称一致、模型 ID 不变；不会手动调用刷新或重载页面。

发布时需要同时更新 Intelligent 与插件；Web 更新提供官方名称和缓存状态的管理视图。回滚到旧插件会恢复原来的客户端目录缓存行为。插件版本号由正式发布流程处理。
