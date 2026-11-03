# 公开群聊与公开用户：本次后端改动交接

交接给华焱。此次桌面功能开发中，AI 同时直接实现了下面的 Chat 后端改动。后端代码已经存在于独立分支，需要由后端负责人复核、决定如何集成和部署；目前没有合入 Chat 的 master/develop，没有部署，也没有修改真实账号或业务数据库。

## 代码位置和当前状态

- 仓库：`senguo/jotmo/jotmo-chat`（CodeUp）。没有修改 `jotmo-backend`、Record、Audio 等其他后端仓。
- 基线：`master`，`49dfa6bbbba6b8986da0086052ce7ba9e35c945b`。
- 分支：`codex/ts1103-03-公开社交基建`，已推送，可直接 fetch 查看。
- 功能提交：`a25dfd34a374bf165cf38bfdf0cf9373d7c14314`。
- 联调入口提交 / 当前分支 HEAD：`ee73ce1a702bceee652284fbdfba42f728337510`。
- 完整变更为 17 个文件：9 个生产代码文件、6 个测试文件、1 份接口说明、1 个联调脚本。随本说明提供相对上述 master 基线的完整补丁。
- 桌面配套在 `arkme-senx/arkme-dsh-plugin` 的 `codex/ts1103-04-桌面公开社交`，随后合入该仓 `dev`；本次没有直接推进后端 develop。

## 已经实现的行为

1. 公开群资料与目录：群主设置公开状态、介绍；登录用户可查询所有公开群，以及指定用户创建或主动展示的公开群。
2. 新建群默认公开：原 `POST /api/v1/chats/create-group` 新增可选 `is_public`、`introduction`；省略 is_public 时默认 true，传 false 为私密。公开设置随原 session/member/policy/cursor 创建事务一起提交。
3. 个人世界展示参群关系：创建的公开群默认可展示；加入的公开群需成员本人另行开启 showcase。退群、被移除、关闭公开后，公开查询会立即过滤。
4. 公开入群：复用原邀请成员、容量、禁止再入群、cursor 和 legacy 同步链路；审批群先写原申请，审批前没有成员资格，通过后使用同一 request_uid 完成加入。移除后不能重放旧审批重新获得成员身份。欢迎群、会员群和官方托管群不走普通公开目录入群。
5. 公开用户上架/下架：必须本人主动开启，介绍最多 500 字；下架保留已保存介绍，不依赖账号资料服务可用。
6. 从公开用户发起私聊：重新检查目标仍上架及双方拒收，复用原双方唯一 pair 创建/获取真人私聊，并复用旧端兼容 ensure。目录建聊不发送消息，也不新增好友关系。

**请重点确认新建群默认公开的影响面：** 这是 Chat 原生建群入口的默认值变化，影响所有调用该入口且省略 is_public 的客户端，并非只影响桌面。历史群没有批量公开或回填；迁移、反向桥接和服务托管建群没有自动写公开设置。其他客户端如需保持新群私密，应明确传 false。

## 新增接口

均为登录态 `POST + JSON`，统一前缀 `/api/v1/chats/discovery`。身份只取鉴权上下文，目录读取 120 次/人/分钟，写入 30 次/人/分钟。

| 后缀 | 参数 | 功能 |
| --- | --- | --- |
| `/groups/query` | `query?`, `before_uid?`, `limit?`, `user_id?`, `relation?` | 公开群分页；个人世界可按 created/joined 过滤 |
| `/groups/read` | `chat_session_uid` | 群资料、本人是否加入、本人最近申请状态 |
| `/groups/settings/get` | `chat_session_uid` | 群主读取公开设置 |
| `/groups/settings/set` | `chat_session_uid`, `is_public`, `introduction?` | 群主修改公开状态和介绍 |
| `/groups/showcase/set` | `chat_session_uid`, `is_shown` | 本人设置是否展示参群关系 |
| `/groups/join` | `chat_session_uid`, `request_uid` | 返回 joined/pending；重试复用请求身份 |
| `/people/query` | `query?`, `before_user_id?`, `limit?` | 主动上架的公开用户分页 |
| `/people/read` | `user_id?` | 他人已上架资料；省略 ID 读取自己的草稿 |
| `/people/listing/set` | `is_listed`, `introduction?` | 本人上架、修改介绍或下架 |
| `/people/chat` | `user_id` | 创建/复用原真人私聊，返回 chat_session_uid |

