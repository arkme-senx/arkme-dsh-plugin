# 完整记录导出接入（2026-10-29）

插件基线：e828510d704c398b8e695880506809689f6d0c67，分支 codex/c20261029-record-export。开发期间 official/dev 新增 039e2130（说话人证据），收口时 ahead/behind=0/1；本任务未自动重放未提交改动，提交 PR 前需同步并复验。
客户端只读参考：origin/master 2b7d97998e53650584b1a1bc9a999733dd94d893；使用现有同源文件下载，无新增原生 bridge。
DSH 机制参考：dsh-v0.2.1-rc.2；参考仓初始 tracked clean，已有未跟踪 arkme-id.json 保留。

需求 → Record 导出会话合同 → 插件统一 Host owner → UI / Tools / SDK → 账号切换与取消中断、失败回报和临时文件清理。

| 能力面 | 设计 | 验证状态 |
| --- | --- | --- |
| Host | RecordExportService 唯一执行 owner，调用 Flutter 相同 start/page/batch-sign/finish；仅当前账号，默认隐藏隐私锁 | ZIP/失败/账号隔离/取消测试通过 |
| UI | 数据管理 → 导出，预检、确认、进度、取消、ZIP 下载与失败重试 | 官方 DSH 页面确认、生成、下载通过；浅色/深色/窄屏截图已检查 |
| Tools | preflight 只读；完整导出独立 explicit-user-write grant，返回不透明文件引用 | 官方 Agent 发现并调用预检通过；正式会话授权与导出测试通过 |
| SDK | 能力探测、公开类型、AbortSignal 与 dispose，复用 Host；不暴露签名 URL / Token | 打包后的仓外 Consumer 编译、调用与 dispose 通过 |
| Client | 既有 local files 下载路由与 Electron 下载机制，客户端源码不改 | 实际 Electron 43.2 客户端入口已完成正文、图片、语音导出与原生下载，见桌面补验 |

工作负载：单账号一次完整导出；100 条/页、附件顺序下载、流式 ZIP、单实例导出互斥；总时限 30 分钟、单附件时限 2 分钟；沿用生成制品 1 GiB/文件、2 GiB 留存、1 小时有效期。页数及记录数有上限，异常显式失败。离开页面、账号切换或插件卸载取消在途工作。

本任务仅开发与本地验证，不发布、不替换常驻实例、不修改插件版本或根 README。

## UI 重设计

以当前 Arkme 设置页及 `arkme-theme.ts` 的语义颜色为准：简化标题和说明、三列备份数量、分隔线设置行、单选顺序控件及一个主操作。确认使用现有 ArkmeConfirmDialog；进度、取消和完成后的文件下载保持同一区域。浅色、深色与 860px 窗口已查看实际截图。

## 验证记录

- Node 24.22.1 下 `pnpm typecheck`、`pnpm build` 通过。
- Host：真实 ZIP 与附件字节一致；缺签名、截断、非法下载地址、游标/数量不一致、账号切换、取消、互斥与 finish 响应丢失均有测试。旧附件 size=0 按未知大小下载，实际字节仍受总容量约束。
- Tools：未修改的官方 DSH 0.2.1-rc.2 新 Profile 中真实 Agent 发现两个导出工具并调用 preflight；正式 ToolRuntime/Session 的授权确认与完整导出由 `tests/tools/record-export-runtime.test.ts` 覆盖。
- SDK：将不可变 tgz 安装到带空格路径的全新 Profile，仓外 Consumer 类型编译、能力发现、调用、下载引用与 dispose 通过。
- UI：官方 DSH 中实际进入数据管理、确认、生成并下载 ZIP，独立 Python zipfile 解压与 CRC 校验通过；使用隔离模拟服务和测试身份，没有真实账号请求及额度消耗。
- 分发包：插件版本仍为 3.0.35，共 3225 个包条目；扫描 JS/JSON/YAML/map/声明文件无本机用户绝对路径。产物 SHA256：`96a0e1a39ce86b6dc028cee715404d190d6d6acac26786844a54cc433ec2d66b`。
- Client：最初启动被 Profile 依赖及开发依赖图阻塞；2026-10-29 后续补验已解决本地装配并通过真实 main 入口的桌面导出，详见下节。
- DSH 参考仓 tracked 状态仍干净；客户端源码未修改。Windows/Linux、真实 TEST/生产账号附件及已安装客户端未验收。

