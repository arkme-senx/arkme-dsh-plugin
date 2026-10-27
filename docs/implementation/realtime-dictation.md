# 输入框实时听写

输入框麦克风沿用原有布局、样式和图标，通过实时 WebSocket 持续修订本次听写文字。用户原有正文、其他输入和草稿保留；停止听写只结束识别，不发送消息。进行中提示改为“正在实时听写，文字会持续更新”，写入失败后的按钮改为“重试写入”，对应英文同步更新。

## 服务协议

协议参考移动端 `NetworkComposerDictationSession`（`lib/infrastructure/services/audio/dictation/composer_dictation_session.dart`），核对 frontend pre-release 提交 `c583c164618a5b632293d9f2335f62afbfbadfe9`。

1. 先取得麦克风权限，再通过当前环境主 API `POST /api/v1/dictation/check` 检查可用性和额度；检查后重取当前 Host 凭据，兼容 Token 刷新。
2. 正式入口为 `wss://realtime.jotmo.cc/api/v1/realtime/connect`，测试入口为 `wss://jotmo-realtime.senguo.me/api/v1/realtime/connect`，允许复用既有 `dshRemoteRealtimeBaseUrl` HTTPS origin 配置。子协议为 `jotmo.dictation.v1`，请求头为 `X-Jotmo-Dictation-Start: deferred`。Token 仅在 Host Authorization 头内。
3. 收到 prepared 后发送同 session_id 的 JSON start；收到 ready 后发送 16kHz、PCM16LE、单声道音频。上游 session_id 不暴露给 Browser、SDK 或 Tools。
4. result 按 revision 更新累计全文，忽略旧 revision 和其他 session 的结果；兼容 Go 省略 is_final=false 或空 text。最终结果必须为完成结算的 result.is_final=true，裸 done 或 EOF 不视为成功。
5. JSON stop/cancel 控制停止和取消。最多录音 120 秒，并服从 ready.max_duration_ms 的更小额度；Host 主动收尾留 2 秒尾包排空，上游 finalizing 后不再重放音频。最终结果最多等待 10 秒。

## 能力矩阵与权限

| 消费面 | 实现与边界 | 验证 |
| --- | --- | --- |
| UI | 复用原麦克风入口；替换本次听写范围；停止、切页、账号切换和错误时释放资源 | 页面真实 AudioWorklet、累计及最终文本、发送状态与资源释放 |
| SDK | 公开能力探测、类型、同源 handle、bounded command、AbortSignal/dispose；不获取麦克风或凭据 | 独立打包 Consumer 在带空格目录 strict 编译和执行；不支持版本明确拒绝 |
| Tools | 正式 catalog/grant 注册；start 确认后返回短时账号绑定 streamRef，后续小帧音频/收尾/查询/取消共用该引用 | 官方 DSH 真实 Agent 会话发现、确认和调用 |
| Host | RealtimeDictationService 为唯一 owner，统一额度、账号、错误和生命周期 | 真实本地 WS 协议、账号隔离、容量、取消和超时测试 |
| Client/Harness | 复用官方 Upgrade seam 和现有媒体权限政策；客户端源码不变 | 独立 macOS 桌面实例安装不可变包并连接正式服务 |

同源 Upgrade 和 HTTP 操作都要求本机来源；跨账号或 Provider 退出会关闭上游连接。不会自动重连或重放音频，不持久化录音。文字写入位置失效时保留原文，允许重试写入或复制本次识别结果。

资源上界：2 个活跃会话、8 个保留状态；上下行 buffer 各 64KiB；单帧 3200 bytes；全文 20000 UTF-16 单位；录音空闲 12 秒后主动收尾；终态保留 30 秒。准备、录音、排空和最终读取均有 deadline，心跳、timer、socket 随取消、退出和账号切换释放。

## 验证范围

- 2026-10-26 的任务改动在原始插件基线 `2adbdde7d9a947ac0d707eb4fb3b7125091f0f05` 上通过 typecheck、build 和全量测试：1249 个文件通过、18 个跳过；14159 项通过、23 项跳过。最新 dev 集成后的门禁结果另记于 PR。
- 官方 DSH 0.2.1-rc.2（`687f282e8625c6b8d11ff58211a90524be2e4317`）通过官方 CLI 安装本地不可变包后，SDK Consumer 和真实 Agent Tool 链路通过。合成服务严格校验新协议和 deferred 头。
- 实际 Browser UI 使用合成麦克风，经过真实 AudioWorklet、同源 WS 和已安装包的 Host：实时文本、最终文本、保留原文、发送状态和资源释放通过。
- macOS 隔离桌面实例保留登录并连接正式服务。固定中文合成语音以实时速度发送 92 帧、292528 bytes，正式服务完整返回预设句子并经过 listening → finishing → finished；没有发送消息。
- 上述本地包版本保持 3.0.31，SHA-256 为 `de8e0af41a831b32903b9c1075da2d57197453e91cfcfb92308ad1c5a9af590f`，只用于本地验收，未发布到线上渠道。最新 dev 的版本元数据由上游持有，本任务不另行修改。
- 真人麦克风验收仍需有效输入设备；Windows/Linux 未实机验收。客户端源码和 DSH tracked 文件未修改，插件根 README 与 lockfile 不改。
