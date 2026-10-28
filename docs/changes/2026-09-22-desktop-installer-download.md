# 旧 Arkme 插件内安装包下载

按 2026-09-22 已确认方案实现；不修改官网或 Flutter 客户端，下载完成不自动运行安装包；用户点击“开始安装”后打开系统安装向导。

## 接口与发布顺序

复用 `GET /api/public/v1/arkme/app-update/:platform/:architecture/latest`，从同一发布记录读取原有 `downloadUrl`、版本和构建号。2026-10-08 调整：不要求 `installer`，不在发布时下载校验安装包或生成元数据。根据平台要求可信 HTTPS 来源的 PKG／EXE 直链。客户端升级后再移除后端可选旧字段，避免旧迁移插件依赖元数据而停止提示。Windows 新客户端与 macOS 一样发送 `installation=jiwo-v3-cc-jiwo-arkme`；3.x Windows 更新地址不给旧身份。

## 本地实现

Host `AppMigrationManager` 独立于插件更新与桌面自动更新器。仅受桌面管理、带有效本机桥接配置且环境中的客户端版本低于 3.0 时启用。浏览器侧额外要求桌面 preload 版本和 loopback 页面；Host 请求必须来自本机、当前页面 Origin。七个 `app.migration.*` 操作（含用户主动触发的 install）只接收检查模式/任务 ID，不接受下载 URL、路径或命令。

状态位于桌面实例根目录的 `app-migration/<environment>/state.json`，从 `dsh-containers/<account>/dsh` 回到实例根目录，独立于账号。自然日成功检查去重，失败冷却 15 分钟，手动检查绕过；弹窗实际展示后确认送达，避免插件重启重复提示。已下载的安装包在启动或窗口聚焦时检查本地文件和记录大小后重新提示待安装；普通轮询不会重复打开已关闭的弹窗。

流式写独占临时文件，从 HTTP Content-Length 获取总大小，有总大小时显示百分比，否则显示已下载量及不定进度条。不依赖发布摘要、不计算 SHA-512、不显示校验阶段；仍拒绝空响应、分段响应及已知长度不完整的响应。同步落盘后发布。macOS 通过系统 JXA 调用 renamex_np(RENAME_EXCL) 原子无覆盖移动；Windows 使用系统 File.Move 的无覆盖重命名以支持 Downloads 重定向到不支持硬链接的卷。名称冲突增加序号；仅在用户点击“开始安装”后打开当前已完成任务的安装包：macOS 使用 open，Windows 使用支持 UAC 的 ShellExecute；不静默安装、不替用户确认安装。打开失败时保留“打开安装包所在目录”作为兜底。Windows 从 Known Folder 注册值展开真实 Downloads 路径。重启不续传，删除记录中本任务临时文件；完成文件检查是否为普通文件及是否与本地记录大小相同后复用；同大小内容变化不检测。兼容旧状态中保存在 target 上的大小。取消和运行时退出会中止下载。

## 实施记录

- 后端制品匹配及新旧身份分流；桌面 Windows 标记；插件 Host、界面、设置状态入口。
- 回归中捕获并修正：请求发出前取消；手动打开更新入口不刷新目标；已完成文件被删除后的重新下载入口。
- 状态文件写入串行化，避免后台完成与“稍后提醒”同时写入产生旧状态覆盖。
- 品牌检查仅放行此迁移功能明确要求的目标名称、文件名和内部键，其他页面保持 Arkme。
- 本次不提交、不推送、不部署，也不发布制品。

## 实机验收（发布前）

需要在真实旧版 Arkme 上验证插件加载兼容性、macOS 与 Windows 的下载目录和定位行为，以及“提示 → 下载 → 手动安装 → 3.x 不再提示”。Windows 尤其覆盖 Known Folder 重定向与 exFAT/网络目录；空间不足、用户取消、权限不足、应用退出需实机注入。最终制品必须按原 PKG/ZIP 或 EXE 发布流程签名校验。这些实机结果不能用模拟网络单测代替。

## 本地验证结果

- 插件全量：`NODE_OPTIONS=--no-experimental-webstorage vitest run --maxWorkers=2`，558 个文件通过、7 个跳过；6640 项通过、9 项跳过。Node 25 自带实验性 Web Storage 与既有 jsdom 测试冲突，因此仅在测试进程关闭该功能，不改产品配置。
- 插件类型检查、`pnpm run build` 通过。
- 桌面端全量：95 个文件通过、3 个跳过；822 项通过、9 项跳过。
- 后端 `go test ./internal/arkme -count=1` 通过；`gin/api` 测试已编译。执行完整 API 测试因缺少本地 `config.yaml` 的全局初始化而受限，没有连接生产服务或为测试新增生产配置。
- 读取已挂载的官方 `arkme-0.3.3-vc13-universal.dmg` 内 app.asar，确认旧 main 提供 `ARKME_APP_VERSION`、preload 提供 `appVersion`，supervisor 提供 managed restart 和完整 desktop bridge 环境；这是静态兼容证据，不代表已完成真实升级链路。
- 全量测试依赖临时本机监听端口，需在允许 loopback 服务的测试环境运行。
- 最后补充 ENOSPC、EACCES 和流中断注入测试均通过；包含品牌检查的 5 个专项测试文件共 32 项通过。Host 同源边界用例已包含在上述全量回归中。