证据保存在任务制品目录 `record-export-20261029`：`official-redesign/result.json`、浅色/深色/窄窗口/成功截图，`redesign/senguoyun-dsh-arkme-3.0.35.tgz`；`desktop-redesign-2` 保留桌面启动失败诊断。

尚未提交、推送或创建 PR，未发布运行环境制品或修改常驻客户端。

## 全量测试最终结果

最终源码使用 Node 24.22.1 完整执行 `pnpm test --maxWorkers=4`，耗时 620.41 秒：1289 文件通过、1 文件失败、18 文件跳过；14515 用例通过、1 用例失败、24 用例跳过。未过滤或提前停止。失败为未改动的 `tests/realtime-dictation-service.test.ts:119`，真实计时等待后仍处于 finishing 而非 finished；该测试及 owner 与基线逐字节相同，单独完整复跑该文件 13/13 通过。此前补旧附件兼容前全量 14515/14515 通过。最终全量门禁如实记为非全绿，不能以单文件重跑替代。

最终全量日志：任务制品目录 `full-tests-final.log`；单文件复验：`dictation-recheck.log`。没有为此次偶发失败修改无关听写源码或测试。

## 桌面补验（2026-10-29）

用户追加授权解决桌面依赖阻塞、启动可见客户端并验证完整导出。本轮未修改业务源码、客户端源码或版本字段。

### 环境与依赖

- 原验收先由 pnpm 10.28.2 安装、客户端再用 11.19.0 校验，导致新选中的间接依赖违反 minimumReleaseAge。改用客户端随附 pnpm 11.19.0 从安装阶段解析，安全策略保持原值；通过官方 DSH CLI 的 ARKME_PNPM_CLI_PATH seam 指定相同包管理器，并通过客户端现有 provisionArkmeWebProfile 准备 Profile。
- 客户端源码 checkout 的 node_modules 缺少发布运行时已有的 Electron 43.2 兼容装配，且 Bundle 解析触及旧插件。最终在任务制品中的 desktop-runner 放入逐字节未改动的客户端 dist（基线 2b7d97998e53650584b1a1bc9a999733dd94d893），消费已安装的完整运行时 Release `electron-runtime-v1-a3a98c843be9b87f5b6e7b2e47379eda` 的副本。复制前核对 install-receipt 全部文件摘要通过；未修改此 Release 或 DSH 参考源码，未替换常驻实例。
- Electron 使用客户端现有 43.2.0 二进制，未降级或修改依赖 pin。端口完全由实际 main 的 supervisor 分配，Profile 不再覆盖桌面端口。
- 插件通过 ARKME_PLUGIN_PATH 开发入口消费本任务构建；2965 个 lib 文件与已验证不可变 tgz 逐字节一致。此证据属于开发桌面 E2E，未声称动态 Release Set 的正式发布和安装验收完成。

### 完整导出结果

`desktop-complete-8/result.json` 与 `native-download.json` 记录通过：当前真实客户端主入口启动并显示新导出页；2 条样例跨两页读取、1 张 PNG、1 段 WAV，经确认后创建一次会话、签名与下载两份附件、完成一次 success=true 回报，最终由 Electron 原生 will-download/done=completed 保存本地 ZIP。

`archive-validation.json` 记录独立 ZIP 检查：2480 字节，CRC 通过；Markdown 含两条完整正文与两条可解析的本地附件链接；PNG 68 字节、WAV 1644 字节均与原始样例逐字节一致。ZIP SHA256：`7f1ee0edffbe67bc6b6033f98b0882219a34114dd5564f24a63acf70d1926476`。

