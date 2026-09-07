# Markdown 第三轮审核修复结果（2026-09-07）

第三轮报告的 4 类问题已完成修复和本地验证。本轮沿用此前确认的代码字面显示、mention 显示和业务标签效果，改动涉及 arkme-dsh-plugin 与 jotmo_frontend；未修改后端。

## 根因与修复

| 问题 | 根因 | 本轮处理 |
| --- | --- | --- |
| 代码块保存后提前结束 | 默认 writer 固定使用三反引号 | 自定义 CodeBlock writer，围栏长度超过正文中的同类字符序列；语言信息含反引号时使用波浪线。保存再解析仍为完整代码块，代码内的粗体、标签不被激活 |
| 移动端泄出 mention 占位符 | 解析前替换 token，HTML/代码/图片字面节点不会走还原语法 | 用与阅读器相同的语法解析 token 所在上下文；只有实际进入业务行内节点的 token 保留。其余在正式渲染前恢复原始源码，包括转义字符；普通 mention 仍高亮 |
| 行内 HTML 属性和注释激活标签 | 库输出普通 Text，业务扫描失去 HTML 语义 | 扩展现有 InlineHtmlSyntax，将命中的源码包装为 arkme-literal，继续保留原文并排除业务标签扫描 |
| 桌面行中空格后的标签漏高亮 | 已解析的文本片段被再次当成完整 Markdown，四空格误判为代码 | 共享对已解析文本节点的标签解码函数；保存侧与阅读侧使用相同解码和 UTF-16 源范围算法，阅读侧不再重解释块级语义 |

Tiptap CodeBlock 使用已有的 3.31.0 版本，本轮将其声明为直接依赖。保留 StarterKit 原有的扩展排列，避免改变输入法与按键处理优先级。

移动端只在存在有效 mention 时额外解析一次来判断上下文，没有在无 mention 的普通正文上增加这次解析。正文源码与 wire mention 范围不因阅读而改写；恢复字面内容的操作仅发生在本地渲染数据中。

## 关键代码

- [代码块 writer 与扩展顺序](/Users/zhou/Desktop/project/jotmo/worktree/v143/arkme-dsh-plugin/src/client/markdown-editor.ts)
- [共享文本节点标签解码](/Users/zhou/Desktop/project/jotmo/worktree/v143/arkme-dsh-plugin/src/markdown.ts)
- [行内 HTML 字面语法](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo_frontend/lib/shared/record/record_markdown.dart)
- [mention 上下文与恢复](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo_frontend/lib/features/record/presentation/record_content/record_markdown_body.dart)

## 排查与验证流程

1. 读取第三轮的原始失败输出和当前实现，将复现并入正式回归；修改前确认桌面 4 个、移动端 6 个断言按预期失败。
2. 逐项修改根因并运行最小相关测试。替换 CodeBlock 时，输入法回归发现扩展排列影响按键优先级；改为在 StarterKit 原位置覆盖 writer，相关回归通过。
3. 扩大到完整相关测试，检查类型、Dart 静态分析与插件构建；对照本轮开始前的文件快照核对改动范围。

最终结果：

- 桌面 6 个文件、111 项测试通过：编辑器、真实输入组件、阅读组件、标签、草稿；包含三/四反引号冲突、含反引号的语言信息、输入法与 Shift+Enter。
- Flutter 2 个文件、80 项测试通过：正文及转发投影；包含块级/行内 HTML、引用代码、图片原文、行内代码、普通 mention 高亮，以及真实编辑控制器包裹 mention 后保存再读。
- `pnpm run typecheck` 通过。
- `pnpm run build` 通过，插件 lib 产物已更新。
- 3 个本次 Dart 文件的 `flutter analyze --no-pub` 通过，No issues found。
- Dart 格式化及 Git diff 空白检查通过。两端共享 fixture 字节一致，新增行内 HTML 与行中空格标签场景。

证据目录：[第三轮修复日志与差异](/private/tmp/arkme-markdown-round3-fixes-20260907)。包含修改前 baseline.json、changes.patch、失败阶段日志以及最终 desktop-final.log、mobile-final.log、typecheck.log、analyze.log、build.log。

## 验证边界

未执行提交、推送、Jenkins 或测试服发布。本轮未将 Flutter 重新安装到模拟器，也未执行真实账号发送或双端人工验收。插件已构建，移动端代码经过 widget 测试与静态检查。

[第三轮审核报告](/Users/zhou/Desktop/project/jotmo/worktree/v143/arkme-dsh-plugin/docs/changes/2026-09-04-quick-note-markdown/review-2026-09-07-round3.md) 保留修复前的历史证据，本文件记录本轮修复结果。
