# 私有角色跨端合同

角色数据仍由一个 Host 业务 owner 承接：`SelfRoleService` 管同步/头像依赖，`ArkmeService` 管当前账号和公开命令，`SelfRoleSyncStore` 管 SQLite 的冻结请求与回执。现有正文发送 owner 只请求消息自己的冻结快照；不复制正文队列。

## 消费面

| 消费面 | 入口 | 验证 |
| --- | --- | --- |
| UI | 发给自己/个人主题/延展的角色选择器；创建、修改头像和名称、删除、显示待同步/冲突、显式采用云端版本 | picker/Host 测试及官方 DSH 中安装 tgz 后实际页面 |
| Tools | `arkme_self_roles_list`、`arkme_self_roles_write`；创建快记工具支持 role_id | 经正式工具注册、会话授权链，在官方 DSH 实际会话调用 |
| SDK | 公开 `@senguoyun/dsh-arkme/sdk`，selfRoles 能力发现，list/create/update/delete/bind/resolve | 仓外 Consumer 严格 TS 编译、运行与旧能力拒绝；真实 Host 调用 |
| Host | 统一 expectedUserId、来源限制、冻结快照与错误语义 | owner 失败恢复、账号切换、旧请求隔离测试 |

不向 Tools/SDK/浏览器暴露 Host 凭据。头像使用既有文件 owner；签名 URL 不进入角色持久化数据。角色只是显示身份，真实作者和权限不变，私聊/群聊不接受角色绑定。受保护延展不会被本地角色覆盖。

## 本地数据与离线恢复

扩展既有 self_role / self_role_record，不新建消息队列。角色行保存 cloud_version、cloud_payload、pending_payload、sync_error 与墓碑；pending_payload 在网络前冻结，响应丢失重放同一操作，后来本机编辑保持待同步。资料冲突通过显式接受云端版本处理；删除仅改生命周期，保留服务端最新名称头像，不与改名竞争版本。删除可替代已被明确拒绝的资料操作，未知结果仍先重放确认。

绑定以 cloud_ack 区分本机冻结事实与已确认云端事实；已确认绑定不能取消或换到另一个记录 UID。旧本机绑定按 keyset 分页补齐云端元数据，不创建新正文。单个绑定冲突不阻断其他绑定。云端快照进入缓存，重启离线仍能显示。

self_role_avatar_asset 保存账号内本机头像到已完成资产的回执，以及上传完成后尚未确认的 complete-upload 载荷，防止角色请求丢回包后重新上传；不是角色历史或消息引用表。上传确认回包丢失或进程重启时重放原会话确认，不重新 PUT 或新建资产；不保存签名 URL。角色删除不删除旧消息的头像资产，不依赖消息是否发送完毕。启动、目录操作、投影失效和周期恢复均复用同一个账号串行执行器；普通无角色发送没有目录请求。

## 验证入口

- 仓内：`pnpm run typecheck`、`pnpm test`、`pnpm run build`、`pnpm pack`。
- 仓外 SDK：`node scripts/verify-self-role-consumer.mjs <已正式安装 tgz 的临时 Profile>`。
- 真实 DSH：`vitest.self-role-e2e.config.mts` / `tests/e2e/self-role.e2e.mjs`，通过环境指定官方 checkout、临时 Profile、本地 Record origin 和本地 TLS 测试证书。仅允许 Record loopback 地址。使用独立账号、存储和钥匙串前缀，不接触常驻 Profile。

目标验收版本为官方 `dsh-v0.1.5-rc.2`。已在 macOS 官方运行时验证；未声称 Android/iOS/Windows/Linux 全平台生产验收，也未修改 DSH 源码或插件版本。
