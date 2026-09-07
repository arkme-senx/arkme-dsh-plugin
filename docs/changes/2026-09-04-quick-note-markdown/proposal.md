# 快记 Markdown 编辑与跨端渲染

用户已确认无开关的桌面实时 Markdown 编辑方案及低保真原型。实施范围是 Arkme Harness 插件的现有个人、主题、私聊、群聊快记发送框及延展输入，两端复用同一份 Markdown 正文。移动端新增统一阅读能力，重编辑保留源码输入。

本次不包含图片对齐、内联图片上传、公式、Mermaid、任意 HTML 排版或移动端所见即所得编辑器。图片和其他文件继续走原附件通道。

跨仓 owner：`jotmo-record` 保存正文与格式标记；`jotmo-chat` 透传并保留转发/公开快照格式；`arkme-dsh-plugin` 编辑与桌面渲染；`jotmo_frontend` 移动端渲染、历史版本及重编辑兼容。本工作区没有对应的 jotmo-meta 检出，因此将本目录作为可随代码评审的最小合同 sidecar，不修改其他分支的治理仓。
