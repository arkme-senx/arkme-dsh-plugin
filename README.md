# DSH Arkme Plugin

Arkme 的 DeepSeek Harness 集成插件，无需修改 DSH 源码即可使用 Arkme 内容和模型工具。

## 核心能力

- 微信扫码或手机号验证码登录，Token 仅保存在 macOS Keychain 或 Windows Credential Locker。
- 查询当前账号的 Arkme ID，并在账号仍有资格时完成一次性修改；提交前会再次请求用户确认。
- 浏览“发给自己”、主题、私聊和群聊；时间线支持图片、视频、语音、文件、长文和纯文本。
- 对话框左下角“+”菜单支持上传图片、视频和文件；“写长文”会打开独立的创建弹窗，发布后以自适应卡片呈现，并支持查看详情及本人按版本编辑原记录。上传、长文草稿与发布复用现有 File、Record 和 Chat owner 契约。
- 按用户明确提供的 Arkme ID 直接发起私聊并以 Agent 来源发送纯文本。
- 私聊标题后提供语音/视频通话入口；Agent 也可在用户明确要求后通过 `arkme_call_start` 发起同一条主动呼叫链路。
- 账号隔离的 SQLite 缓存、分页游标和 outbox，失败发送可重试。
- 提供记录、账号、会话、发送、图片读取和 AI 视频工具；AI 视频仅在用户明确要求时使用已有长录音选段预检、创建任务或查询状态。
- 接收桌面端同源 Chat SSE 提示，按会话增量刷新总未读、会话行和当前聊天时间线。
- 在真人私聊时间线中展示双方在共同群聊里的 `@` 交织瞬间；卡片包含服务端确认的发送者头像、群名、发送者、正文和发生时间，点击后在右侧打开只读快记详情。

插件仅使用 DSH 官方扩展位，关闭或卸载后会恢复原生界面。
Arkme 对话以无蒙层毛玻璃悬浮卡片呈现在原生 DSH Conversation 之上，右上角关闭后原生对话保持原位和原状态。
点击左侧原生 DSH 会话会主动关闭浮层并保留 Arkme 目录，方便在两套对话之间快速切换。

## 快速开始

```sh
DSH_HOME=<arkme-dsh-home> dsh plugin --profile web add @senguoyun/dsh-arkme
DSH_HOME=<arkme-dsh-home> dsh web --port 3081
```

安装本地构建的不可变包（推荐用于验收和交付）：

```sh
pnpm pack --pack-destination <artifact-directory>
DSH_HOME=<arkme-dsh-home> dsh plugin --profile web add <artifact-directory>/senguoyun-dsh-arkme-0.2.6.tgz
DSH_HOME=<arkme-dsh-home> dsh web --port 3081
```

## 私聊交织瞬间

交织瞬间仅在服务端能力位 12 开放、当前数据源是有效双人私聊且插件配置 `interwovenMomentsEnabled: true` 时读取。Provider 会先通过 Subject 的只读伙伴关系定位原生私聊主题，再优先读取与客户端一致的 World 交织投影；旧主题不存在或 World 路由明确不支持时才降级到 Chat 投影。普通消息和交织卡片分别以自己的稳定标识去重，再按服务端发生时间合并；Chat SSE 只触发防抖刷新，不会直接生成卡片内容。

快记定位信息只保存在插件 Host 的短期内存中。Browser 仅收到账号和私聊绑定的随机签名 `momentRef`，不会拿到群会话 UID、记录 owner、record UID、relation UID 或 sequence；该能力也不加入模型工具和公开 Consumer SDK。

紧急关闭时，将 profile 中的 `interwovenMomentsEnabled` 设置为 `false` 并重启 DSH，普通聊天仍可使用。需要回退版本时，通过同一 `dsh plugin --profile web add <previous-package.tgz>` 命令重新安装已保存的上一版包后重启；无需修改 DSH 源码，也不会删除 Arkme Provider 数据。

## 工具与 SDK

