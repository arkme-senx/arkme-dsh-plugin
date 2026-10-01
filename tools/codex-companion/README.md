# Arkme Codex 连接助手：原生验证版

日常 GUI 和 `doctor` 仍是只读验证模式，**尚未接通 Arkme 接单或云端派发**。0.0.3 新增一个需要开发者显式调用的 `native-test` 入口，仅允许已获用户同意的专用测试对话及固定测试文字，不是任意消息输入接口。不会在启动时自动发送，不修改 Codex 队列文件，不启动另一个 app-server，不占用 3100 或其他端口。

## 构建与检查

需要 macOS 和 Xcode 命令行工具。输出目录必须是不存在的绝对路径；脚本不会覆盖已存在的应用。

```sh
node scripts/build-codex-companion-preview.mjs --out /absolute/new-build-directory
node scripts/test-codex-companion-preview.mjs --app '/absolute/new-build-directory/Arkme Codex Companion Preview.app'
```

产物使用本机临时签名（ad-hoc），尚未开发者签名或公证，不是发给同事安装的正式发行包。构建不会安装或运行应用，不会添加登录启动项。

## 使用

1. 双击构建出的 `.app`，菜单栏出现 `Arkme ↔ Codex`。未授权时自动显示简洁的权限引导；可随时从菜单「权限设置与引导…」重新打开。
2. 在本机 macOS 27 中按钮为「打开『设备控制和数据访问』」，旧版为「打开『辅助功能』」。使用同一个原生设置深链，直达「系统设置 → 隐私与安全」里的相应权限页，而不是侧边栏的「无障碍」分类。
3. 在系统页面中由用户为 `Arkme Codex Companion Preview.app` 开启权限。列表没有助手时，使用「找不到助手？在访达中定位」，再在权限页按「＋」选择该应用。不要替代为给 Terminal 或 Codex 授权，也不要关闭系统安全保护。
4. 返回助手或切回其他应用时自动检查授权状态；引导可见时每秒做轻量检查，从助手去设置后也会短时检查。不会重复弹出权限请求或每秒扫描对话。权限被撤销时同步退回未授权；授权后仍明确显示「自动输入仍未开启」。权限检查必须在独立启动的助手内通过，开发工具子进程的通过结果不能替代它。
5. 「保存只读诊断…」会重新检查并只保存结构、数量、控件可写性和权限状态，不导出消息、草稿、对话标题或文件路径。
6. 可随时点击「退出助手」。这个版本没有后台服务和登录启动项。

注意：系统返回 URL 打开成功只表示收到跳转请求，不证明到达了正确页面，更不代表用户已授权。无法打开时显示失败说明；即使系统只打开首页，引导也始终提供准确路径和应用定位兜底。这里不会在助手尚未授权时，额外控制系统设置来替用户定位或开启权限。

命令行 `Contents/MacOS/ArkmeCodexCompanion doctor` 只输出 JSON 并退出，不创建菜单或申请权限。除下方严格限制的 `native-test` 外，其他参数以 64 退出，不会被当作消息执行。

## 当前实测与剩余门槛

2026-09-30，安装的 Codex bundle ID 为 `com.openai.codex`，版本 `26.924.22138`，应用目录名称是 ChatGPT.app。

- 原生 Swift 程序在开发进程下可读取 1 个窗口和 1 个输入区域；输入区域报告 AXValue 可设置。没有执行设置或发送。
- 通过 macOS Launch Services 独立启动后，`accessibilityTrusted=false`，如实返回 `accessibility_permission_required` 并停止窗口读取。因此不能宣称独立助手已具备用户授权。
- 当前窗口的 AXDocument/AXURL 没有提供可验证的 Codex 对话 ID；标题相同、输入框存在、AXValue 可写都不能替代准确目标验证。
- AXValue 非空不一定就是用户草稿，可能包括控件提示文字；不能据此自行清空。实际输入适配器必须独立验证编辑内容和附件。

2026-10-01 授权引导更新：独立 0.0.2 验证版已启动，已检查原生窗口文本并截图确认排版；实际从助手点击直达按钮后，系统设置窗口标题为「设备控制和数据访问」，其中出现助手名称。21 项纯状态与页面命名测试、签名/plist、只读诊断和非法命令拒绝检查通过。真实系统权限开关保持用户操作，未以测试方式开启/撤销权限，因此真实授权切换后的端到端验收仍待用户完成；原生入队也仍未验证。

后续需要先得到独立应用权限，再在用户明确允许的专用测试对话中验证：准确定位对话、保留草稿和附件、忙碌时 Queue 而非 Steer、空闲时接受、读取新队列条目/接受凭据、遇到用户操作停止、不重复发送。

### 2026-10-01 授权修复与原生可行性验证

已确认同名 ad-hoc 测试包存在签名不一致：系统原有授权绑定旧二进制，不能授权新二进制。固定试用位置为 `/Users/tison/Applications/Arkme Codex Companion Preview.app`，复制时保留原签名；用户移除旧权限条目、添加正确应用并开启权限后，独立 Launch Services 诊断返回 `accessibilityTrusted=true`，正在运行的窗口也显示「已授权」。后续不能反复用新签名的构建覆盖这个已授权实例；固定路径不等于稳定签名。

用户明确同意创建「Arkme 原生入队验证」专用对话后，开发测试程序 `validation/main.swift` 完成了以下真实 UI 验证：

