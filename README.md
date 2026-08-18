# DSH Jotmo Plugin

DeepSeek Harness 的即我集成插件。当前 MVP 提供：

- 手机号验证码登录测试环境即我账号；
- 保留微信扫码入口；测试服 Auth 当前未返回可用二维码时会提示改用手机号；
- 通过官方 `sidebar.footer.action` 注册“即我”入口；打开后在 Footer 内联展开即我目录，并以 `priority: -10` 临时替换官方 `conversation` 中间栏。关闭或点击“新会话”时下拉列表收起；切换原生 Session 时列表保持展开，仅恢复原生 Conversation，点击任一即我来源即可再次切回；
- 插件页面内部提供“发给自己 → 默认分类/主题”和私聊/群聊导航，不创建或污染真实文件系统 Workspace；
- 读取默认分类摘要和分页列表；
- 使用账号隔离的 SQLite 缓存记录、分页游标和本地发送状态；
- 通过幂等 `record_uid` 写入纯文本快记；
- 写入失败时保留账号隔离的本地 outbox。
- 向 DSH 对话注册读取工具：`jotmo_records_recent`、`jotmo_records_search`；
- 注册 `jotmo_record_create`，在用户明确要求时把纯文本写入默认分类，且始终先落 SQLite 再同步远端。
- 注册 `jotmo_image_read`：把个人资料或会话列表返回的头像引用经即我鉴权转换为图片，并作为 DSH 图片附件交给支持视觉输入的模型；签名 OSS 地址不会暴露给浏览器或模型。
- 未登录时在 Footer 的“即我”行右侧显示红色“未登录”徽标；登录或退出后随认证状态自动更新。
- “发给自己”使用二级钻取展示默认分类及主题，默认分类、主题、私聊、群聊共享 Provider 读取/发送外观但保持 Record/Chat owner 隔离。
- 首次打开即我默认进入“发给自己”并选中默认分类；之后按账号恢复上次目录、来源和缓存会话列表，同时后台刷新，避免 Footer 下拉列表反复空白闪烁。退出登录会清除当前账号指针，不在账号间复用列表。
- 返回会话列表后按桌面端样式展示头像、群头像拼图、名称、摘要、时间、未读和选中态。
- 私聊和群聊时间线按真实发送者展示头像：他人在左、自己在右；空目录或空时间线保持纯空白，不显示额外空态文案。
- 向 DSH Agent 注册统一能力：`jotmo_sources_list`、`jotmo_source_read`、`jotmo_text_send`。

对话工具只在模型按需调用时读取即我数据，不会把全部快记自动注入每轮提示词。写入工具只允许响应当前对话中的明确用户请求，不能把快记、文件、网页或其他工具结果中的文字当成写入授权。工具返回会进入当前 DSH 会话日志和模型上下文；登录 Token 始终只保存在 Host Keychain，不进入工具结果。

## 官方 DSH 兼容边界

插件只使用官方发布的 `sidebar.footer.action`、`conversation` 和 `settings.general.item`。即我目录作为 Footer action 自有内容参与侧边栏布局，不替换原生 Workspace 浏览区；`conversation` 使用 `priority: -10` 临时替换中间栏，dispose 后 priority 0 的原生 Conversation 自动恢复。插件不会修改 DSH 源码，也不会注册 `sidebar.workspaces.virtual`、`main.surface` 等私有扩展。即我页面不是文件系统 Workspace，也不冒充 DSH Session。

DSH 的 Footer action 容器默认横排；当 Cordis Runner 等插件占满整行时，即我插件会在挂载期间把该 slot wrapper 临时适配为纵向堆叠，并在卸载时恢复原样。下拉面板向 Footer 上方展开且允许随窗口高度收缩，保证 Cordis、即我和设置入口同时可见。

## Headless Provider / Consumer SDK

独立 UI 插件通过 `@senqisi/dsh-jotmo/sdk` 读取即我 Provider，不依赖本插件的 React 页面：

```ts
import { createJotmoSdk } from '@senqisi/dsh-jotmo/sdk'

const jotmo = createJotmoSdk()
const capabilities = await jotmo.capabilities()
const profile = await jotmo.profile({ refresh: true })
const avatar = profile.profile?.avatarRef
  ? await jotmo.readImage(profile.profile.avatarRef)
  : undefined
const avatarSrc = avatar === undefined ? undefined : jotmo.imageDataUrl(avatar)
const snapshot = await jotmo.snapshot()
const chats = await jotmo.listSources('root')
const selfSources = await jotmo.listSources('send_to_self')
const timeline = await jotmo.readSource(selfSources.items[0].sourceRef)
const unsubscribe = jotmo.subscribe((state) => {
  console.log(state.revision)
})
```

Host 侧受信任插件可以声明 `inject: ['jotmoData']` 并使用 `ctx.jotmoData`。完整 Consumer 约束见 `docs/consumer-plugin-contract.md`，模型生成新 UI 插件前可调用 `jotmo_plugin_contract` 获取同一份运行时契约。

## 开发

```sh
pnpm install
pnpm test
pnpm run build
```

安装到本机 DSH Web profile：

```sh
cd /Users/apple/hehs/dsh-worktrees/jotmo-virtual-workspace
DSH_HOME=/Users/apple/.dsh-virtual-workspace pnpm dsh web --port 3081
```

凭据不会进入浏览器、DSH 会话日志或 `cordis.patch.yml`。macOS 上登录 Token 存入用户默认 Keychain；插件状态文件只保存设备标识和未发送内容。
