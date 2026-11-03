# 登录设备管理

本功能沿用已确认的 596px 弹窗和头像入口。设备名、在线状态、上次活跃、本机、退出、两类手机提醒、常用设备和登录日志保持原信息层级；不恢复常见问题、状态解释和平台副标题。

## 接口与权限

UI、Tools 和 SDK 共用 `LoginDevicesService`。HTTP 操作名为 `account.devices`，只接受本机且 Origin 与当前 Host 完全一致的请求。SDK 从公开入口 `@senguoyun/dsh-arkme/sdk` 导入 `createArkmeSdk`，先握手 `loginDevicesV1`，然后调用 `loginDevices({ action, accountScope, ... })`；Node 消费者须自行提供指向已验证本机 origin 的 fetch 适配器，不能将此接口代理到公网。

```ts
import { createArkmeSdk } from '@senguoyun/dsh-arkme/sdk'
const sdk = createArkmeSdk()
const page = await sdk.loginDevices({ action: 'list', accountScope: 'test:当前用户ID' })
// 在 UI 中由用户选择目标并确认，不自动确认列表第一项。
```

查询 action：`list`、`trusted`、`events`、`notifications`。退出/移除：`prepare` 返回短效 ticket，真人确认后使用 `confirm`；不明结果使用原 ticket 调用 `operation`。通知写入使用 `set-notifications`，同时携带原 revision 和稳定 requestId。Tools 的写入口依赖宿主真人确认上下文，不接受模型提交的 confirmed 标记。

device ref、cursor、ticket 为账号/登录会话绑定的不透明引用。device ref 和 cursor 有效期 15 分钟，ticket 5 分钟；过期 ticket 只可核实既有操作，不能提交新写入。同用户重新登录也会使旧写引用失效。单页 50 条；设备列表只保留当前页，日志按用户点击“加载更多”追加并按事件 ID 去重，仅保留最近加载的 500 条（10 页），返回第一页可重新读取最新记录，关闭即释放已加载历史。没有后台轮询或新增 WebSocket。

读取复用 Host 请求协调器，按账号、登录会话、路由与参数合并并发请求，不缓存完成结果；单个调用方取消不影响其他调用方。写入前后使该登录会话的读取失效，即使写入回执丢失也不接受旧响应。其他设备发起的变化由手动刷新/重新打开读取，不宣称实时推送。

后端登录会话是权限真相，device-control 只负责本地清理和在线实例。旧凭据不能完整纳管时 `countComplete=false`，入口显示“登录设备管理”，不能展示不完整总数。手机只有声明完整通知协议后才开放开关；设置失败/未知不显示成功。日志有覆盖起点，不补造历史；初版后端每设备最多保留 100 条/30 天。

## 验证与交付边界（2026-11-03）

Host/SDK/Tools/UI 有单元和 jsdom 测试；同源真实 HTTP 边界与打包后的独立 SDK 消费已验证。插件已构建并生成本地 tgz，未修改版本、未发布。

按用户要求，真实 DSH、桌面安装、插件激活、实际页面、Tools 真人确认和跨平台视觉验收暂缓。当前自动化通过不替代这些验收。

后端 TEST 仅两个隔离账号开启纳管。本轮限定桌面设备管理；腾讯通话票据撤销、原生 VoIP/CallKit 改造及移动端新增通知能力不在范围内。旧手机没有声明完整通知能力时，两开关禁用并保持既有通知策略；不能用协议 fixture 的声明代替已安装手机支持。Flutter 仅保留识别 `session_ended` 的既有退出链兼容。

Bury、Jupiter、ASR Stream、旧 Memory、独立 Keyword 不属于桌面 JWT 消费链，已移除联网会话校验与配置；为防止已签发的托管 token 绕过撤销，仅保留本地拒绝其 `sid` 的兼容边界。实际桌面 API 消费者继续校验登录权威。完整证据见 `/Users/apple/hehs/task-artifacts/login-devices-development-20261103/scope-reduction/范围收敛与最终交付.md`。未全量启用、未生产发布。
