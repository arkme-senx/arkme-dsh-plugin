# Markdown 第三轮审核（2026-09-07）

本轮确认 4 类新增边界缺陷。上轮已修复场景的 166 项客户端回归全部通过，但补充复现仍有失败，因此当前不能认定为完整验收通过。本轮仅审核，未修改业务代码、未提交或发布。

## 1. [P1] 桌面代码块序列化未避开正文内的围栏

位置：[markdown-editor.ts:271](/Users/zhou/Desktop/project/jotmo/worktree/v143/arkme-dsh-plugin/src/client/markdown-editor.ts:271)，默认扩展注册在同文件 148 行。

复现：通过实际 `arkmePasteMarkdown` 粘贴以下完整 Markdown，编辑器正确生成一个代码块；再调用发送所用的 `arkmeSerializeMarkdownEditor`，重新解析保存结果。

~~~~~markdown
````markdown
```js
const n = 1
```
**原样** #代码
````
~~~~~

保存时外层四反引号被改成三反引号，正文中的三反引号提前关闭外层块。重新解析后，原来代码内的 `**原样** #代码` 变成普通段落，粗体被激活；业务标签提取也开始产生“代码”标签。代码块内容和发送后的阅读语义发生变化。

根因：当前直接使用 Tiptap CodeBlock 默认 Markdown writer，本地依赖 `@tiptap/extension-code-block/src/code-block.ts:181` 固定输出三反引号。业务序列化层没有根据代码内容选择更长的围栏。需要在代码块 writer 处理冲突，不能仅调整粘贴或阅读样式。

证据：[桌面最终补充测试](/private/tmp/arkme-markdown-review3-20260907/desktop-audit-final.log)，用例 `retains an embedded fence inside code across serialization`。

## 2. [P2] 移动端字面块直接显示 mention 内部占位符

位置：[record_markdown_body.dart:58](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo_frontend/lib/features/record/presentation/record_content/record_markdown_body.dart:58)。代码范围预扫描见 [record_markdown.dart:41](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo_frontend/lib/shared/record/record_markdown.dart:41)。

复现不仅使用手工 payload，还走了已有编辑链路：从带有效 mention 的 `@小明` 创建 Record，转换为编辑对象，使用 `RichTextEditingController` 在前后分别插入 `<div>` 和 `</div>`，再用 `buildChatMentionMetadata` 生成保存元数据。得到正文 `<div>@小明</div>`，mention 范围 start=5、length=3，用户身份仍为 7。阅读组件实际显示 `<div>\uE100arkme-mention-0\uE101</div>`（这里用转义写出不可见字符），原姓名消失。

另一复现：带有效 mention 的 `> ~~~\n> @小明\n> ~~~` 也泄出占位符。

根因：解析 Markdown 之前先把 mention 替换为 token，但只在业务 inline syntax 中还原。HTML 字面块直接生成 Text，代码块也不会进入 inline 解析。预扫描既不排除 HTML，也不能识别引用前缀后的波浪线围栏，导致 token 进入无法还原的节点。需要让替换范围遵循实际解析上下文，并保证字面节点不会泄出 token。

证据：[移动端最终补充测试](/private/tmp/arkme-markdown-review3-20260907/mobile-audit-final.log)。普通 mention 对照用例通过；HTML、引用代码块及真实编辑链路三项复现失败。

## 3. [P2] 移动端将行内 HTML 属性和注释识别为业务标签

位置：[record_markdown.dart:170](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo_frontend/lib/shared/record/record_markdown.dart:170)。

同一份标记为 Markdown 的源码：

| 源码 | 桌面标签元数据与阅读 | 移动端标签控件 |
| --- | --- | --- |
| `前 <span title="#属性">正文</span> #标签` | 标签 | 属性、标签 |
| `前 <!-- #注释 --> 后 #标签` | 标签 | 注释、标签 |

根因：本次修复保护了块级 HTML，但库默认的行内 HTML 语法产生普通 Text，随后 `recordMarkdownDecorateTags` 无条件扫描该 Text。属性和注释中的井号被转为业务 InkWell，点击会进入标签搜索；桌面 AST 则排除 HTML 节点。需要在行内解析阶段保留 HTML 的字面上下文。

这是字面内容被错误激活，不是请求支持 HTML 排版，也不是脚本执行问题。

证据：两份最终补充测试日志；移动端用例 `inline HTML`、`inline comment` 失败，桌面对照通过。

## 4. [P2] 桌面阅读将文本片段重新当整篇 Markdown 解析，漏掉合法标签

位置：[markdown.ts:147](/Users/zhou/Desktop/project/jotmo/worktree/v143/arkme-dsh-plugin/src/markdown.ts:147)。

复现：`**甲**    #工作`（粗体结束后有四个空格）。完整源码的业务元数据正确包含“工作”，移动端实际生成 `#工作` 标签控件；桌面阅读没有生成标签链接。

根因：`arkmeMarkdownBusinessNodes` 已经处于 Markdown 文本节点，却把该节点的源码片段 `    #工作` 再传入整篇解析函数 `arkmeMarkdownHashTagRanges`。原本是行中空格，脱离父级上下文后被当作四空格缩进代码，标签被错误过滤。需要基于完整文档的范围或现有文本节点识别标签，避免片段改变块级语义。

证据：桌面 `tag evidence and render: indented inline text` 失败；相同源码的移动端对照通过。

## 排查流程与结果

1. 对照两轮报告和修复记录，检查当前工作区的编辑器、序列化、标签 AST、移动端阅读和后端 UTF-16 校验。
2. 重跑原有编辑、正文、标签、草稿、移动端投影与转发回归；核对后端内容及 tags/set 使用同一长度口径。
3. 对混合语法提出最小假设，用真实 Tiptap 编辑器、实际 React 阅读组件、Flutter widget 和真实源码编辑控制器复现；将输入源码、保存源码、节点结构、标签及可见文本相互对照。
4. 读取本地依赖 writer/语法实现定位根因，保存日志与复现源码。所有临时测试移出仓库，业务代码保持本轮开始时状态。

| 验证集合 | 通过 | 失败 |
| --- | ---: | ---: |
| 原有桌面 6 个相关文件 | 97 | 0 |
| 原有 Flutter 正文与转发投影 | 69 | 0 |
| 桌面最终补充边界测试 | 6 | 2 |
| Flutter 最终补充边界测试 | 4 | 5 |

补充测试 7 个失败对应上述 4 类问题；同一 mention 问题有三个触发路径。原有 166 项不是新补充用例，因此不能替代这些边界验收。

后端两条命令均 exit 0：

- `go test ./gin/compound -run TestRecordTag -count=1`
- `go test ./internal/content -run TestRecordContentPayload -count=1`

日志及可复制回原测试目录的复现源码：[第三轮审核证据](/private/tmp/arkme-markdown-review3-20260907)。`desktop.log`、`mobile.log` 包含原有回归；`desktop-audit-final.log`、`mobile-audit-final.log` 包含最终补充复现。

没有访问真实账号发送内容、操作 Jenkins 或做真机验收。本轮未重建客户端；报告中的通过范围只限上述本地测试。无标记自动识别、图片对齐等未纳入已批准范围的功能不作为缺陷。
