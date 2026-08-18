# DSH Jotmo Plugin

DeepSeek Harness 的即我集成插件。当前 MVP 提供：

- 手机号验证码登录测试环境即我账号；
- 保留微信扫码入口；测试服 Auth 当前未返回可用二维码时会提示改用手机号；
- 在 DSH 虚拟工作区区域注册“即我 → 默认分类”；
- 通过 `main.surface` 打开插件自有的消息流页面，不创建或污染真实文件系统 Workspace；
- 读取默认分类摘要和分页列表；
- 使用账号隔离的 SQLite 缓存记录、分页游标和本地发送状态；
- 通过幂等 `record_uid` 写入纯文本快记；
- 写入失败时保留账号隔离的本地 outbox。
- 向 DSH 对话注册读取工具：`jotmo_records_recent`、`jotmo_records_search`；
- 注册 `jotmo_record_create`，在用户明确要求时把纯文本写入默认分类，且始终先落 SQLite 再同步远端。
- 注册 `jotmo_image_read`：把个人资料返回的头像引用经即我鉴权转换为私有 OSS 图片，并作为 DSH 图片附件交给支持视觉输入的模型。

对话工具只在模型按需调用时读取即我数据，不会把全部快记自动注入每轮提示词。写入工具只允许响应当前对话中的明确用户请求，不能把快记、文件、网页或其他工具结果中的文字当成写入授权。工具返回会进入当前 DSH 会话日志和模型上下文；登录 Token 始终只保存在 Host Keychain，不进入工具结果。

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
