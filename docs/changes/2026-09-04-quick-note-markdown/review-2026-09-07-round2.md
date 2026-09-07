# Markdown 二次审核（2026-09-07）

结论：当前仍有 6 类确认问题：5 类上轮未关闭的问题，以及 1 类本轮补充发现的后端标签范围校验问题。不能将当前状态认定为全部修复完成。本轮只审核，未修改业务代码；新增了本报告，临时测试已移出仓库。

## 当前问题（按优先级）

### 1. [P1，仍存在] 桌面粘贴改变正文结构和代码含义

位置：[ArkmeMarkdownComposerInput.tsx:49](/Users/zhou/Desktop/project/jotmo/worktree/v143/arkme-dsh-plugin/src/client/ArkmeMarkdownComposerInput.tsx:49)。

重新运行真实输入组件和草稿 store 的复现：在“甲丙”中间粘贴“乙”，保存源码仍为 `甲\n\n乙\n\n丙`；代码块内粘贴 `# 标题\n**代码**`，编辑器文本仍变为 `标题代码`。

根因仍是所有粘贴均以完整 Markdown 文档执行 insertContent，没有按光标所在的段落、行内代码或代码块区分插入方式。此处尚未修改。

### 2. [P2，本轮补充发现] 后端标签同步拒绝合法的 UTF-16 范围

位置：[jotmo-record/gin/compound/record_tag.go:250](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo-record/gin/compound/record_tag.go:250)，拒绝分支在 [265 行](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo-record/gin/compound/record_tag.go:265)。

| 正文 | 客户端标签范围（UTF-16） | 正文创建校验 | 后续 tags/set 校验 |
| --- | --- | --- | --- |
| `#工作` | start=0, length=3 | 通过 | 通过 |
| `#版本🚀` | start=0, length=5 | 通过 | 拒绝：range exceeds current text_content |
| `😀 #工作` | start=3, length=3 | 通过 | 拒绝：range exceeds current text_content |

以上结果直接调用当前后端的实际函数验证，不是用测试桩模拟后端判断：先调用 `RecordContentPayload.ValidateForRecord`，再将同一文本通过 `Record.SetTextContent` 写入内存模型，最后调用 `validateRecordTagOccurrencesForRecord`。测试没有访问真实账号或修改远端数据。

根因：正文创建的 [validateHashTagsForText](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo-record/internal/content/models.go:1730) 使用客户端统一的 UTF-16 长度，而 tags/set 的 validator 使用 `utf8.RuneCountInString`。emoji 等非 BMP 字符在 UTF-16 中占 2 单元，在 rune 计数中只占 1，导致合法的尾部标签范围被误判越界。

影响：快记可以发送成功、正文里也有标签证据，但个人/主题快记后续同步标签索引可能失败。插件 [syncCreatedRecordTags](/Users/zhou/Desktop/project/jotmo/worktree/v143/arkme-dsh-plugin/src/services/record-service.ts:260) 原样发送 UTF-16 范围；[失败处理](/Users/zhou/Desktop/project/jotmo/worktree/v143/arkme-dsh-plugin/src/services/record-service.ts:279) 只记录警告，用户可能看到已发送却无法通过该标签索引检索。

这是本轮补充发现的既有问题，不是上轮数据修复引入。上一份审核中“后端暂未发现额外确定性缺陷”的结论应据此更新。修复需要统一服务端范围校验口径，并保留对真正越界范围的拒绝；不能把客户端改成 rune 偏移，因为正文、mention 和其他读取侧合同使用 UTF-16。

### 3. [P2，部分修复] 移动端仍不能把转义标点标签识别为完整标签

位置：[record_markdown_body.dart:151](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo_frontend/lib/features/record/presentation/record_content/record_markdown_body.dart:151)。

桌面逐字输入 `#a*b` 后，序列化产生 `#a\*b`，当前保存侧已正确提取业务名 `a*b`。但移动端渲染同一源码，仍无法生成完整的 `#a*b` 标签控件，补充 widget 断言继续失败。

根因：移动端业务 inline syntax 仍直接扫描源码，并把反斜杠、星号排除在标签内容外，未使用解码后的业务标签名。不能把“存储侧已修复”视为此问题已跨端关闭。

### 4. [P2，仍存在] 移动端块级 HTML 原文及正文不显示

