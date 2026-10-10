# 团队资料编辑

基于 dev，Team 是名称/头像/当前所有者/版本/准确回执 owner。Record 是上传、不可变成品、额度与回收 owner。插件共用 TeamAppService，不解析内部存储，不把成员拼图用于外部公开投影。团队即我号保持原契约。

| 能力面 | 入口与合同 | 验收 |
| --- | --- | --- |
| UI | 团队详情所有者「编辑」；简约头像/名称/取消/保存；既有裁剪；名称头像菜单 | 交互、竞态、实际页面验收 |
| Tools | arkme_team_profile 与 arkme_team_profile_update；既有明确人工确认；已授权暂存 fileRef | 官方 DSH 实际会话发现/调用、Schema、回执 |
| SDK | 公开 getTeamProfile/updateTeamProfile/uploadTeamAvatar/abortTeamAvatar；teamProfiles 能力；AbortSignal | 仓外 Consumer 类型与调用、能力缺失 |
| Host owner | ArkmeService 薄适配 → TeamAppService；不透明账号引用、CAS、准确请求回执；图片规范化留在基础设施 | owner/Host/SDK 一致性、失权、缓存、上传故障 |

签名 URL、资产定位、上游凭据都留在 Host。目录 OpenAPI teamRef 和 App profileRef 是不同合同：资料查询使用目录返回的准确即我号，后续修改只用查询返回的 profileRef。自定义头像使用稳定且账号作用域的 key，访问引用可以旋转；Host 每次读取重新检查当前团队资格/资产，客户端复用既有有界图片缓存。

不新增配置，不改版本、根 README 或 DSH 源码。Record 与 Team 需共同部署后再发布客户端。验证结果在任务验收文档收口。


## 实际验证

完整测试范围以分组执行收口：920 文件为 10,311 项通过/17 跳过，home-tour 与 conversation-send-directory 单独执行 40/373 项通过；最终导航保持/编辑重试 16 项通过。typecheck、build、pack 通过。

最终不可变包 SHA256 为 `9cabf5e63854b341577465ba21e54ab7e1ae3da65f6d1381c50aacaf8bf64864`。官方 CLI 将该 tgz 安装到隔离 DSH 0.1.5-rc.2 Profile，真实 Chrome 验证改名、裁剪、签名 PUT、自定义/名称头像菜单、成员隐藏与直接越权拒绝、窄屏与刷新后导航保持。正式会话执行资料读工具、确认要求和授权后的写工具。仓外 Consumer 仅导入公开 SDK，类型编译、能力缺失、调用取消通过，并经正式安装 Host HTTP 执行 get/upload/abort/update。

后端/存储是隔离 HTTPS 夹具，不连接线上账号；Team/Record 持有、DB 和文件故障另由后端真实 Mongo 测试验证。未执行其他原生桌面系统，不能把 macOS Chrome 证据外推为全部平台通过。

复验使用 `vitest.team-profile-e2e.config.mts`，需要 ARKME_DSH_CHECKOUT 指向只读官方 checkout，ARKME_PACKED_PROFILE 指向官方 CLI 已安装 tgz 的隔离 Profile；ARKME_E2E_TLS_KEY/NODE_EXTRA_CA_CERTS 指向本地 HTTPS 夹具证书（SAN localhost/127.0.0.1）。将 tests/consumers/team-profile/consumer.ts 放入该 Profile 下独立 type=module 的 team-profile-consumer 包，使用 strict NodeNext 编译到 out/consumer.js，再从官方 checkout 执行该 config。可选 ARKME_E2E_CAPTURE_DIR 保存实际截图。上述仅测试夹具环境变量，不是新增产品配置。


## 最终名称头像与菜单

default 从团队名取前两个 Unicode 可见字符，忽略空白、英文 ASCII 大写，组合 emoji/重音字符保持完整；无新增简称字段、成员槽位或成员图片查询。自定义图片不随改名替换，默认/图片切换继续沿原 Host 资料命令。

点击头像打开既有 DSH 原生菜单，提供上传图片及带缩写预览的使用名称头像；菜单说明为随团队名称自动更新。菜单在原生 dialog 内渲染，避免 body portal 脱离 top layer；Escape 关闭菜单并恢复触发器焦点。弹窗允许菜单完整绘制，实际页面验证说明未裁切。选择先更新草稿，保存才生效。

本轮菜单/团队相关 49 文件 580 测试通过，最后修改后的名称/编辑器/菜单 23 测试通过；正式 tgz + 官方 DSH + Chrome 验证资料、菜单、上传、权限，以及真实 Tools 和仓外公开 SDK Consumer。没有新增 Host 方法或 API，已有 Tools/SDK 的共享 DTO 同步移除成员槽位。本轮没有修改版本、根 README 或 DSH 源码。


## 合并前修复与真实服务验收

资料头像通过 `ChannelView.avatar` 投影，原 `avatar_url` 只表示独立通道覆盖；配置保存不会把短期资料签名 URL 固化。公开通道的资料图片引用通过公开 resolve 复核当前成品，成员详情通过 profile/get 复核；普通个人身份图片与团队成品图片保持各自读取合同。明确权限、版本、参数或命令冲突拒绝不会被同 request_uid 的旧成功回执遮住。

本轮官方安装包 SHA256：`d0bc0239709f885a87a9a57051ac470fded96138097995271863645bbeb1ef3e`。已在正式隔离 DSH/Chrome 执行真实 Team/Record HTTP 与 Mongo 的改名、裁剪上传、保留 custom、切回名称、权限变化和 Tools/SDK 链路。Record 使用真实文件与签名 HTTP 的 Blob 测试边界，云对象存储 provider、真实 MQ/SSE 传输及其他原生系统没有冒称已验收。

复现真实服务模式时，先按 meta 合并前审查文档启动两仓 `TestTeamProfileIntegrationServer` / `TestExternalImageIntegrationServer`，设置共同 `JOTMO_TEAM_PROFILE_SERVER_DIR`；DSH e2e 指定 `ARKME_TEAM_PROFILE_REAL_SERVER_DIR` 为该目录。不指定时保留原隔离 HTTPS 后端 fixture 模式。上述只用于 opt-in 测试，不进入产品配置。

最新目标、完整场景映射、回归结果和未全绿门禁在 jotmo-meta `docs/analysis/2026-10-10-team-profile-premerge-audit.md` 收口。
