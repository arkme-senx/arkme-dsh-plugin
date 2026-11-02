# 桌面公开群聊与找人聊聊

本期实现 Arkme 桌面插件入口。世界页增加“公开群聊”和“找人聊聊”，复用现有会话激活、群成员、私聊身份、焦点弹窗、主题和语言能力。没有改动移动端页面，没有发布或部署。

## 用户路径

- 世界 → 公开群聊 → 搜索/分页 → 查看详情 → 加入或申请加入 → 打开原群聊。
- 世界 → 找人聊聊 → 查看公开用户 → 发消息 → 打开原私聊；“看看 TA 的世界”沿用个人世界导航。
- 找人聊聊 → 展示自己/管理我的展示 → 编辑聊天介绍 → 保存展示或下架。下架不提交未保存的介绍，也不需要重新读取账号资料。
- 创建群聊 → 默认勾选公开 → 可选群介绍 → 创建；“浏览公开群聊”使用同一目录，返回后保留建群草稿。
- 群设置 → 公开与展示：群主修改公开状态和介绍；其他成员单独授权“在我的世界展示此群”。
- 我的世界/他人世界 → 公开群聊区块 → 查看全部 → 该用户创建的公开群与主动展示的参群关系。

加入按钮只依据服务端成员和申请状态更新：未加入、等待审批、审批通过、已加入。加入请求在失败重试时复用同一 request UID；已被拒绝后新建申请身份。审批完成后刷新目录，再以原申请身份进入群聊。群主/管理员的审批操作继续使用原治理能力；本次没有新增独立审批管理页面。

## Host 与后端对接

`PublicSocialService` 负责 DTO 转换和账号范围校验。以下 Host 操作全部要求调用方传当前 `environment:userId` 的 `accountScope`，传输前后都校验账号。签名 sourceRef 继续由 SourceService 解释，UI 不拼接或持久化会话权限。

| Host 操作 | Chat 路由后缀 |
| --- | --- |
| `social.groups.query` / `read` | `/groups/query` / `/groups/read` |
| `social.groups.join` | `/groups/join` |
| `social.groups.open` | 原 `/api/v1/chats/detail`；已加入群直接打开，不重复入群 |
| `social.groups.settings` / `settings.set` | `/groups/settings/get` / `/groups/settings/set` |
| `social.groups.showcase.set` | `/groups/showcase/set` |
| `social.people.query` / `read` | `/people/query` / `/people/read` |
| `social.people.listing.set` | `/people/listing/set` |
| `social.people.chat` | `/people/chat` |

除直接打开已加入群外，Chat 路由前缀为 `/api/v1/chats/discovery`。现有 `group.create` 额外转发 `isPublic` 和 `introduction`，旧调用者可继续省略。完整后端契约见 `jotmo-chat/docs/api/public-social-discovery.md`，对应 Chat 提交 `25af1996496f7d3b75a10b8f265804c516ee6ffc`。

成功加入或建聊后，Host 用原 `/api/v1/chats/detail` 验证本人有效成员身份，生成原 sourceRef 并刷新原会话目录。不会另建一套会话或自动发送消息。未部署的 discovery 路由返回可重试的“公开社交服务尚未开放”提示；发布桌面版本前应先提供上述后端能力。

群主公开设置由后端 owner 权限决定。普通成员的个人展示状态，通过本人 `relation=joined` 的公开目录分页读取；读取失败会明确报错，不把未知状态显示成关闭。私密群、退群和被移除后的展示资格继续由后端查询与写入校验。

新增公开写入沿用已有手机号绑定提示；浏览、打开私聊资料、下架和关闭展示不被该提示阻断。最终成员资格和私聊拒收仍由现有业务端点判断。

## 验证

- `pnpm typecheck` 通过。
- `pnpm build` 通过，含 Windows 凭据助手校验、声明生成、Host/Client/SDK 打包和本地时间线 worker 校验。
- 16 个相关测试文件、332 项测试通过。覆盖新增 Host/服务/UI，以及原有 Host 分发、世界页、建群、群设置、账号与手机号绑定、语言和主题回归。
- Chromium 使用本地合成数据渲染实际组件，检查公开群直接加入/审批等待、私聊激活、上架/下架、群主设置、建群与浏览往返、亮暗主题、英文和 920×680 桌面布局；无页面脚本错误及横向溢出。
- 本地截图、浏览器检查记录和可复现 fixture 保存在 `/Users/tison/arkme/artifacts/public-social-desktop-20261103/`。未连接真实业务账号，浏览器验收不等于已部署服务的跨端联调。

后续真实接口联调也已通过：新增 `tests/public-social-backend-integration.test.tsx`，桌面组件经 SDK、Host HTTP、Go 鉴权与真实 handler，连接全新 Mongo 副本集数据库。覆盖默认公开建群、入群与游标、主动展示和群主权限、审批与移除后重放、私聊 pair 去重、拒收、资料服务故障时下架、关闭公开及账号范围校验。该测试没有伪造 Chat 成功响应。

在 `jotmo-chat` 仓运行下列入口即可复现。测试只使用固定账号资料，旧端投递为替身；Redis 限频、跨端通知与线上部署另行验收。脚本会停止自己启动的进程，并保留日志和 JSON 报告；没有配置真实接口时，这条集成测试会显式跳过，不计入通过数。

```sh
ARKME_DESKTOP_REPO=/path/to/arkme-dsh-plugin \
MONGOD_BIN=/path/to/mongod \
./test/integration/run_public_social_desktop.sh
```

手动与完整脚本两次联调均通过；相关 332 项桌面回归保持通过。真实接口证据在 `/Users/tison/arkme/artifacts/public-social-live-20261103/`。

定向回归命令：

```sh
pnpm exec vitest run tests/public-social-service.test.ts tests/public-social-ui.test.tsx tests/world-surface.test.tsx tests/quick-add-ui.test.tsx tests/quick-add-menu.test.tsx tests/quick-add-group-service.test.ts tests/notification-activation-quick-add.test.tsx tests/group-settings-menu.test.tsx tests/group-owner-governance-ui.test.tsx tests/service-architecture.test.ts tests/social-action-guard.test.tsx tests/social-access-quick-add.test.tsx tests/account-locale.test.tsx tests/group-chat-controls-theme.test.tsx tests/theme-color-pairs.test.tsx tests/host-api.test.ts
```
