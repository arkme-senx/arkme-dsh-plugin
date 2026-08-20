# 扩展市场发现与资料编辑设计

**状态：** 已确认，待实施计划

**插件实施基线：** `arkme-senx/arkme-dsh-plugin@43f8f6c`

**发布服务测试基线：** `jotmo-extension-publish develop@b9776b0`（Jenkins `TEST_jotmo-extension-publish-backend #17`）

**交互参考：** `jotmo-frontend/lib/features/bot/presentation/bot_create_dialog_view.dart` 的 Bot 头像选择区域，仅参考交互层级与反馈，不复用 Flutter 代码。

## 1. 结论

扩展市场需要同时修正两个相互关联但 owner 不同的问题：

1. “发现”应展示公共扩展，以及当前账号自己已经发布的私有扩展。当前插件虽然同时请求了 `extensions.catalog.list` 与 `extensions.my-list`，却最终只渲染公共目录，因此作者看不到自己刚发布的私有扩展。
2. “我的扩展”中已发布条目的右侧动作从“上传头像”改为“编辑”。编辑页统一修改头像、名称、说明和可见范围；版本、代码、Package identity、运行时能力和权限仍只能通过发布新版本改变。

扩展资料的云端事实由 `jotmo-extension-publish` 持有。Arkme 插件只负责安全编排与 UI/SDK/Tool 适配，不在 Browser、本地 SQLite 或 Profile 中建立覆盖层。

## 2. 已确认现状

测试服上的“即我昵称显示（测试）”已经发布成功：

- `extension_id`: `ext_1ac31967d18c48c1ab206f6e4964db54`
- `latest_stable_version`: `1.0.0`
- `status`: `active`
- `visibility`: `private`

公共目录只返回 `visibility=public`、`status=active` 且存在 stable version 的扩展，所以该扩展不出现在 `extensions.catalog.list` 是服务端的正确行为。当前账号的 `extensions.my-list` 已返回该扩展；真正的缺陷在插件投影：`visibleItems` 只采用 `discoverItems`，没有合入 `publishedItems`。

当前加载链没有跳过网络请求：

- 扩展市场组件每次真实挂载都会加载发现页。
- 切换页签都会调用对应查询；`loadedTabs` 只控制是否显示阻断式骨架屏。
- 重复点击当前激活页签会直接返回，不能作为手动刷新入口。

因此这次需要修复数据合并，并把“进入、切换、重复点击当前页签、写操作完成”都定义为明确刷新时机；不能用增加随机延迟或清空本地缓存掩盖投影错误。

## 3. 目标与非目标

### 目标

- 当前账号在“发现”中能看到公共扩展和自己已发布的 private/public 扩展。
- 非作者仍不能通过公共目录看见 private 扩展。
- 每次打开市场都获取新数据；切换页签、重复点击当前页签、发布或编辑完成后刷新相关投影。
- 已发布扩展使用一个“编辑”入口修改头像、名称、说明和可见范围。
- 头像选择参考 Bot 创建页：当前头像/默认图标可见，整块可点击，hover/focus 有相机提示，文件 input 保持隐藏。
- UI、Host、SDK、Tool 共用同一个扩展资料更新 owner、权限、幂等与错误语义。

### 非目标

- 不允许原地修改已发布版本号、Bundle/source 字节、package name、execution model、manifest runtime、权限或 entrypoints。
- 不把资料编辑伪装成发布新版本，也不因修改资料生成空版本。
- 不增加 Browser 本地资料覆盖层，不修改 DSH core。
- 本次不把预览图管理并入资料表单；预览图继续使用现有独立画廊能力。
- 不删除历史评分、评论、版本、制品或源码快照；可见范围从 public 改为 private 时只改变可见性。
- 不让后续版本发布覆盖资料编辑结果；云端 listing metadata 与不可变版本 manifest 分别持有各自事实。
- 不在本轮提供 unlisted 的创建、编辑、SDK 或 Tool 写入口。历史 unlisted 记录保持服务端可读兼容，但新编辑 UI 要求用户选择 private 或 public 后才能保存。

## 4. 发现页投影与刷新

### 4.1 合并规则

Host 继续并行读取：

