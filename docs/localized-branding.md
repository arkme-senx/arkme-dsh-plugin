# 本地化产品品牌

Harness `locale.getLocale()/subscribe()` 是唯一语言偏好来源。`zh` 及其语言标签变体显示即我，其余语言显示 Arkme；没有新增 Host API、Tool、SDK 或第二份持久化偏好。

导航、登录、关于、会话欢迎标识、任务欢迎标识和联系人空态共用 `product-brand.ts`。浅色/深色资源由品牌组件统一处理，中文深色图不再重复反色。名称只应用于产品展示，不替换用户消息、昵称或历史记录中的品牌文字。

主窗口激活时检测 `window.arkmeDesktop.branding.schemaVersion === 1`，通过 `setLocale('zh'|'en')` 同步原生展示。最多一个请求执行、一个最新语言等待；语言快速切换只保留最新待发值，卸载移除订阅。浏览器环境、旧客户端或桥失败不会阻塞 UI。独立会话/文章/截图窗口不是桌面品牌写入 owner。

能力矩阵：UI 和 Client 桥属于本次范围；Tools、SDK、Host 业务接口均 N/A，因为这里只改变产品展示，不新增查询、命令或业务持久化。官方 DSH 不修改。

完整效果需要客户端仓的配套品牌桥与两套包内图标。插件合并/发布本身不等于已安装客户端的 Dock 已升级。历史迁移引导中的“即我 3.0”是迁移目标说明，沿用原有语义。

测试：`product-branding.test.tsx` 验证中英/变体、原位更新、快速切换、卸载和旧客户端；其他品牌、登录、导航、联系人和 About 测试覆盖展示入口。运行 `pnpm run typecheck`、`pnpm test`、`pnpm run build`，分发验证使用构建后的不可变 tgz；开发路径不替代正式包验收。
