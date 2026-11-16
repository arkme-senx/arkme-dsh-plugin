# Arkme 设备与 IM 注册登记

## 当前范围（2026-11-16）

按用户最新要求，本轮只保留设备及腾讯登录身份登记，不提供腾讯 IM 自定义消息发送或接收能力。sendIM、subscribeIM、im_send命令、自定义消息事件和arkme.im.v1过滤器均已撤除，验收脚本也不再发送消息。

Arkme自有实时通信、私聊及团队消息仍走原服务；没有修改其传输、监听或业务路由。既有通话引擎自身的腾讯信令继续保留。

Host DeviceRegistrationService读取现有Token中的client_id，以platform=5登记到webrtc；不改安装身份或uniqueCode。共享IM实例仅用于现有通话和观察登录就绪、被踢事件，SDK_READY验证账号后上报registration_id。心跳、活动、代际隔离及旧凭证退出清理保留。后台心跳30秒、租约120秒。

## 构建和验证

通信资源从tools/desktop-call/src源码构建，manifest记录源码、依赖锁和产物SHA256，不直接改bundle。沿用CallEngine3.5.9/lite-chat1.6.11，根插件版本不变。

```sh
npm ci --ignore-scripts --prefix tools/desktop-call
node scripts/build-call-assets.mjs
node scripts/verify-call-assets.mjs
node --test tools/desktop-call/src/im-bridge.test.js
```

scripts/verify-im-live.mjs仅验证SDK登录、原有通话回归和可选设备登记链路，不再发送任何自定义IM消息。设置VERIFY_DEVICE_REGISTRATION=1开启远端登记；PLAYWRIGHT_MODULE、CHROME_EXECUTABLE和IM_LIVE_REPORT指定隔离测试运行环境。账号参数只能使用获授权的专用测试账号，凭证不落盘。

2026-11-13测试服后端已部署（Jenkins #325），设备登记及清理、120秒租约、代际隔离已通过实测。之前消息收发证据仅作历史记录，不代表当前保留该能力。本次缩减没有修改已部署的webrtc接口，也没有发布插件制品。