- `extensions.catalog.list`: 公共、可发现目录。
- `extensions.my-list`: 当前账号拥有的云端扩展，包括历史记录。
- `extensions.installed-list`: 当前 Profile 安装事实。

Client 使用纯函数按 `extension_id` 合并前两组数据：

1. 同一 `extension_id` 只出现一次；公共项保留目录评分等字段，owner-only 补充字段只补缺失值。
2. 合并后的全部条目按 `updated_at` 从新到旧排序；时间相同时按 `extension_id` 升序，保证结果确定。
4. owner-only private 项在标题旁显示轻量“仅自己” badge，避免作者把“自己可见”误认为“所有人可见”。历史 unlisted 项只在“我的扩展”保留兼容展示，不合入“发现”。
5. 安装状态仍由 `extensions.installed-list` 叠加，不能以是否来自 `my-list` 推断已安装。

点击 owner-only private 条目时，Client 使用 `my-list` 的安全投影，并通过现有 owner-authorized install preview 补齐 manifest/version；不能固定调用 public detail。

### 4.2 刷新时机

- 打开扩展市场：总是加载 `discover`。
- 切换页签：总是加载目标页签；已加载页签静默刷新，首次进入显示骨架屏。
- 点击当前激活页签：静默刷新当前页签。
- 发布成功：刷新“我的扩展”和“发现”。
- 编辑资料或头像成功/部分成功：刷新“我的扩展”和“发现”；当前详情使用服务端返回的新事实立即更新。
- 安装、卸载、启停完成：沿用现有安装投影刷新规则。

请求继续使用 sequence + AbortController，旧响应不能覆盖新响应。单个 owner-only 查询失败时，公共目录仍可展示，但 UI 应给出“你的私有扩展暂未加载”的非阻断提示，不能静默伪装成完整结果。

## 5. 编辑交互

### 5.1 卡片动作

- 已发布条目：右侧显示唯一行为按钮“编辑”。“已发布”仍是标题右侧 badge，不是按钮。
- 仅 Cordis/本地且未发布条目：保留“发布”。
- 同时具有本地与云端状态的条目：显示生命周期 badges，并只显示“编辑”；发布新版本继续使用既有发布流程，资料编辑不提供该动作。
- “上传头像”按钮删除。

### 5.2 编辑弹窗

标题为“编辑扩展”，字段为：

1. 头像：64px 圆形预览；无头像时显示现有扩展 fallback 图标。整个头像区域可点击，hover/focus 在右下角出现相机标记；旁边显示“扩展头像”和当前选择说明。文件 input 隐藏，接受 PNG/JPEG/WebP，最大 2 MiB。
2. 名称：必填，trim 后 1–120 个 Unicode code points，与发布服务现有校验一致。
3. 说明：允许为空，最多 2000 个 Unicode code points，与发布服务现有校验一致。
4. 可见范围只提供 `private`、`public`，中文分别显示“仅自己”“公开”。历史 unlisted 条目进入编辑页时先提示“该历史可见范围已隐藏，请选择仅自己或公开”，选择前禁用保存。

底部动作只有“取消”和“保存”。版本与更新说明不出现在编辑弹窗中。发布弹窗继续包含版本和更新说明，但头像选择区改用同一 Web 组件，消除原生文件 input 的直接呈现。

### 5.3 保存与部分失败

保存顺序固定为：

1. 若名称、说明或可见范围变化，先调用资料更新 owner。
2. 资料更新失败时停止，不上传头像，弹窗保留用户输入。
3. 资料更新成功后，如选择了新头像，再调用现有头像上传 owner。
4. 头像失败时不回滚已保存资料；提示“资料已保存，但头像更新失败”，刷新云端事实并保留头像重试入口。
5. 两部分都成功后关闭弹窗，显示“扩展信息已更新”，刷新发现页与我的扩展。

这不是跨对象原子事务。UI 必须准确报告部分成功，不能显示笼统失败，也不能自动重复资料写入。

## 6. 发布服务合同

新增 authenticated POST：

```text
POST /api/v1/extensions/metadata/update
```

请求：

```json
{
  "extension_id": "ext_xxx",
  "name": "天气助手",
  "description": "展示当前天气",
  "visibility": "private",
  "client_mutation_id": "uuid"
}
```