位置：[record_markdown_body.dart:93](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo_frontend/lib/features/record/presentation/record_content/record_markdown_body.dart:93)。

同一复现 `<b>保留 HTML</b>\n\n<div>块级 HTML 正文</div>`，仍只显示前一段，div 块及其正文消失。根因仍是只提供了 inline 图片/业务语法，没有将块级 HTML 转为可见字面文本。此项要求保留原文，不是支持 HTML 排版。

### 5. [P2，仍存在] 移动端链接中的井号标签接管点击

位置：[record_markdown_body.dart:155](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo_frontend/lib/features/record/presentation/record_content/record_markdown_body.dart:155)，回调在 [176 行](/Users/zhou/Desktop/project/jotmo/worktree/v143/jotmo_frontend/lib/features/record/presentation/record_content/record_markdown_body.dart:176)。

`[#标签](https://example.com)` 仍生成业务 InkWell；其回调进入标签搜索。根因仍是业务语法没有排除链接上下文，自定义控件覆盖了预期的链接打开行为。控件生成由 widget 测试复现，回调目标由代码核对，本轮未真实弹出搜索页面。

### 6. [P2，仍存在] 桌面详情分享链接漏掉格式化标题

位置：[ArkmeMarkdownBody.tsx:76](/Users/zhou/Desktop/project/jotmo/worktree/v143/arkme-dsh-plugin/src/client/ArkmeMarkdownBody.tsx:76)。

真实详情组件渲染 `[**重点链接**](https://jiwo.cc/s/0123456789abcdef)`，仍显示 URL，输出不含“重点链接”。根因仍是只提取顶层 string children，丢弃 strong 等嵌套文本，分享链接渲染器随后回退为地址。影响范围是使用该自定义渲染器的分享链接；普通链接原生 a 分支不应一并判为失败。

## 已通过复核的修复

- URL / 自动链接 / 链接标签不再写入业务标签元数据：原审核复现与新增 5 类 URL 测试均通过。
- 桌面转义标签生成：输入 `#a*b` 的可见文本、保存源码以及业务名 `a*b` 已正确分离；新增实体、转义字符和 UTF-16 源码范围测试通过。上述结果只证明元数据生成，不能代替后端标签索引端到端验收。
- 移动端转发与再转发：缩进代码、代码中的字面反斜杠 n、行尾双空格、尾部换行和 `text_format` 均通过原文往返回归。

## 排查流程和测试证据

1. 对照上轮审核及修复进度，重新读取当前工作区数据处理、编辑器和阅读代码，确认哪些路径实际有改动。
2. 把上轮最小复现临时放回原测试目录，在当前代码上重跑；同时运行新加入的标签元数据和转发往返回归。
3. 从客户端 `hash_tags` / tags/set 的 UTF-16 范围继续追到后端两个不同 validator，增加真实后端函数的最小合同测试，确认 emoji 问题而非推测。
4. 保存原始输出并清理三份临时测试文件。未修业务代码、未提交、未发布、未做真实服务发送。

| 验证范围 | 通过 | 失败 |
| --- | ---: | ---: |
| 桌面：编辑器、正文、标签及原审核复现 | 50 | 3 |
| Flutter：正文、转发投影及原审核复现 | 60 | 3 |
| 后端 UTF-16 合同测试（按子场景） | 1 | 2 |

客户端 6 个失败对应 5 类旧问题，其中粘贴有两种复现。后端 2 个失败子场景对应同一新增发现。没有把暂未实现的无标记自动识别或原范围外的图片对齐等功能列为缺陷。

证据目录：[二次审核日志与测试源码](/private/tmp/arkme-markdown-review2-20260907)。

- [桌面日志](/private/tmp/arkme-markdown-review2-20260907/desktop.log)
- [移动端日志](/private/tmp/arkme-markdown-review2-20260907/mobile.log)
- [后端日志](/private/tmp/arkme-markdown-review2-20260907/backend.log)
- [桌面复现源码](/private/tmp/arkme-markdown-review2-20260907/markdown-review-audit-20260907.test.tsx)
- [移动端复现源码](/private/tmp/arkme-markdown-review2-20260907/markdown_review_audit_20260907_test.dart)
- [后端复现源码](/private/tmp/arkme-markdown-review2-20260907/markdown_review_utf16_audit_test.go)
