# 独立截图编辑器入口

桌面截图继续使用既有 `arkmeScreenshot` v1 IPC 与主进程截图 lease。这里只分离页面启动入口，不新增业务能力或截图持久化。

- 插件提供 `GET/HEAD /arkme-self/screenshot` 与 `/arkme-self/screenshot/editor.js`。
- 支持的入口返回 `X-Arkme-Screenshot-Editor: 1`。HEAD 无响应体。
- 页面只挂载既有 `ArkmeScreenshotWindow`，bundle 自带 React，不加载插件公共入口、Harness 模块图、账号或会话 UI。
- 页面禁止业务网络连接与 frame；图片仅通过主进程授权 IPC 获取。HTTP 路由只返回静态代码，不承载截图数据。
- 主窗口加载新版插件时调用 enableStandaloneEditor("reset-v1") 登记能力；主进程仅接受当前主窗口的同源顶层 frame 登记，并绑定 origin 和窗口 ID。截图触发路径不发起网络探测，不缓存探测失败。没有登记的旧插件继续使用原入口。
- 新入口使用专用 `screenshot-preload.cjs`，仅暴露编辑器需要的截图 IPC。主进程仍检查来源主 frame、origin、窗口 lease、owner 和账号 scope。
- “问 DSH”继续转发到主窗口完成附件准备，不在截图页面初始化 DSH。
- 新插件配旧客户端仍使用旧路径；新客户端配旧插件自动回退。完整优化需要两者都包含此改动并重启客户端。

构建通过 `tsdown` 的 screenshot-editor 配置输出 `lib/screenshot-editor.js`，随 npm 包的 `lib` 文件清单分发。

## 验证

路由测试覆盖轻量 HTML、HEAD 探测、无业务连接 CSP、方法限制。客户端测试覆盖能力登记来源限制、版本回退、独立 preload、旧路径、lease 生命周期。
Electron 集成测试使用生产 HTTP handler、production bundle、专用 preload、真实抓屏与生产截图 IPC，断言没有 Harness boot graph 或 arkmeDesktop 业务 bridge。
相关客户端 fixture：`tests/fixtures/screenshot-standalone-electron.cjs`。需要为 fixture 单独编译 route：

```sh
pnpm exec tsdown --no-config src/screenshot-editor-route.ts --format esm --platform node --out-dir lib/screenshot-test --no-dts
```

此集成测试属于独立进程验收，不等同于已经更新用户正在运行的正式应用。


## 预热与连续复用

客户端提前加载空白独立编辑器，context IPC 在没有授权截图时等待，不提前抓屏、不接收业务数据。普通 SPA/子 frame 导航不清理能力，主文档重载、关闭及屏幕配置变化会清理。

reset-v1 客户端在截图结束后隐藏并复用编辑器，发送 reset 事件。独立入口通过 React key 同步卸载上一轮组件，撤销图片 URL、清除图片引用与画布，重新等待 context。每轮 context 携带 requestId；ready、select、close、profile、complete、save、askDsh 都传回本轮标识，主进程拒绝旧轮回调。账号失效时直接销毁截图窗口。旧客户端忽略可选参数，旧插件未声明 reset-v1 时不复用。

客户端 macOS 预览 PNG 使用经过逐像素比对的无损低压缩编码，仅优化本机 IPC 前的编码成本；最终导出不变。不能以降低截图分辨率或改用 JPEG 作为速度收益。

连续 Electron fixture 验证 10 次窗口 ID 不变、每轮 reset 后无 canvas 或编辑器节点、窗口隐藏及无业务桥。真实 dev 性能数据记录在客户端 docs/diagnostics/screenshot-latency-20261102/README.md。
