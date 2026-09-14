# 消息终端与网络采集

发送时由 Browser 的 `captureArkmeRecordInputContext` 生成既有 `captureContext`，经现有发送、持久化和快照展示链路传递。历史消息只展示其保存的数据。

- Arkme 桌面端：`电脑名（Arkme）`。复用 `arkmeDesktop.startupAuthGate` 标识桌面宿主。
- 普通浏览器无法读取系统电脑名：使用 `系统名（浏览器名）`；系统也无法识别时使用 `未知电脑`。
- `connection.effectiveType` 是速度等级，不能判定 Wi-Fi 或移动网络。连接类型未知时显示“网络已连接”，离线优先。

## 客户端桥 v1

可选的 `window.arkmeDesktop.device.snapshot()` 返回：

```ts
{ schemaVersion: 1, computerName: string, networkType: 'wifi' | 'ethernet' | 'cellular' | 'vpn' | 'bluetooth' | 'unknown', wifiSsid?: string }
```

客户端仅允许当前 Harness 主窗口的主 frame 调用，无入参，不返回接口名、IP、MAC 或命令输出。Wi-Fi 名称通过同进程 CoreWLAN 读取当前接口的 SSID，仅用于 `WiFi（网络名称）` 展示；系统未授权定位而返回 nil 时显示 `WiFi`，不扫描网络、不读历史已知网络、不主动弹权限请求。macOS 读取系统 ComputerName，以及默认路由对应的硬件端口类型。Windows/Linux 当前只提供 hostname，网络类型保留 unknown，优先使用浏览器确实提供的连接类型；原生网络识别与实际平台验收尚未覆盖。

一次采集最多并行执行三个固定系统命令；每个命令限时 600ms、输出上限 64KiB，并发请求合并到同一次读取，不缓存完成后的结果。插件将设备信息和电池采集并行，分别沿用 900ms 超时，异常、未知 Schema 或旧客户端缺少桥均降级且不阻断发送。没有轮询或额外发送操作。

| 能力面 | 本次范围 |
| --- | --- |
| UI | 修正发送时的终端/网络快照，复用既有快照组件 |
| Client | 只读原生设备状态桥；命令失败降级 |
| Host owner | 复用现有 captureContext 保存与投影，不新增路由、业务查询或持久化字段 |
| Tools | N/A：本次是当前 UI 设备状态采集，不新增可供模型调用的业务能力 |
| SDK | N/A：不新增 Host 业务能力；已有快照数据合同不变 |

同时更新插件和客户端才能得到 macOS 电脑名与原生网络类型。只更新插件时旧客户端仍可显示 `系统名（Arkme）`，但不会凭空推断 Wi-Fi。发布、已安装客户端更新和真实发送验收需分别完成。
