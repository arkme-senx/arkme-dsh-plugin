# 延展草稿父消息恢复

聊天输入区的延展父消息与正文属于同一份账号、会话草稿。会话引用轮换、切换后返回、组件重建或页面刷新时，两者一起恢复；取消延展只移除父消息，提交时一起消费，失败时仅在没有更新草稿的情况下恢复原父消息。发送仍由既有 `source.message-extension.extend` 校验权限和父消息有效性。

| 能力面 | 范围与验证 |
| --- | --- |
| UI | 修复 Browser 草稿状态；覆盖父消息预览、会话引用轮换、重建、刷新、取消与失败恢复 |
| Tools | N/A：未增加 Host 业务能力；模型不消费用户尚未提交的输入框草稿 |
| SDK | N/A：未增加 Host 接口；外部插件不读取内置输入框的未提交草稿 |
| Host owner | 不变；继续通过现有延展接口授权和发送，不自动重发 |
| Client/Harness | 沿用已有草稿快照同步与 Browser module 装配；不改变原生桥、Profile 或运行环境发布 |

父消息只保存有界预览和既有不透明操作引用，不保存整份时间线、媒体内容或额外业务数据。不增加请求、轮询或监听器。草稿沿用现有账号清理与浏览器存储失败退化；跨机器迁移和已安装客户端发布不属于本次本地修复。

基线：插件 `eb3643959a093255d573c38d235b6ee4057d6fd0`；客户端只读检查 `566ac5986b0d8dbf6cfff2a6da274535716d9021`。基线草稿测试 49 项通过；新增的引用轮换、组件重建、切回会话 3 个场景均复现“文字仍在、父消息丢失”。

## 验证结果

工作目录：`arkme-dsh-plugin-c20261012-extension-draft-recovery`；分支：`codex/c20261012-extension-draft-recovery`。插件版本保持 `3.0.0`，根 README、版本字段和 lockfile 未修改；客户端与 DSH 源码未修改。

- 最终工作区执行 `NODE_OPTIONS=--no-experimental-webstorage pnpm test --maxWorkers=2`：911 个测试文件通过、13 个文件跳过；10,738 项通过、17 项跳过。Node 25 的 Web Storage 兼容参数与已有测试环境一致。macOS 为 Git 子进程指定已安装的 Command Line Tools；此前一次完整运行的 11 个失败均是 Xcode license 拒绝 Git，修正工具链选择后的完整运行全部通过。
- `pnpm run typecheck`、`pnpm run build` 和 `git diff --check` 通过。初次扩展回归中的一项目录刷新次数断言在高负载下多出轮询；两次后续完整测试均通过该用例，未为此修改业务代码或放宽断言。
- 真实 Chromium 中运行实际 `ArkmeSurface` 与编辑器、使用隔离模拟接口：刷新、同会话引用轮换、切换后返回、取消保留正文、成功发送后清理，以及失败恢复后再次刷新均通过。捕获的发送请求继续使用父消息的 `messageActionRef` 和当前 `sourceRef`，没有退化为普通消息发送。
- 现有桌面草稿同步测试覆盖父消息与正文一起进入另一窗口、再次编辑及按会话清理。客户端当前草稿接口传递未知 JSON 快照，现有账号校验和大小限制可以承载新增的有界预览，无需修改桥接协议。
- `ARKME_SKIP_PREPARE_BUILD=true pnpm pack --pack-destination <artifact-directory>` 产出 `senguoyun-dsh-arkme-3.0.0.tgz`；2,190 个归档条目，包含 Host、Browser 和 Bundle 入口，无本任务工作目录/临时目录引用、路径穿越或内嵌 node_modules。
- 使用官方 DSH `0.1.5-rc.2`，以 `dsh plugin --profile web add <artifact.tgz>` 安装到全新、带空格路径的 `DSH_HOME`。独立 Keychain namespace、账号未登录、后台更新与远端 DSH 功能关闭。Bundle 已登记，`auth.status` 返回 `logged-out`，能力和实例接口成功，真实浏览器加载插件 `3.0.0` 登录页面且无页面异常。

测试包 SHA-256：`b598a25e58b482eae7c9706d3a7819a1f7a4577da7b68a63b60dc9f7831e4e4c`。该包对应本次已验证源码；本节验证记录在测试包生成后补录。

本次没有复现用户环境实际触发页面刷新的事件；已复现并修复的是独立父消息状态被会话引用变化或组件重建清空的缺陷。验证平台为 macOS/Chromium；未声称 Windows/Linux 或真实账号已验收。没有提交、推送、PR、运行环境制品发布或已安装客户端更新。仅关闭本任务创建的临时浏览器与 DSH 进程，常驻实例保持原状。
