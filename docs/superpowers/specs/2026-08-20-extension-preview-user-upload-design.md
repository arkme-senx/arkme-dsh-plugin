# 扩展预览图用户自选上传设计

**状态：** 已确认方向，待书面复核

**插件实施基线：** `arkme-dsh-plugin@0a2e197`

**后端合同：** 复用现有扩展预览图上传、删除、排序、解析接口，不新增发布服务 API

## 1. 结论

扩展预览图同时提供两个用户入口，并共用 `ArkmeExtensionManager` 这个 Host owner：

1. 用户在 DSH 对话中附加本地图片后，Agent 可以把最新一条直接用户消息中的图片附件加入预览图集；`image_ref` 不再必填，但继续作为兼容入口。
2. 用户在“我的扩展 → 编辑扩展”中可以直接多选本地图片、预览、删除和排序，保存后上传。

两个入口都禁止任意本地文件路径、Base64、HTTP URL、OSS object key 和签名 URL。浏览器只发送用户通过文件选择器取得的 `File`；Agent 只读取当前会话中已经由 DSH 附件服务验证、持久化并授权给该会话的图片。

## 2. 目标与非目标

### 目标

- 消除 `arkme_extension_preview_add` 必须先取得 Arkme `image_ref` 的使用阻塞。
- 支持用户一次选择或附加多张图片，最多补足到 20 张。
- 保持预览图第 0 项为封面，支持删除和完整排序。
- 保持现有 5 MiB、PNG/JPEG/WebP、owner、revision、幂等和同源下载安全边界。
- UI、Tool、SDK 共享现有 Host manager，不复制上传业务逻辑。

### 非目标

- 不允许 Agent 读取任意 workspace、Downloads 或绝对路径。
- 不接受模型生成的 Base64、data URL 或任意网络 URL。
- 不让浏览器或模型拿到预签名上传/下载 transport。
- 不建设后端批量原子上传 API；多图写入使用现有单图接口并明确部分成功语义。
- 不修改 DSH 源码。

## 3. 当前能力与缺口

已有能力：

- 后端维护 `preview_images`、`preview_revision`，最多 20 张，索引 0 为封面。
- Host manager 已提供 `addPreview()`、`deletePreview()`、`reorderPreviews()` 和 `readPreview()`。
- 同源 Host route 已支持本地 `Blob` 上传和安全图片读取。
- Browser SDK 已提供 add/delete/reorder 和 `extensionPreviewUrl()`。
- Agent 已有 add/delete/reorder Tool，但 add 只接受 Arkme `image_ref`。
- 扩展详情已渲染 `preview_images` 画廊。

实际缺口：用户在电脑上选择的图片不能直接进入 Agent Tool；“编辑扩展”也没有预览图管理入口。

## 4. Agent Tool 合同

### 4.1 参数

保留 Tool 名称 `arkme_extension_preview_add`，参数调整为：

```json
{
  "extension_id": "ext_...",
  "image_ref": "可选的 Arkme 图片引用",
  "attachment_indices": [1, 3]
}
```

- `extension_id` 必填。
- `image_ref` 改为可选，保留旧入口兼容。
- `attachment_indices` 可选，是最新一条直接用户消息中图片附件的 1-based 序号。
- `image_ref` 与 `attachment_indices` 不能同时出现。
- 两者都省略时，使用最新一条直接用户消息中的全部图片附件。
- 指定序号重复、越界、非整数或最新用户消息没有图片时，在任何远端写入前失败。

模型不需要知道 `attachmentId`，Tool 也不把 attachment id 写进结果。用户可在同一条消息中通过 DSH 图片选择器附加 1-N 张图片并要求上传。

### 4.2 附件授权

Tool 从当前真实 Agent 的 session events 向前查找最近一条 `source.kind=user` 的 `user/message`，只读取该事件 content 中的图片附件：

- 不扫描更旧用户消息，避免“再试一次”意外上传历史图片。
- 不采用 assistant、plugin 或 tool result 中的图片。
- 使用事件内完整 `ImageAttachmentRef` 调用正式 `attachments.readImage()`。
- DSH attachment store 负责 content-addressed identity、字节校验和会话授权；插件不接受或推导路径。

