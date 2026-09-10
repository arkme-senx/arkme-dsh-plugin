# 实现设计

桌面采用 Tiptap 3 / ProseMirror 和 Tiptap Markdown。文档 JSON 仅供编辑器、撤销和本地草稿使用；发送时一次序列化为 Markdown 源码。外部 mention、表情、标签选择以事务插入原文档；输入过程中不重建编辑器。

正文唯一事实是 `text_content` 与 `content_payload.text_format`。不存 Quill Delta，不把 HTML 当跨端正文。字段值为 `plain`、`markdown`，缺省代表历史纯文本。Record 存储使用可选 BSON `tf`，无历史迁移或新索引。

桌面使用 react-markdown / remark-gfm / remark-breaks 阅读。移动端统一为 RecordMarkdownBody，使用现有 flutter_markdown 0.7.7+1 / markdown 7.3.0。原拟 flutter_markdown_plus 要求 Flutter >= 3.27.1，而本仓固定 Flutter 3.24.5；本次保持 SDK 基线，通过统一组件封装现有库。两端运行同一份 fixture JSON。

mention 是编辑器内的原子节点。先序列化，再计算正文 UTF-16 范围及校验摘要，避免标题符、表格、转义或 emoji 改变偏移。业务表情继续使用已有 token。标签从 Markdown 的文本节点提取，代码块、行内代码、URL 和转义的井号不生成标签。

默认 Enter 发送，Shift+Enter 按段落/列表/代码块语义换行，中文 IME 与候选菜单优先。输入标题、强调、列表、引用、代码、任务语法即刻转换；表格输入表头和分隔行后 Shift+Enter 完成转换，也支持粘贴完整 GFM 表格。表格内 Tab 在单元格间移动并在末尾加行，Shift+Enter 在表格下方继续下一段，避免产生 GFM 不支持的多段单元格。

阅读组件按实际排版高度收起，表格与代码在自身区域横向滚动。整条复制保留 Markdown 源文，选区复制遵循所见文本。HTML、内联图片按源字符显示，不运行脚本或加载图片；图片附件仍使用现有媒体组件。
