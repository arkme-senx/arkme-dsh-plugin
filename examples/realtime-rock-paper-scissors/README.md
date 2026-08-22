# 实时石头剪刀布示例

这是 `realtime` 权限的最小双人插件示例。`host.js` 注册插件服务、模型 Tool 和房间事件；`client.js` 在用户点击聊天时间线中的原生邀请卡片后打开房间 UI。

开发者需要把三个源文件构建为 Arkme V1 扩展制品并通过市集发布流程签名。`manifest.json` 必须同时包含 Host 半边和 `permissions: ["realtime"]`。安装后，两位已登录 Arkme 的用户可以：

1. 让 Agent 调用 `arkme_rps_invite`，并传入 `arkme_sources_list` 返回的私聊或群聊 `source_ref`。
2. 在原生聊天时间线中点击“进入房间”。
3. 通过同一条账号级 WebSocket 上的插件频道实时出拳。

示例代码只接触 `harness.realtime` 的命名空间接口，不会获得 Arkme access token、WebSocket 地址或其他插件的频道。
