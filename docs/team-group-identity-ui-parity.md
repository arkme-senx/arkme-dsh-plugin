# T23/T24：沿用既有 UI 的复核与收敛

## 依据与边界

- 插件原始基线：`1a9b86bc243097ff9d37d6a30634893b7fdbb20b`；本任务此前实现：`390500aa`、`57ee8c90`。
- 产品目的：个人已在普通群内时可明确选择代表自己的团队发言；真实作者仍是本人；团队徽标打开既有公开名片，联系时进入既有团队通道或成员收件箱。
- 不扩展团队正式入群、代理读群、群归集，也不向同事授予原群权限。
- 原始交接中的临时预览和 `backend_pending` 需要接成真实业务；它们不要求保留成第二套交互。

## 本次修正

| 原有界面/行为 | 此前偏差 | 收敛后的调用链 |
| --- | --- | --- |
| 头像 + “我” + 箭头；菜单“我 / 个人身份”“我 · 团队名团队 / 代表团队发言” | 触发器改成完整团队名，菜单改为真人姓名，错误只在菜单中提示 | `TeamGroupIdentityPicker` 保留原有文案、布局、核验状态和明确重试；悬浮标题及原输入提示显示完整身份。核验失败保留已选身份与草稿。 |
| 长文选择器“＋新建长文”，桌面独立窗口，浏览器弹窗 | 代表团队时强制走主窗口内编辑器 | `ArkmeSurface → ArkmeArticlePicker → openLongArticleWindow → ArkmeLongArticleWindow → ArkmeLongArticleDialog`；浏览器仍由原选择器创建原编辑器，并传递同一身份/草稿作用域。 |
| 转发详情原有作者、时间和内容行 | 新增“原始内容来源”区域 | 团队来源徽标放回原作者信息行；只展示这条被转发消息本身的 `sourceTeam`，不把内容的 `originTeam` 冒充这次发言身份。 |
| 原身份菜单的 14px 圆形徽标和公开团队链接样式 | 消息徽标另写了 18px 几何和文字样式 | `team-identity-presentation.ts` 复用原几何/配色；`TeamRepresentationBadge` 继续打开原 `TeamPublicCardDialog`。 |

## 保留的必要闭环

- 原临时预览接为受控身份选择；发送携带服务端验证的团队引用、成员版本和入群时间。个人、团队分别保留草稿，失败不降级为个人。
- 原任务未接通的消息徽标接真实关系归属，点击复用公开名片。团队描述和不可用状态来自真实公开查询。
- 原“联系团队”按钮对本团队成员进入既有收件箱，对外部用户进入既有 open 流程；不再显示后端未接通占位提示。
- 原转发弹窗内按目标群复用同一身份选择器。目标身份必须由用户明确选择，不能继承来源消息的团队。
- 未另建名片、创建团队、身份菜单、长文编辑器、转发弹窗或设计体系。

## 原生窗口的实际合同

只读核对 `arkme-dsh-client` 的 `188db7fd90f7bc6173bde2a29ef82160e031e02c` 中 `src/long-article-windows.ts`、`src/long-article-window-ipc.ts`、`src/preload.cts`：原生层只保留目标的白名单字段；同账号、同 `sourceKey`、同编辑模式复用既有窗口，并冻结首次上下文。

因此适配集中在现有 `long-article-window.ts` 边界：原生不解析的窗口键携带稳定草稿作用域，原生不解析的会话引用携带冻结身份。返回插件时，适配器先恢复原始会话键/引用，再交给界面、发送 API 与主窗口回执。身份不完整或作用域不一致时显式失败，绝不改按个人发送。此封装不产生业务权限；后端仍验证原有密封引用和当前成员/群关系。

稳定窗口键不包含每次核验会轮换的密封引用，因此同一团队刷新身份不会打开重复窗口；个人和不同团队的窗口及草稿分别隔离。未修改客户端源码、原生权限规则或 DSH 运行时，未增加配置和存储结构。

## 验证入口

- `team-group-controls.test.tsx`：原文案、短触发器、显式重试、失败保留选择。
- `conversation-send-directory.test.tsx`：原添加菜单/选择器入口到原生窗口与浏览器回退，传递冻结身份，不创建第二套编辑器。
- `long-article-window-bridge.test.ts`：原生 v1/v2/v3 白名单往返、轮换引用去重、不同团队隔离、损坏上下文拒绝。
- `long-article-window-ui.test.tsx`：原独立编辑器使用团队草稿和身份，发送后返回既有回执。
- `record-forward-read.test.tsx`：团队来源在原作者行中，个人转发不继承内容来源团队。
- `tests/e2e/team-group-identity-native-article.mjs`：以实际原生源码的未修改编译快照运行 Electron、preload、IPC 和生产编辑器；隔离 Provider 模拟成功/失败。覆盖三种窗口、草稿隔离、失败重试、固定提交 ID、原群引用、冻结身份、主窗口回执、账号切换。
- `tests/e2e/team-group-identity-stack.mjs`：新建官方 DSH Profile，安装不可变 tgz；真实 UI、外部 SDK Consumer、官方 Tools 对真实 Team/Chat/Record HTTP owner 和隔离 Mongo/Redis/RabbitMQ 验收。账号元数据为夹具，不使用生产账号。

本次证据目录：`analysis/team-parallel-handoff-20261028/03-群内团队身份与公开名片/开发证据/ui-parity-20261029`。真实原生验收在本机 macOS 执行；并不表示已在 Windows/Linux 物理机器运行。