如果当前部署没有 attachment service，附件入口明确失败；兼容的 `image_ref` 入口仍可使用。

### 4.3 多图预检与写入

在上传第一张之前完成全部本地预检：

- 当前账号拥有目标扩展。
- 现有 gallery 数量加本批选择数量不超过 20。
- 每张附件均可从 attachment store 读取。
- 媒体类型为 PNG/JPEG/WebP，单张不超过 5 MiB。
- `attachment_indices` 解析后唯一且保持用户消息顺序。

通过预检后按顺序调用现有 `manager.addPreview()`。每张图的 idempotency key 稳定绑定 `extension_id + attachmentId`；同一附件重试不会重复添加，同一图片也不支持有意义的重复项。

### 4.4 部分失败

后端没有批量事务，因此远端故障可能发生在已添加若干张之后：

- 0 张成功时，Tool 抛出原错误。
- 至少 1 张成功后失败时，Tool 返回 `outcome=partial`、已添加数量、当前安全 gallery/revision、失败序号和安全错误文案。
- Tool 不自动删除已成功图片，也不盲目重试剩余图片。
- 用户刷新 `arkme_extension_list_mine` 后可以再次决定。

完整成功返回 `outcome=complete`、`added_count`、有序 `preview_images` 和 `preview_revision`。结果不包含 attachment id、`image_ref`、文件名、原始字节或存储 transport。

### 4.5 确认

`tools/pre-execute` 在执行前解析本批附件数量：

- 对话附件：`确认把当前消息选择的 N 张图片添加到扩展 X 的预览图集吗？`
- 兼容 `image_ref`：保留当前单图确认文案。

所有预览图写 Tool 仍属于 `explicit-user-write`，只在 `business` 和 `hybrid` profile 可见。

## 5. 编辑页面合同

### 5.1 入口与布局

在 `ArkmeExtensionEditDialog` 的头像区之后、名称字段之前增加“扩展预览图”字段：

- 已发布扩展显示当前远端画廊。
- 未发布扩展显示“发布后可上传预览图”，不提供文件选择。
- “选择图片”使用隐藏 `<input type=file multiple>`，accept 精确为 PNG/JPEG/WebP。
- 支持一次选择多张；超出剩余槽位时整批拒绝并提示，不静默截断。
- 本地文件立即通过 object URL 预览，dialog 关闭或文件移除时全部 revoke。

每个条目使用稳定的本地 UI id，区分：

- 远端条目：`preview_ref`。
- 待上传条目：随机 local id + `File` + object URL + 稳定 mutation UUID。

### 5.2 删除与排序

- 删除远端图片只在本地 staged state 标记，点击“保存”后才调用后端。
- 删除待上传图片只移除本地 state，不发请求。
- 支持拖动排序，并为键盘用户提供“向前移动/向后移动”按钮。
- 画廊第一项明确标记“封面”。
- staged 总数必须为 0-20；允许删空全部预览图。

点击“取消”不会产生任何预览图远端写入。

### 5.3 保存顺序

编辑保存继续由一个 UI workflow 协调，owner 调用顺序固定：

1. 保存 metadata（若变化）。
2. 保存头像（若变化）。
3. 按当前 revision 删除 staged-removed 远端 refs，每次使用上一步返回的新 revision。
4. 按 staged 顺序上传所有本地文件，每次复用该文件稳定 mutation UUID，并记录返回 ref/revision。
5. 把远端 refs 和新 refs 映射回 staged 完整顺序；如果与服务端当前顺序不同，使用最新 revision 调用 reorder。
6. 刷新“我的扩展”和详情投影。

metadata、头像和预览图最终都共用现有 `ArkmeExtensionManager`/SDK adapter，不由 React 组件直接调用发布后端。

### 5.4 失败恢复