上游使用本地隔离 HTTPS 合同样例；媒体通过本次进程专用 HTTP CONNECT 代理路由到样例服务器，证书校验保持启用，未改变业务下载 URL 校验或调用真实账号。因此这是桌面完整导出链路验收，真实 TEST/生产数据及 Windows/Linux 仍待验收。

客户端按用户要求保持打开在「备份已就绪」页；运行信息保存在 `desktop-complete-8/desktop-live.json`，控制进程退出时关闭本次客户端与样例服务。失败尝试的日志保留供追踪。未修改源码，因此本轮没有重复全量单测；此前记录的听写时序用例偶发失败仍如实保留。

## 正式服本地运行（2026-10-29）

用户明确要求确认无后端改动后运行正式服 Arkme。已核对：本任务仅修改插件与验证文档，Record 后端只有只读参考，tracked 工作区无改动；复用既有 preflight/start/page/batch-sign/finish 合同，不需要随本任务部署后端。

正式服实例已启动在独立 `production-live-2` App Data，使用插件自身完整生产配置（api.jotmo.cc / record.jotmo.cc 等），没有本地样例服务或模拟登录 Probe。通过实际客户端同源 `provider.capabilities` 验证 HTTP 200、environment=prod、recordExportV1=true。页面已显示正式账号登录入口。尚未登录或自动创建真实导出任务，真实正式数据导出结果待验收。

实例运行信息与能力证据分别为 `production-live-2/desktop-live.json`、`capabilities.json`、`production-origins.json`；本次样例验收窗口已关闭，其他常驻客户端保持原状。该操作是本地客户端连接正式后端，不是 npm/Release Set/后端生产发布。

## 隐私设置 UI 补验（2026-10-29）

用户追加要求确认“锁定表态操作记录”的作用并按 Arkme 风格整理。此项沿用已有 history-policy query/set 接口及 revision 并发保护：开启后阻止表态历史在数据管理、时间轴和 AI 查询中读取，不撤销消息上的表态。已只读核对 Record 的 policy 保存和锁定读取测试；无后端改动。

将原生 checkbox 与大段说明替换为“表态记录隐私锁”设置行，标题下附简短说明，右侧 Arkme 开关；“文字背景音”复用同一行样式。支持主题、窄窗口、键盘焦点、读取/保存禁用态、错误重试；切换账号时清空旧 policy。沿用现有 Host/SDK/Tools 合同，无新增能力或权限。

- 最小相关测试 4 文件、28 用例通过，含读取失败重试、明确点击才写入、revision 冲突与账号隔离。
- Node 24.22.1 下 typecheck、build、pack 通过。完整运行 pnpm test --maxWorkers=4：1291 文件通过、18 跳过；14521 用例通过、24 跳过，耗时 258.87 秒。本轮全量全绿；此前听写时序失败保留为历史记录。
- 新不可变包 privacy-ui/senguoyun-dsh-arkme-3.0.35.tgz，SHA256：cea79a0c856b7c721dcd1433497e22231f63c190546f56b8a9caf8f545053eab。旧导出验收包未覆盖。
- 新包安装到官方 DSH 全新隔离 Profile，实际 UI 查询、锁定、解锁通过；请求 expected_revision 分别为 0、1，最终 revision=2。浅色/深色/680px 窄窗口截图已检查。证据 privacy-ui/official-profile-2/result.json。
- 已登录的正式服独立客户端刷新到本轮构建，实际 policy 读取成功，开关可用并保持原 false。只读查看，未写入正式隐私值；页面停留在隐私设置供用户查看。证据 privacy-ui/production-general.json 与 production-general.png。真实生产锁定/解锁未执行。
- 客户端与 DSH tracked 源码未修改；未提交、推送或发布。
