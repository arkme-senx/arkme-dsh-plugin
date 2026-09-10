# 执行记录

- [x] 用户确认无切换编辑体验与低保真方案；图片对齐不在范围内。
- [x] Record 可选格式字段、持久化、投影及旧客户端更新兼容。
- [x] Chat 转发与公开快照格式白名单，Markdown 原文保留。
- [x] Tiptap 编辑器、源文序列化、mention/emoji、草稿、发送与延展接入。
- [x] 桌面统一阅读与安全降级，移动端统一阅读和源码重编辑兼容。
- [x] 两端公共语料、编辑器 DOM 交互、服务请求与后端字段测试。
- [ ] 发布前真实 Harness 与手机端联调，确认生产版本支持后启用 writer。

本地验证命令与结果见交付说明。移动端 SDK 兼容调整见 design.md；无需数据库迁移。

## 已完成的验证

- 插件 `pnpm run typecheck`、`pnpm run bundle` 通过；可执行入口校验通过。
- Vitest 13 个相关文件、164 项通过：Markdown 语料/渲染/编辑器 DOM，草稿、附件发送、聊天与 Record 服务、快照详情及原有输入框回归。
- Flutter 354 项相关测试通过：公共语料、240px 渲染/收起/横向滚动、聊天消息与转发投影、摘要、Record 创建与源码更新。所有生产修改文件 `flutter analyze --no-pub` 通过。
- Record 的 text_format JSON/BSON/clone/输入/兼容更新测试通过；Chat 转发和公开分享快照的格式及空白字符保留测试通过。
- 尚未执行真实设备、真实账号的端到端联调；未运行需要远端环境的全仓集成测试，也未执行部署。

## 移动端源码编辑补充验证

- 重编辑控制器实测保留转义的真人/Bot mention、原始 Markdown 和 UTF-16 范围；编辑与延展相关 44 项测试通过。
- 未分类页面的重编辑相关用例通过。另 4 项菜单/分页/摘要旧测试失败，在独立临时目录提取 HEAD 并复跑后同样失败，确认属于基线已有问题；未扩大范围修改这些功能。
- 基线复核使用原始 lib/test、相同依赖解析与资产，没有覆盖当前工作区文件。日志保存在 `/tmp/arkme-markdown-baseline-tests.log`；实现测试日志为 `/tmp/arkme-markdown-mobile-edit-focused.log`。