- metadata 已保存但头像失败：保留现有部分成功语义。
- metadata/头像已保存但 preview 写入失败：显示“资料已保存，但预览图更新未完成”，保持 dialog 打开并刷新服务端 gallery。
- revision 冲突：停止剩余 delete/reorder，刷新 gallery，要求用户重新确认排序；不自动覆盖他处更新。
- 多图上传部分成功：已成功项从本地 staged file 转为远端 ref；失败项继续保留为待上传，可在同一 dialog 重试。
- 网络结果未知时，先刷新 gallery 并按稳定 idempotency key 对账，不直接重传。

## 6. 数据流与 Owner

```text
用户文件选择器 -> Browser File -> Arkme SDK same-origin upload route
                                      |
用户消息附件 -> DSH AttachmentStore -> Tool adapter
                                      |
                                      v
                         ArkmeExtensionManager
                                      |
                          发布服务 Preview API / OSS
                                      |
                        preview_images + revision
                                      |
                     详情画廊 same-origin read route
```

- 发布服务：扩展 owner、gallery、revision、对象存储 owner。
- Arkme Host manager：认证、字节校验、签名 transport、cache 和错误语义 owner。
- DSH attachments：对话附件字节与 session authorization owner。
- UI/Tool：只做安全适配和用户交互，不复制业务规则。

## 7. 能力矩阵

| 能力面 | 设计 | 验收 |
| --- | --- | --- |
| Tools | add 支持最新用户消息附件批量上传，image_ref 可选兼容；delete/reorder 不变 | 真实 DSH 会话附加多图、确认、上传、部分失败与重试测试 |
| SDK | 继续使用 add/delete/reorder 与 same-origin URL，不改变公共参数 | Consumer 编译与现有 SDK 测试继续通过 |
| UI | 编辑页多选、staged delete/reorder、保存恢复；详情页读取画廊 | 组件交互测试和真实测试服 gallery 验收 |
| Host owner | 复用 manager 与 preview routes；新增附件解析 helper 只服务 Tool adapter | manager/route 测试不回归，不出现第二套上传逻辑 |

## 8. 测试

### Tool

- `image_ref` 兼容单图成功。
- 省略来源时使用最新直接用户消息的全部图片。
- `attachment_indices` 选择、顺序、重复和越界。
- 不采用上一条用户消息、assistant、plugin 或 tool 图片。
- 无 attachments service、GIF、超限、超过 gallery 容量均在零写入时失败。
- pre-execute 确认包含目标 extension 与图片数量。
- 稳定 idempotency key、完整成功和部分成功结果。
- business/hybrid 可见，atomic/disabled 不可见。

### UI

- 未发布扩展禁用选择；已发布扩展显示当前 gallery/revision。
- 多选、超量、非法类型、5 MiB 边界、object URL 回收。
- staged 删除、拖动、键盘移动、封面标记。
- 取消零写入。
- save 顺序、revision 串联、新 ref 映射、无变化时零 preview 请求。
- metadata/icon/preview 分阶段失败和 revision conflict 恢复。
- 详情画廊刷新后按后端顺序展示。

### E2E

1. 测试服账号创建或复用专用扩展。
2. 在 DSH 用户消息中附加 2 张本地图片，Agent 调用 add，确认后 gallery 增加 2 张。
3. 编辑页面再多选 2 张、删除 1 张、调整封面后保存。
4. 关闭并重新打开扩展市场，详情按新顺序显示，图片同源 URL 可读。
5. 使用错误 expected revision 验证冲突不会覆盖。
6. 清理专用测试 gallery；不在正式服执行写验收，除非用户另行明确授权。

## 9. 安全与回滚

- 任何时候都不接受或打印本地路径、Base64、附件 bytes、object key 或签名 URL。
- Tool 只读取最近直接用户消息的授权附件，不能枚举 attachment store。
- UI file input 是浏览器唯一的本地文件入口；组件不访问 File System API。
- 回滚 UI 后已有 gallery 数据仍由详情和 SDK 正常读取。
- 回滚 Tool 后 `image_ref` 兼容路径继续工作；附件批量入口消失但不影响数据。
- 后端无需回滚或迁移。
