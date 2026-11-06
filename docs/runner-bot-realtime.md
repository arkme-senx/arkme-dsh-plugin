# Bot 异步回复实时展示修复

## 问题和原因

即我 Agent Runner 在收到派工时先回复登记编号，完成后另发异步结果。测试服确认两次写入及 ACK 都成功，但打开中的 PC Bot 对话未展示后续回复，重新进入才可见。

Bot 的合成 sender_user_id 来自服务端 int64 区间，超过 JavaScript 安全整数范围。Chat SSE 用普通 JSON.parse 后再以安全整数校验发送者，导致合法 Bot receive 事件被丢弃。HTTP owner 响应已有 parseOwnerJson，但通知匹配又将 sender_user_id 当成普通 number，丢弃了同一身份。

## 实现与边界

- SSE 解码复用已有 parseOwnerJson 和 recordOwnerId；大整数以原始十进制字符串在 Host 内流转，普通用户仍为 number。
- 消息通知按同样的 RecordOwnerId 匹配权威 timeline。演员标识继续使用账号/会话作用域 HMAC，不向 Browser 暴露原始 owner ID。
- 序号、时间戳、连接账号和 preparing actor 原有校验不变；不把所有数字一律放宽，也不新增 owner 解析器、表、配置或轮询。
- 这不是 runner 协议绕过；不冒用 MCP 用户发 Bot 结果，不改变消息权限、数据 owner 或业务 API。

## 能力矩阵

| 消费面 | 影响与验证 |
| --- | --- |
| UI | 原有 Bot 对话通过现有实时投影自动展示异步回复；需以不可变插件包完成真实验收 |
| Host owner | SSE 到 ChatRealtimeService 的身份精度与通知匹配；新增 int64 边界、相邻 ID 不混淆、Bot 批量通知回归 |
| Tools | N/A：没有新增查询、命令或业务能力，不改变工具可见性或授权 |
| SDK | N/A：没有新增 SDK 能力，原有 Chat 事件投影沿用现有公开接口 |

## 基线与验证

本次按任务提供的插件 dev 基线，从 origin/dev efe2c3a3d071d6e1fbfd9f1e6ea3d221b2346dd2 新建独立分支 codex/c20261104-runner-bot-realtime。主 checkout 及其他任务 worktree 保持原状，插件版本不变。DSH 使用未修改的官方 0.2.1-rc.2 包、Node 24.11.0，与插件声明的 peer 版本一致；没有修改 DSH 源码。

先加入回归时两个新增用例失败、既有 104 项通过；修复后相关 106 项通过。类型检查通过；完整测试 16,190 项通过、9 项失败、34 项跳过。失败中的打包用例误继承 npx 的 npm_execpath 而把 npm 当成 pnpm；其余为并行负载下录音 UI 超时。用仓库声明的 pnpm 11.7.0、Node 24.11.0 和两工作进程隔离复跑这五个测试文件，64 项全部通过，没有修改无关测试或放宽超时。

构建按仓内 build 脚本相同顺序执行 Windows helper 校验、清理、类型声明、bundle、local-session Profile 与可执行入口验证，全部成功。最初 pnpm 自动依赖检查因 koffi build 授权提示退出；未将工具自动生成的配置带入提交。使用已有 ARKME_SKIP_PREPARE_BUILD=true 打包显式构建产物，保留插件版本 3.0.48。实际不可变包安装到全新 DSH_HOME/Profile 后，用测试账号从 PC Bot 对话派发 UI-FIXED-1104；任务 ff745834-b456-44b3-a40a-60fe38afab92 的登记和最终 UI-FIXED-1104 OK 均自动显示，没有刷新、切换或重新进入会话。安装后的 Host/Browser/实时模块字节与 tgz 一致。

本次真实平台为 macOS；不扩大为 Windows/Linux、Flutter 或真实群聊已验收。未发布 npm、未替换用户常驻 DSH，未修改服务端表或部署生产。
