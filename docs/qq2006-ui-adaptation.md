# QQ2006 UI 二次适配与来源说明

## 定位

本仓库中的 QQ2006 风格界面不是 Arkme、DeepSeek 或腾讯官方皮肤。它是在社区 QQ2006 皮肤基础上进行的二次改编，并在 Arkme 插件侧重新实现和接线，以完整适配当前 Arkme 桌面会话壳层与受支持的 DeepSeek Harness 插件运行时。

适配范围包括：Arkme 功能导航、账户与会话目录、好友和群聊标题区、原版尺寸工具栏、列表式消息、输入区、发送区、皮肤状态桥接，以及 Arkme 工作台入口。所有 QQ2006 样式均限定在皮肤属性作用域内，默认 UI 不加载这些视觉覆盖。

## 来源与许可

- QQ2006 皮肤设计、组件映射与 DSH 适配参考：[LaplaceYoung/dsh-qq2006](https://github.com/LaplaceYoung/dsh-qq2006)，插件代码采用 MIT License。
- QQ2006 图像素材提取来源：[mengkunsoft/QQ2006](https://github.com/mengkunsoft/QQ2006)。该来源说明素材取自腾讯 QQ2006，素材版权归腾讯公司所有，仅供学习交流，请勿用于商业用途。
- DeepSeek Harness 插件机制与公开扩展点来源：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，采用 MIT License。

本二次适配不改变上述来源的许可与权利归属，也不表示 Arkme、DeepSeek 或腾讯对该界面提供官方背书。

## 二次改编内容

- 将原本依赖 DSH 宿主组件源码的界面细节迁移为 Arkme 插件自身拥有的 React 组件、皮肤桥接和局部样式。
- 将 QQ2006 工具栏映射到 Arkme 的真实搜索、联系人、会话、通话、录音、日历、世界、市集和刷新动作，而不是只保留装饰图标。
- 为 Arkme 私聊、群聊、发给自己和 DeepSeek Harness 嵌入会话统一标题、工具栏、消息区与输入区表现。
- 通过运行时能力探测、动态路径和 Profile/Bundle 合成接入 DSH，不写死开发机目录、端口或进程。
- 保持默认皮肤零污染；关闭 QQ2006 皮肤后，新增 UI 结构不会显示。

## 兼容性口径

“完全适配”指本次二次改编所覆盖的 Arkme UI 场景已经在当前 Windows Arkme 桌面端与受支持的 DeepSeek Harness 运行时中完成构建、安装和真实页面交互验证。样式与资源实现不依赖 Windows 绝对路径，但 macOS 和 Linux 仍应以各自平台 CI 或真机结果为最终兼容证据。