返回 DTO、并发边界、审批重试流程与错误语义在 Chat 仓 `docs/api/public-social-discovery.md` 中。审批操作仍用原 `/api/v1/chats/governance/join/resolve`；此次桌面只接申请和状态刷新，没有新增独立审批管理页。

## 数据与兼容变化

- 新增 `chat_public_group`：群 UID 对应公开状态和介绍。
- 新增 `chat_public_group_showcase`：本人 user ID + 群 UID 对应展示授权。
- 新增 `chat_public_user`：本人主动上架状态、介绍、公开昵称和头像快照。
- 在原集合初始化中创建目录分页索引、个人展示唯一约束，并为原审批集合增加本人最近申请查询索引；不要求一次性回填历史数据。
- 公开目录只使用 Backend 的公开 nickname/头像，给 Chat 的 `PublicUserDisplayProfile` 增加独立 NickName 字段；原分享页 DisplayName 回退保持原行为，新目录不继承真实姓名/slug 回退。
- 没有修改原消息正文、历史记录、pair 唯一身份或好友事实。关闭公开和用户下架不会删除既有群成员、历史消息或私聊。
- 回滚可撤回这两个后端提交；旧代码忽略新增集合，不需要清库。回滚后新入口不可用，新建群恢复旧默认行为。

## 逐文件清单

| 生产代码 | 本次改动 |
| --- | --- |
| `gin/api/chat.go` | 挂载 discovery 路由 |
| `gin/api/chat_public_social.go`（新增） | 10 个接口的严格请求解析、鉴权身份、权限/错误映射及原兼容投递调用 |
| `gin/api/chat_session.go` | 原生建群增加公开状态和介绍，默认公开 |
| `internal/chat/public_social.go`（新增） | DTO、集合名、查询/写入接口、输入约束 |
| `internal/chat/models.go` | 原建群命令增加可选公开设置，在归一化中校验介绍 |
| `internal/chat/mutation.go` | 上下架、公开设置、showcase、公开加入及私聊复用；公开建群纳入原事务 |
| `internal/chat/repository.go` | 查询、实时资格过滤、稳定游标、索引初始化 |
| `internal/chat/contact_visible_phone.go` | 公开展示结构增加独立 NickName 字段 |
| `pkg/backendclient/user_display_name.go` | 从原 Backend 公开资料结果填充 NickName，不更改原 DisplayName 兼容逻辑 |

测试文件：`gin/api/chat_public_api_test.go`、`gin/api/chat_public_social_test.go`（新增）、`gin/api/chat_public_social_desktop_fixture_test.go`（新增）、`internal/chat/public_social_mongo_test.go`（新增）、`internal/chat/repository_test.go`、`pkg/backendclient/user_display_name_test.go`。

说明与脚本：`docs/api/public-social-discovery.md`（新增）、`test/integration/run_public_social_desktop.sh`（新增）。

## 已验证与尚未验证

- 真实临时 MongoDB 7.0.15 副本集的目录、入群、审批、禁止重放、showcase、pair 并发去重、拒收、上下架、事务回滚、索引 Explain 测试通过；API 和 Backend 公开资料定向测试通过。
- Go vet、后端结构检查通过。全量 Go 回归有 3 个失败，均已在原 master 独立复现：`TestCompletionArchitectureBoundaries`、`TestAuditPassReconcilesReportRestrictionThatArrivesDuringProjectionInMongo`、`TestAuditPassReconcilesWithdrawalThatArrivesDuringProjectionInMongo`，未宣称全量 Go 测试全绿。
- 桌面真实组件经 SDK → Host HTTP → Go 鉴权/handler → Mongo 的联调通过，并在桌面基于 3.0.43 主线同步后重跑通过；相关桌面回归 351 项通过、构建通过。
- 该联调的账号公开资料和旧 Subject 投递使用替身；Redis 限频、MQ/跨端通知、Record 消息收发与真实测试/生产环境尚未做完整联合验收。本机没有 Docker，未运行 Docker 版跨服务 E2E。

## 后续交接事项

请华焱先复核实现和默认公开策略，再决定后端分支如何合入及测试环境部署。桌面 dev 合入与后端部署是两件独立的事；桌面公开目录在后端未提供接口时会显示服务未开放。建议先将后端部署到测试环境，核对公开资料/拒收、索引及现有客户端兼容，再安排配套桌面联调和正式上线。

本次没有替后端负责人合入 develop/master，没有做线上迁移、回填或部署。
