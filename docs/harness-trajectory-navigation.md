# Harness 轨迹入口收纳

Arkme 嵌入的 Harness 对话页默认隐藏“对话 / 轨迹”标签行，在原有右上角“更多操作”菜单中增加“查看轨迹”。轨迹视图显示“← 返回对话”。

标签行隐藏时同时释放官方标题栏为双行导航保留的最小高度，标题栏由当前内容自然撑开，并保留 10px 下间距。该布局规则仅在标签行成功适配时生效；恢复原标签或卸载适配时，官方标题栏样式自动恢复。

## 与官方升级的边界

- 仅在 Arkme 的 `arkme-harness-embed=1` 文档加载独立的 `harness-trajectory-client.js`。
- 保留官方标题栏、菜单、对话、轨迹和输入框组件。切换时点击官方原有标签按钮，复用其视图切换和状态管理；没有复制官方组件或改动其源码。
- 菜单中原有及未来新增的操作保留。新增行在每次打开时读取官方当前菜单的样式类名；返回按钮使用官方主题变量。
- 当前已检查的 Harness 0.1.5-rc.2 没有独立的标签行或菜单项扩展插槽，因此这里采用局部 DOM 适配。将来如开放对应官方入口，应优先迁移。
- 适配只识别中英文“对话 / 轨迹”两个标签以及对应的“更多操作”按钮。出现第三个官方视图、标签变化、入口缺失或菜单结构不兼容时恢复原标签，不强行覆盖新版结构。
- 菜单采用未知结构时，本次标题栏生命周期内停止适配。卸载客户端模块会移除新增控件及样式，恢复原界面。
- 官方版本需要先进入 Arkme 的宿主运行包；本改动不会自动下载官方版本，也不保证未来所有 DOM 结构零适配。

## 验证

```sh
pnpm typecheck
pnpm exec vitest run tests/harness-trajectory-menu.test.tsx tests/harness-embed-route.test.ts tests/deepseek-harness-surface.test.tsx tests/harness-model-client-rc2.test.ts tests/harness-onboarding-client.test.tsx tests/harness-session-client.test.ts
pnpm build
node scripts/verify-harness-trajectory-native.mjs /path/to/harness
```

最后一项从指定安装目录读取官方当前标题栏、视图选择逻辑、更多操作和 Menu 函数，在隔离 DOM 中执行已构建的插件客户端，检查往返切换、原下载操作、草稿元素、焦点和卸载恢复。装饰图标、下载结果对话框及会话数据使用测试替身；不启动 Host、不读取账号、不修改安装目录。

已验证原生组件版本：0.1.5-rc.2。组件验证不等同于完整桌面客户端安装和真实会话验收；真实会话的消息滚动恢复继续依赖官方视图管理。
