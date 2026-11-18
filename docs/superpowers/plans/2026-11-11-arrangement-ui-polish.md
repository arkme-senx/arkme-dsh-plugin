# 安排界面精细化美化实施计划

目标：落实用户已确认的低保真原型，仅美化安排分类、任务列表和右侧详情。
技术：React、现有 Phosphor 图标、局部 CSS，无新增依赖。
约束：最左侧系统导航、背景色变量、三栏宽度、响应式布局、业务数据与交互保持不变。保留原有标题展开和识别过程展开行为。

- [x] 调整 arrangement-workspace.css 的分类、列表与详情排版；沿用背景和选中色。
- [x] 在 DetailPane、OccurrenceTimeline、RecognitionInspector、RecognitionViews 增加同风格语义图标、状态样式钩子；不修改事件与请求逻辑。
- [x] 运行安排工作区、识别过程及时间轴相关测试和类型检查；检查长文本、空值、窄屏、深色主题与减少动画设置。
- [x] 对照基线核查系统导航和背景声明未变，记录验证结果。

本次不提交、不推送；原工作区用户修改保持原状。

验证记录：四个安排测试文件共 31 项通过；最后一轮 CSS 调整后样式测试再次通过。实际组件使用示例数据导出并经 Chrome 桌面截图检查，包含识别过程展开和长标识换行。背景变量、安排分类背景声明、系统导航及列表业务组件与基线一致。
全量 TypeScript 检查存在共享 node_modules 与最新 dev 不匹配的既有错误；在独立未修改基线 f0298218 上运行同一命令，错误输出逐字一致，本次未新增类型错误。尚未在完整桌面宿主内验证，也未进行深色和窄屏截图验收。

追加已确认设计：安排分类五项分别使用 Sun / CalendarDots / CalendarBlank / CheckCircle / Trash，16px regular，间距 8px；默认中性灰，选中继承蓝色。不修改系统导航或列表任务图标。

完成按钮修复（用户已确认）：根因为工作区通用 button:not(...) 重置的优先级高于完成按钮，默认背景透明、文字继承深色，hover 仅恢复深色背景。限定 footer > button.arkme-arrangement-create-finish 提升优先级，沿用主按钮主题变量及原禁用透明度，不改创建逻辑。

完成按钮修复验证：Chrome 使用真实 CSS 加载顺序检查浅色/深色变量下默认、hover、disabled、disabled+hover 的计算样式均通过；创建及样式相关 12 项测试通过；完整构建通过。

用户追加并确认原处编辑方案：标题 PencilSimple hover 编辑、失焦/Enter 保存、Escape 取消；提醒 Switch；提醒时间笔图标与日期时间浮层，完整有效选择自动保存。新接口 /arrangements/edit 带 expected_version，冲突保留草稿；后端工作区见 ../arrangement-inline-edit-20261111/jotmo-intelligent。测试记录与跨仓合同见同组 meta OpenSpec change。