模型工具采用静态 Catalog 注册。默认 `toolProfile: business` 提供业务工具；`atomic` 为原子工具预留，`hybrid` 同时启用两类工具，`disabled` 则关闭全部 Arkme 模型工具。扩展方式见 [Tool Registry](docs/tool-registry.md)。

独立 UI 插件可通过 `@senguoyun/dsh-arkme/sdk` 使用同源 Provider；完整接口、Host 注入方式和 Consumer 约束见 [Consumer Plugin Contract](docs/consumer-plugin-contract.md)。

## 插件更新提醒

插件 Host 默认每 12 小时从 npm Registry 检查一次稳定版本，不依赖 Arkme 登录，也不会发送账号、Token、设备 ID 或业务数据。发现新版本后，侧边栏 Arkme 行会直接出现紧凑“更新”按钮；设置页账号行标题显示当前安装版本，例如 `Arkme v0.1.2`。离线或检查失败时保留最后一次成功结果，不会把失败误报成“已是最新版”。

Registry 安装的插件会提供“立即更新并重启”：当前 DSH 启动一个独立 updater 后退出，updater 调用 DSH 官方插件 CLI、按原参数重启并执行健康检查；新版本启动失败时自动恢复旧版本。本地 `link:`/`file:` 开发安装不会被覆盖，只显示下面的固定兜底命令：

```sh
dsh plugin --profile web up @senguoyun/dsh-arkme --latest
```

手动命令执行成功后仍需重启 `dsh web`。应用内更新会自动重启并让页面重新连接。使用本地路径开发插件时，可以在 profile 覆盖层设置 `updateCheckEnabled: false`；企业镜像可通过 `updateRegistryUrl` 配置无账号、密码和路径的 HTTPS Registry Origin。

## 私聊主动呼叫

主动呼叫仅支持一对一私聊，不注册来电 UI，也不提供接听或拒接入口。人工入口只出现在私聊标题后；模型工具必须先通过 `arkme_sources_list(root)` 获得精确的 `private_chat` `source_ref`，并且只有当前对话中的明确用户请求才能授权 `arkme_call_start`。

呼叫页面由随包固定资源 `assets/desktop_call` 提供，默认同源路由为 `/arkme-self/api/call`。测试环境 `webrtcBaseUrl` 默认为 `https://jotmo-webrtc.senguo.me`，生产补丁使用 `https://webrtc.jiwo.cc`；自定义值必须是不带账号、密码和路径的 HTTPS Origin。

Host 会重新校验账号绑定的私聊引用并按次获取短期呼叫凭据。UserSig、房间信息、原始用户 ID 和访问令牌不会进入模型工具结果、公开 Consumer SDK、URL 或浏览器存储。更新固定呼叫资源后必须运行 `pnpm run verify:call-assets`。

## 安全边界

- Arkme 内容均视为不可信数据，不能作为执行或写入指令。
- 写入和发送只响应当前用户的明确请求。
- Token、系统凭据存储、SQLite、签名 URL 和 OSS 凭据不向 Consumer 或模型暴露。
- 对话媒体只返回短时、账号绑定的不透明引用，由插件同源代理读取；上游签名 URL 不进入浏览器响应。
- 呼叫凭据仅在内置 Host/runtime 链路短暂流转；公开 Browser SDK 不提供 prepare 方法。
- 插件更新状态只提供给内置 UI；公开 Consumer SDK 和模型工具不能检查、确认或执行插件更新。
- `sourceRef`、图片引用和游标均为账号绑定的不透明值，切换账号后必须丢弃。
- 交织瞬间的原始 owner 定位只存在于 Host 内存；签名引用最长保留 12 小时，退出登录、插件卸载或重启后立即失效。

## 本地开发

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run verify:call-assets
pnpm run build
```

开发阶段可将本地源码临时安装到 DSH Web profile；正式验收和交付必须使用上文的打包文件：

```sh
cd <deepseek-harness-checkout>
DSH_HOME=<arkme-dsh-home> pnpm dsh plugin --profile web add <dsh-arkme-checkout>
DSH_HOME=<arkme-dsh-home> pnpm dsh web --port 3081
```