- 使用原生 `codex://threads/<UUID>` 导航，再通过「聊天操作 → 复制 → 复制深度链接」核对 UUID；复制检查后恢复剪贴板，拒绝不匹配的目标。
- 原生输入框的空状态包含占位文字，必须同时检查 ProseMirror 的 placeholder 结构；已有测试草稿时再次填入被拒绝，原草稿保留。
- 原生 AXValue 写入固定无业务操作的测试文字，点击「发送」后收到 `ARKME_NATIVE_IDLE_OK`。
- 前一轮只等待 45 秒；忙碌时只点击已实测的「排队」按钮，不更改默认 follow-up 设置、不调用 Steer。界面显示新条目，针对测试 UUID 的只读队列检查也发现新条目；前一轮完成后执行该条并回复 `ARKME_NATIVE_QUEUE_OK`。
- 发起提交前用独占创建、fsync 持久记录提交意图；复用同一意图文件时拒绝再次提交。仅清除了程序自身重新暂存、且全文匹配的测试草稿。
- 原始业务对话未输入测试文字，没有改写 Codex 队列数据库或安装新 app-server。

**证据分层：这些输入测试由开发进程启动的原生测试程序完成，不是当前独立只读助手，也不是 Arkme → 常驻助手或跨电脑端到端验证。** 当前已授权助手的二进制未替换，它仍不接受自动输入。测试程序只允许固定 fixture 文本，不能作为开放的远程发送器；不将开发进程继承的权限当成新产品包已获授权。

自动安全检查（不操作真实界面）：

```sh
node scripts/test-codex-native-validation.mjs
```

仍需：把输入执行器集成到具有稳定身份的独立助手、明确授权后验证；补齐附件/锁屏/用户同时输入/多窗口/焦点恢复等保护；接入 Arkme 本机请求与回执；云端下发仍等待后端契约。原生按键成功或输入框清空均不代表送达成功，结果不明不能自动重发。

在以上门槛通过之前，`nativeQueueSubmissionVerified` 始终是 `false`，不开放 Arkme 发送入口，不安装后台派发服务。

官方行为参考：[排队与引导](https://learn.chatgpt.com/docs/prompting#steering-and-queuing)。此说明仅用于区分行为，不证明该验证版已经实现任一种提交。

### 2026-10-01 01:12 开发检查点（尚未接入 3100）

- `src/team-codex-dispatch-journal.ts`：本机持久请求与明确的输入授权隔离；账号/团队/来源/任务固定绑定，同 requestId 幂等，持久提交意图，unknown 不重发；物理执行通道串行，必须证实旧执行器已停止才可恢复，不能用租约超时偷走仍可能发送的执行器。
- `src/team-codex-dispatch.ts`：异步执行协调、登录/撤销围栏和原生适配器边界。当前只用假适配器测试，没有装入 Host。
- `CodexDispatchComposer.tsx`：已按用户确认的简约布局实现输入框组件和状态，中英文齐全；重试保存保留 requestId，不把旧请求的成功展示为新请求成功。尚未挂载到正式对话区，也未更新 3100。
- `NativeInput.swift`：从开发验证程序分离出的候选原生输入适配器，增加版本/控制权限/锁屏/用户活动/附件及草稿结构/提交模式检查；编译和纯策略测试通过，不代表所有真实原生边界已验收。
- `NativeValidation.swift`：新助手 0.0.3 的受限显式测试入口。仅接受 `01a0f330-ac7b-7893-a977-f18dd8ea8abf` 专用对话与 `idle / busy / queue` 固定测试文字；另检查 `ARKME_NATIVE_READY` 标记，不能用于业务对话。独占文件锁防多个测试进程同时操作；private 目录和不可覆盖的 fsync 意图文件防误覆盖与重发。输出只有 `delivery=unconfirmed`，需另核对新队列条目/回复。

新包位于 `/Users/tison/arkme/.codex-artifacts/codex-dispatch-companion-20261001-ofySZu/build/Arkme Codex Companion Preview.app`。签名/plist、21 项权限状态检查和非法命令拒绝检查通过。**通过 Launch Services 独立启动 `doctor` 后，`accessibilityTrusted=false`**，报告保存在同级 `independent-doctor.json`；未调用这个包的 `native-test`，没有发送新测试消息。

已安装且由用户授权的 `/Users/tison/Applications/Arkme Codex Companion Preview.app` 保持原二进制和签名。更新新版本到固定位置前需保留可恢复旧包，并由用户重新完成系统授权；不要用开发进程继承的授权代替，也不要静默修改 TCC。

接下来的门槛依次是：新助手独立权限与真实输入回归 → 账号/团队绑定的本机接单与可靠回执 → 挂载已经确认的 Arkme 输入入口与显式自动输入开关。云端 command 接口仍未提供，不能借用上传接口伪造派发。

### 2026-10-01 输入入口预览（不启用派发）

用户确认不修改 Arkme 客户端，继续走独立助手路线。`CodexDispatchEntry` 已挂载到本人本机任务的对话底部，点击输入区、加入队列或连接助手均可查看说明；当前固定为 `integration_pending`，没有传入提交回调。其他电脑的任务提示云端派发未接通，同事任务仅可查看。说明明确区分系统授权、同步记录与自动输入，不提供尚未就绪的安装链接或假连接检查。

本次只替换 3100 独立预览的 `client.js` 与 sourcemap，替换前已备份至 `before-codex-entry-20261001-3ujYH7`；未重启服务、修改状态数据库或替换已授权的助手。类型检查、生产构建、173 项相关回归与另 3 项 DOM 点击/焦点回归通过。3100 实页确认入口、说明文字和键盘打开/关闭；鼠标事件另由 DOM 回归覆盖。输入入口可见不代表本机或云端派发已接通。

纯策略/组件测试（不会原生输入）：

```sh
node scripts/test-codex-native-input.mjs
pnpm exec vitest run tests/team-codex-dispatch.test.ts tests/codex-dispatch-composer.test.tsx --maxWorkers=2
```
