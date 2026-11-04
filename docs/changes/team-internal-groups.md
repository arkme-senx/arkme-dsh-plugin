# 团队内部群

沿既有 TeamDetailPane 的“团队内部群”和群设置关联入口，复用 TeamInternalGroupDialog 的布局、成员影响确认与结果展示。群成员随 Team 名单维护，群内以本人发言；Bot 独立保留。关联需要原群主同时具备团队管理权限，明确展示旧客户端升级范围。

## 单一业务 owner

`services/team-internal-groups.ts` 处理 prepare/preview/confirm/status/recover/ack；UI、正式 DSH Tools 和公开 `teamInternalGroup` SDK 仅适配传输。Host 将群/Team定位封装为不透明引用，浏览器与模型不获取上游凭据。

首次写调用前，原输入与 request UID 持久化到现有 ArkmeStateStore，由 ArkmeLocalDatabase 正式代理；scope 包含账号、环境、Team。未知结果、失效预览和重启都核对原请求，终态 ack 后才允许新操作。后端 receipt 才是结果 authority，本地 journal 只负责恢复。

| 消费面 | 公开入口与授权 | 验证 |
| --- | --- | --- |
| UI | 既有团队/群设置入口，共用 Host owner | 契约/widget + 正式包官方 DSH 浏览器创建预览/确认/就绪 |
| Tools | 正式业务catalog内 preview/status/confirm；write须显式人类grant | 官方DSH真实Agent会话发现、拒绝未授权写、用户授权后确认 |
| SDK | capabilities.teamInternalGroupsV1、公开typed teamInternalGroup；scope与dispose/abort | 仓外Consumer TypeScript编译、创建/关联/恢复/ack、dispose拒绝后续调用 |
| Host | TeamInternalGroups + TeamApp当前资格 + 后端永久回执 | 真实Chat/Gin/Mongo与SDK/UI同一合同 |

## 来源附件

内部群 source occurrence 的 sourceStream 使用现有 mediaRef/File交付入口，POST source-stream、Range及JSON文件Content-Disposition，维持 int64 owner 精度。不复用个人附件定位或脱离当前资格的正向缓存；转发卡片以所在群 occurrence 派生附件引用，嵌套转发保留同一来源上下文。来源缺失/损坏时失败关闭。

## 安装验收

`tests/e2e/team-internal-groups-installed.mjs` 接收调用方提供的官方 CLI、不可变tgz、Chat fixture与产物目录，不依赖开发link安装。使用全新含空格路径的DSH_HOME和独立keychain namespace；官方DSH未改动。组织/资料及空旧源inventory为测试port，Chat事务/回执/成员对账是真实实现；Subject交接与MQ在后端独立真实依赖测试覆盖。

未改根README、插件版本或lock。当前macOS已完成正式包运行；不声明已完成Windows/Linux实际运行验证。