响应的 `extension` 字段返回更新后的完整 `ArkmeExtensionCatalogItem` 安全投影；核心字段为：

```json
{
  "extension": {
    "extension_id": "ext_xxx",
    "name": "天气助手",
    "description": "展示当前天气",
    "visibility": "private",
    "status": "active",
    "latest_stable_version": "1.0.0",
    "icon_ref": "icon_v1_...",
    "updated_at": 1780000000000
  }
}
```

服务端要求：

- 只允许当前登录用户修改自己拥有、`status=active` 且存在 stable version 的扩展；该条件与现有头像更新保持一致。
- name、description 复用发布创建时的标准化和校验规则；metadata update 的 visibility 只接受 `private` 或 `public`。
- `extension_id`、owner、slug、package name、版本、制品、source、签名、权限、状态不可由该请求修改。
- `client_mutation_id` 必须是 UUID；payload 比较使用 trim 后的标准化 name/description 与原始枚举 visibility。
- 幂等唯一键固定为 `(owner_user_id, extension_id, client_mutation_id)`，记录不设 TTL。
- 相同 key 与相同标准化 payload 返回成功和当前服务端扩展投影，不重复应用、不推进 `updated_at`；相同 key 与不同 payload 返回冲突。
- 每个新 mutation 持久化 `pending -> applied -> completed`。Mongo 无事务时先插入 pending，再以 extension 当前 `updated_at` 做条件更新；崩溃重试修复未完成阶段。已经被更新版本超越的迟到重放只完成幂等记录并返回当前投影，绝不能覆盖新资料。
- 使用新的 mutation ID 但标准化后资料完全未变化时返回成功，不推进 `updated_at`。
- 成功推进 `updated_at`，公共/我的列表随后读取同一事实。
- 后续 publish session 创建和完成不能改写现有 Extension 的 name、description、visibility 或 `updated_at`；这些字段只由首次创建与 metadata update 持有。
- public 改为 private 后立即退出公共目录；评分和评论保留，但 private 时继续遵守现有不可读/不可写规则。
- metadata endpoint 使用专用数字 wire code：`40021` invalid、`40321` owner/state forbidden、`40421` not found、`40921` idempotency/stale conflict、`50321` retryable storage failure。Host 再映射为稳定的字符串 `ArkmePluginError`。
- 旧后端路由 404 不包含 metadata 专用 envelope；只有这种响应映射为 `extension-metadata-update-unsupported`。带 `40421` 的响应必须映射为真实的 `extension-not-found`。

metadata 响应必须使用显式安全 DTO，不能直接序列化持久化 `Extension` 模型。`updated_at` 固定为 Unix milliseconds number；插件 `ArkmeExtensionCatalogItem` 同步把 `updated_at` 修正为 `number`，并增加可选 `status` 字段。

private 与历史 unlisted 的 owner 仍可在 `my-list` 读取历史 `rating_summary`，但评论正文继续只允许 public 扩展读取。现有 unlisted 读取/安装兼容语义不在本轮修改。

头像继续复用现有 upload-session/create、对象上传和 upload-session/complete 合同，不扩展 metadata 接口接收二进制或 signed URL。

## 7. Arkme 插件能力矩阵

四个消费面共用 `ArkmeExtensionManager.updateMetadata()`：

| 能力面 | 入口 | 安全与结果语义 |
| --- | --- | --- |
| Host owner | `updateMetadata(input)` | 当前账号认证、extension ID 校验、幂等透传、返回安全目录投影 |
| UI | `extensions.metadata.update` | 仅同源 DSH 页面可写；Browser 不接收 Token、对象 key 或 signed URL |
| SDK | `updateExtensionMetadata(extensionId, input)` | 公开类型、AbortSignal、稳定错误体；仓外插件不依赖私有 import |
| Tool | `arkme_extension_edit` | exact `extension_id`、name、description、`private/public` visibility；写 grant；执行前展示明确确认文案 |

现有头像能力继续由 `setIcon()` / SDK icon API / `arkme_extension_icon_set` 共用。编辑 UI 只是把资料和头像两个 owner 编排到同一个表单，不复制上传、权限或校验逻辑。

