# Electron Arkme 会话附件独立预览：实施与验收

## 正确目标与工作区
- arkme-dsh-client：origin/master c3471c6。
- arkme-dsh-plugin：origin/master cddf385（0.1.69）。
- 两仓分支：`zp-codex/arkme-attachment-preview-window`，未提交、未推送、未发布。
- 之前错误定位到 Flutter 的改动保留在另一个隔离 worktree，已停止；不属于此交付。

## 实现结果
- 会话消息中的文件、图片、视频和会话草稿附件进入同一个独立原生窗口；主会话无遮罩，可继续输入。
- 同一附件再次点击只激活；不同附件更新内容，切换会话不销毁已打开预览。
- 800×600 默认、560×400 最小、系统标题栏、不置顶；窗口大小/位置在本次进程内恢复，并按可用工作区校正。
- 复用原文件打开、下载、另存为、图片缩放、视频和动态照片组件。单项隐藏导航，多项保留顺序和序号；方向键尊重视频/输入控件。
- 原生关闭、登出/账号变化、主窗口重新导航/崩溃时清理；切换或关闭时停止旧媒体。
- 搜索、笔记等非会话入口，以及没有 Electron 能力桥的浏览器入口维持现有弹层。
- 安全边界：只允许活动 harness 打开指定名称的 about:blank 子窗口，禁止子窗口导航、嵌入 webview 和任意新窗口；不开放通用 IPC。

## 从原 Flutter 计划调整
Electron 同源子窗口可由主渲染进程直接通过 React portal 渲染，故无需 Flutter 多引擎、file feature owner 或跨引擎快照通信。账号、SDK、下载逻辑仍留在主渲染进程，子窗口不启动第二套业务运行时。保存选择器及剪贴板等依赖焦点的浏览器 API 使用子窗口上下文。
Markdown 沿用 Arkme 现有预览，不引入 Flutter 文档路由或新编辑器。下载任务保留原后端执行机制，关闭 UI 只终止对应轮询和订阅。

## 验证证据
- 两仓 TypeScript 检查通过；两仓正式构建通过；`git diff --check` 通过。
- 客户端相关测试：3 个文件、17 项通过（预览策略、窗口边界、导航、原长文窗口）。
- 插件相关测试：4 个文件、181 项通过（预览宿主、文件 UI、富内容和长文图片）。
- macOS 真实 Electron fixture：10 组检查通过，结果见 `evidence/result.json`。使用真实组件和隔离的模拟 Provider，不使用真实账号数据。
- 覆盖真实文件卡片入口、主聊天可操作、单窗口复用、窗口最小化/恢复、窗口外点击、方向键导航、真实 WebM 播放后切换停播、关闭重开、大小恢复、560×400 操作按钮可见、单项导航隐藏、登出清理。
- 保存 picker 和 clipboard 在子窗口内注入确定性实现，验证调用归属、PNG 转换和跨 realm 取消语义；未冒称人工系统保存对话框/系统剪贴板验收。
- 已完成独立代码审查；发现的保存/复制上下文问题已修复并复核无遗漏。

## 完整测试套件的边界
- 插件第一次全量：664 文件通过、15 文件失败、8 跳过；8077 项通过、107 失败、12 跳过，另 4 个 worker 启动超时。
- 其中 14 个失败文件由 Node 实验性 Web Storage 与 jsdom 冲突导致；设置 `NODE_OPTIONS=--no-experimental-webstorage`，连同 4 个启动超时文件单 worker 复验：18 文件、145 项全部通过。
- 另一个构建生命周期超时文件独立复验：7 项通过。
- 客户端全量进程退出码 137，未获得完整结果。单独复验 `runtime-path.test.ts` 为 14 通过、1 失败：安装的 Git 来源插件依赖缺少 `lib/index.js`（依赖安装跳过 scripts）。未修改该无关运行时测试或伪造构建产物。
- 因此不宣称两仓全套一次性全绿。

## 尚未验收
- Windows 原生实测及截图。
- 真实账号的远端下载/系统保存对话框/系统打开文件/动态照片和通话并行场景。
- 物理多显示器拔插恢复（仅边界算法测试通过）。

## 复现命令
插件目录：
```
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --maxWorkers=1 tests/attachment-preview-window.test.tsx tests/file-ui.test.tsx tests/rich-content-ui.test.tsx tests/long-article-images.test.tsx
pnpm run build
node scripts/build-attachment-preview-smoke.mjs /private/tmp/arkme-attachment-preview-bundle
```
客户端目录（需已安装可运行 Electron 二进制）：
```
pnpm run build
pnpm exec vitest run tests/attachment-preview-window.test.ts tests/long-article-windows.test.ts tests/navigation-policy.test.ts
pnpm exec electron tests/fixtures/attachment-preview-electron.mjs /private/tmp/arkme-attachment-preview-bundle /private/tmp/arkme-attachment-preview-results
```

## 用户实测反馈修复（2026-09-20）
- 根因：独立预览复用弹层容器的自动 focus，保留了浏览器默认 outline、内部关闭按钮和固定标题；媒体操作设置 showDownloadStatus=false 后未将下载结果接入 Toast。
- 修复：仅独立容器去除 outline（按钮键盘焦点保留），仅保留系统标题栏关闭；标题随当前附件文件名变化；文件/媒体保存成功或失败接入窗口内 Toast，取消不提示失败，浏览器下载降级仍只提示交接，不虚报磁盘保存完成。
- 验证流程：核对截图与代码路径 → 加入组件断言 → 174 项相关回归测试通过 → 完整插件构建通过 → 原生 Electron 验证标题/outline/关闭按钮及已有窗口行为。
- dev 已经通过热更新加载新插件，实际窗口可见文件名标题与保存成功反馈。

## PR 集成验证
用户确认提交后，从最新 origin/dev c844d02 创建 PR 分支 zp-codex/arkme-attachment-preview-window-dev，迁入本任务提交，保留 dev 的长文窗口、原生转发和 sourceDisplayName 参数。5 个相关测试文件、187 项测试与完整插件构建通过。原先运行中的 dev 工作区保持不变。