Provider capabilities 新增可选字段 `features.extensionMetadataEdit?: true`；实现新 Host owner 的插件固定返回 `true`，旧插件因字段缺失保持兼容。旧后端没有新 endpoint 时，Host 只把“不含专用数字 envelope 的路由 404”转换为稳定的 `extension-metadata-update-unsupported`，UI/SDK/Tool 都显示“当前扩展服务尚未支持资料编辑”。

## 8. 数据与安全边界

- 发布服务是云端资料唯一 owner；本地 owned lineage 只用于证明来源与合并生命周期。
- Browser 的写请求体只发送安全展示字段与 opaque `extension_id`，不发送 owner ID、package name、本地路径或上传凭据；只读目录投影继续允许现有可选 owner/package 展示字段。
- Host 不能接受 Browser 指定的上游 URL、headers、object key 或文件路径。
- Tool 必须使用 `my-list`/“我的扩展”返回的 exact extension ID；模型自由生成的 ID 不能绕过服务端 owner 校验。
- 名称和说明是用户内容，渲染时保持纯文本，不解释成 HTML、Markdown 指令或模型指令。
- 可见范围修改不改变安装授权；private 扩展仍仅 owner 可解析安装。

## 9. 兼容与发布顺序

1. 发布服务先上线 metadata update endpoint，保持现有 v1/v2 发布、安装和 unlisted 兼容合同不变。
2. Arkme 插件加入 Host/SDK/Tool/UI 与发现页合并逻辑，并对旧后端做 capability/unsupported 错误处理。
3. 测试服使用当前账号把 private 扩展改名、改说明、切 public/private、换头像，分别验证公共目录和 owner 目录。
4. 验证通过后再进入正式插件发布；不要求迁移历史扩展记录。

回滚插件不会丢失已保存的云端资料；旧插件仍能读取更新后的 name、description、visibility 与 icon。回滚后只失去编辑入口。

## 10. 测试与验收

### 发布服务

- owner 更新成功，非 owner、deleted/不存在扩展被拒绝。
- suspended、未发布 stable version 的扩展与头像更新保持同样拒绝语义。
- name/description/visibility 校验与创建发布一致，空说明允许保存。
- UUID、标准化 payload、永久唯一键、pending/apply/completed 修复、迟到重放、no-op、幂等冲突、Mongo/存储错误与 `updated_at` 推进有测试。
- metadata 专用数字错误码能区分路由 404 与真实 extension not found。
- public/private 切换后，catalog、my-list、detail、icon、preview、review 可见性保持一致；metadata update 拒绝新写入 unlisted。
- 后续发布新版本不覆盖已编辑 listing metadata。
- v1 artifact-only 与 v2 Bundle 发布/resolve-install 回归继续通过。

### Arkme 插件

- 发现页合并公共与 owner-only 项，去重并保持确定顺序。
- private 作者可见、其他账号不可见；公共自身扩展不重复；历史 unlisted 不合入发现。
- 打开、切页、重复点击当前页签、发布/编辑后都触发正确刷新；过期响应不覆盖新数据。
- 卡片只出现真实动作：“发布”或“编辑”；状态 badge 不是按钮。
- 编辑弹窗具有头像预览、隐藏文件 input、键盘 focus、文件类型/大小提示，以及名称、说明、可见范围字段。
- 资料失败不上传头像；资料成功头像失败显示部分成功；完全成功刷新两个投影。
- Host API origin 门禁、SDK Consumer 编译与调用、Tool grant/确认/结果 Schema 测试通过。
- 全量 `test`、`typecheck`、`build`、`.tgz` 清单和未修改 DSH 的全新 Profile 安装通过。

### 测试服实测

- “即我昵称显示（测试）”作为 private owner item 出现在发现页，并带“仅自己”提示。
- 修改名称、说明和可见范围后，关闭再打开市场仍显示服务端新值。
- 切换 public 后进入公共 catalog，切回 private 后退出公共 catalog，但 owner 发现页继续可见。
- 更换头像后，发现、我的扩展和详情使用同一 `icon_ref`；失败时没有伪成功或本地假头像。
