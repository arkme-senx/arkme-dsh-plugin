# 即我内部分享链接：类型盘点与行内预览方案

日期：2026-09-28。状态：按用户最新确认，取消消息下方的独立卡片，改为原位蓝色链接文字预览；本人原消息前缀为“我：”。下文以本次行内方案为准。验证记录见 `internal-share-link-preview-regression-2026-09-28.md`。

补充确认：发给自己、私聊、群聊统一使用查看者视角。发给同事后，同事看到原作者昵称，而非分享者视角的“我”。需求、当前缺口、最小字段及跨端验收见 [跨端接口交接](internal-share-preview-cross-client-api-handoff-2026-09-28.md)。

## 1. 需求与结论

消息里出现即我内部分享链接时，应在点击前回答“谁的、什么内容、什么类型”，而不只是显示“快记分享链接”。

保持原位蓝色链接，单行呈现：单条消息用“原发送人：正文摘要”，本人用“我：正文摘要”；多选记录用标题和条数；长文用标题。没有额外头像、信息区或卡片。无需用 AI 生成摘要或消耗用户 Token。

核对范围为当前本地插件、Flutter、Web 分享页及相关后端源码。下面的“已有”表示找到实现/调用合同，不代表已验证所有生产环境均已部署；未发送真实消息、未创建分享、未调用会产生查看记录的接口。

## 2. 当前预览为什么没有价值

- 插件 `src/client/ArkmeRichContent.tsx` 中 `ArkmeMessageCopyLink` 对 `/s/{sid}` 固定渲染“快记分享链接”，没有读取分享内容摘要。
- 通用 `ArkmeTextLink` 虽会读取网页元信息，但主要将标题呈现为行内链接，并非结构化内容卡片。
- Web 的 `apps/jotmo-web-pages/src/app/s/[sid]/page.tsx` 也固定输出通用标题和描述；仅抓网页标题不能解决单条/多条/长文等区分。
- Flutter `lib/shared/ui/text/link_card.dart` 对 `/s/{sid}` 同样提前返回通用元信息，直接照搬该分支也不够。
- 现有插件 `resolveMessageCopyLink` 属于详情路径，可能继续获取延展列表和媒体，不适合每张卡片自动完整执行。

## 3. 已确认的分享类型与建议显示

路径省略环境域名。即我生产、Arkme 海外、测试环境及旧 `/app` 路径需要按已核实路由分别处理，不跨环境借用登录信息。不同路径别名不能被当成不同产品类型。

| 内容类型 | 已确认的链接/来源 | 可用信息盘点（最终仅选作行内文字） | 现有能力与边界 |
| --- | --- | --- | --- |
| 单条快记/聊天消息 | `/s/{sid}`；来源包括个人记录、主题记录、聊天关系 | 原发送人头像/昵称，正文前两行，原消息时间；轻量“快记”标识 | 分享详情已有发送人、正文、时间、类型；不要把转发人当原作者 |
| 多选对话记录 | `/s/{sid}` 的多个 item 或 `forward_bundle`；另有 `/app/forward/{token}`、`/forward/{token}` | 原有记录标题，前 2–3 条“发送人：内容”，准确条数 | 有 `display_title`、presentation 或 forward payload 的 title/summary_lines；不能只按 URL 或 items.length 识别，单个转发包也属于对话记录 |
| 长文 | 上述分享链接中的长文条目，已有 display/template 类型区分 | 长文标题，作者，正文两行；有合法缩略图才展示 | 不需另造长文 URL 协议；不要抓长文全文和全部附件做列表预览 |
| 图片/视频/语音/文件快记 | 上述分享链接中的媒体条目 | 原作者；图片缩略图/视频封面、语音时长与已有转写、文件名与大小 | 公共分享合同有媒体描述及部分预览地址；没有合法预览地址时用类型图标，不下载原件、不自动播放 |
| 长录音或录音片段 | Flutter copy-link 支持 `audioSession`、`record` + `long_recording_segments`，仍生成 `/s/{sid}` | 录音标题或“录音片段”，录音时间/所选时长，已分享转写前两行 | 合同有 duration、speaker_label、text 和片段起止；插件当前类型投影不如移动/Web 完整，需要补映射。只展示选中的分享范围，不扩展读取整天录音 |
| AI / DSH 对话 | `/s/{sid}`；`agent_message`、`dsh_native`、`dsh_question` 等来源 | 单条显示真实来源名称+内容；多条显示任务/记录标题+问答摘录 | 原生 DSH 复制也接入消息分享流程；不能仅凭文字猜是 Arko、Bot 或哪个任务。返回“Agent”时不能自行替换成具体 Bot |
| 个人名片/我的世界 | `/{jotmoId}`、`/shijie/{jotmoId}`，Web 兼容 `/app/shijie/...` | 头像、昵称、即我号、轻量“TA 的世界”说明；简介仅在公开返回时显示 | 已有公开身份解析及世界页元信息，不读取私聊或个人非公开记录 |
| 世界中的公开快记 | `/{jotmoId}/record/{recordUid}`、`/shijie/{jotmoId}/record/{recordUid}` | 作者、公开正文/标题、合法封面，“公开快记”标识 | Web 使用公开记录 detail 与身份解析；内容不可用时不回退到作者私有记录接口 |
| 群聊/共享主题邀请 | `/(app/)?share/topic/{ob_remote_subject}?code=…&s=…`；另有 action 路由 | 群/主题名、邀请者、邀请标识；失效状态 | 已有 `preview-remote-subject`，含 title、creator_display_name 等；不是分享整个群聊历史。不要把 rest_member_count 未经解释就显示为当前成员总数 |
| 已结束的通话分享 | `/(app/)?share/call/{shareRef}` | 参与者、音频/视频类型、日期与时长；允许时显示已有总结片段 | 已有登录后详情接口，但会记录外部查看行为。自动预览需无副作用 preview 接口；未补前只显示“通话记录”，点击再取详情 |
| 发起通话邀请 | `/share-call?token=…` | 邀请者头像/昵称、“语音/视频通话邀请”、有效期/已过期 | 有独立 public resolve，返回 sharer_profile、call_media_type、expires_at；与已结束的通话严格区分。预览绝不能调用 start/create |
| 声纹录入邀请 | `/v?p=…#t=…` 或 `/app/voiceprint/invite?p=…#t=…`；存在无 p 的旧格式 | “某某邀请你录入声纹”、麦克风图标、失效状态 | 有专门的公开 preview；只有 p 才用于预览，绑定凭证 t 不交给通用网页抓取。无 p 时保留通用邀请卡 |
| 自动贴图邀请 | `/app/auto-sticker/invite?...` | 项目标题、邀请者头像/昵称、“自动贴图邀请”、有效期 | 有专用 invite/preview，包含 title、owner_identity、member_count 等；只预览、不自动加入 |
| 市集扩展分享 | `/(app/)?share/extension/{extshareRef}` | 扩展图标、名称、作者、一行说明、版本；不默认堆评分/截图 | 已有 public share/detail，含名称、作者、版本、预览引用；插件已做少量标题兜底，可扩展。预览不安装、不解析安装凭证 |

### 不是所有即我网址都应该自动读取内容

- `/app/audio/long-recording`、`/unmarked-speakers`、`/speaker-contacts`、账号/额度等属于登录用户自己的功能入口。只能标识“录音”“已识别说话人”等，不能加载当前用户私有内容后伪装成分享者的预览。
- `/app/artifacts/{artifactUid}`、活动页 `/events/...` 存在页面/详情读取实现；本轮未确认独立公开分享合同。先按功能入口处理，未来有明确授权的预览合同再升级。
- 位置共享已确认有会话内结构化消息、action 跳转和受控 detail，但未确认通用公开分享 URL；不自动读取实时坐标。普通消息里主动分享的地点描述可随消息快照展示。
- Bot 管理里复制的 Webhook 地址是调用凭证，不是 Bot 名片。不得自动请求、预览或向第三方抓取服务发送。当前未找到可确认的独立 Bot 名片公开 URL 合同；Bot 发言被复制为消息链接时按消息类型处理。
- `jotmo://action`、`arkme://action`、`/jotmo/jump?type=…` 是动作/兼容入口，不等于可公开读的内容。按 type 白名单识别，不能扫描后自动执行。
- 登录、支付、导入、授权、会员操作等只保留安全入口名称，不执行，也不展示其中的 token/code。

## 4. 交互图样式

保持现有消息气泡、外侧发送者和时间布局。以下例子是示意，不代表真实数据。

```text
本人单条： 🔗 我：这里是被分享消息的正文摘要……
他人单条： 🔗 小王：这里的入口需要更清楚……
多选记录： 🔗 产品讨论记录 · 12 条记录
长文链接： 🔗 产品设计复盘
混合内容： 看一下 🔗 我：正文摘要…… 后面的普通文字
```

视觉方向：沿用蓝色链接和小链接图标，文字单行省略；不增加卡片、头像、时间、边框或上下留白。窄窗随气泡收缩，不撑开会话。鼠标悬浮可看到完整的短摘要。

关键交互：

1. 只有一个链接的消息：直接替换原链接标签，不在下方再附卡片。原始 URL 保留在正文数据和链接目标中。
2. 链接旁还有文字：正常保留普通文字和原始位置，不把整句做成链接；历史 `[URL 后续文字](URL)` 的尾随文字放回链接外。
3. 多个链接：各自原位显示，不增加额外链接列表；同 URL 的读取去重，不递归预览摘要内部的链接。
4. 点击：消息/对话记录沿用现有详情；已支持的内部页面优先内部打开，其余打开对应分享页。所有邀请都先进入确认页，不直接加入/呼叫/安装。
5. 加载：先用简短类型标签，只给可见链接请求，限制并发、复用同一请求。成功仍为单行；发送不等待预览成功。
6. 失败：已确认的审核、失效、权限状态显示简短说明；网络错误保留类型标签，不编造内容或原因；原链接保持可点击。
7. 身份：外层是本次消息发送人，链接里是原作者，不能混淆。仅认证解析返回的原记录归属可判定“我”；不比较昵称，不把 AI 会话归属人误当 AI 发言者。身份无法确认时保留快照原名；原角色属于本人时按本次要求同样显示“我”。
8. 已有历史链接也可以通过显示层升级，无需重发或批量改写历史正文。预览不是新的消息，也不应影响未读数。
9. `/s/` 复用已有认证 resolve 的快照与锚点，但不走详情页的后续延展、媒体和原会话加载；凭证失效回退公开快照，不猜本人身份。其他公开预览不携带账号凭证。

## 5. 分阶段落地建议

### 第一阶段：现有接口先解决核心体验

- `/s/{sid}` 的单条、多条、转发包、长文、媒体、录音片段、AI/DSH 投影统一处理。优先读取分享范围快照，不为预览遍历延展/原会话。
- 兼容 forward 旧链接；世界名片/公开快记、主题邀请、扩展使用各自已有安全读取能力。
- 通话邀请、声纹、自动贴图可用专用 preview/resolve 逐步纳入；没有安全预览凭证就只呈现类别。
- 通话记录暂只做类型识别，等待不记查看的预览接口后补参与人、摘要。
- 先做确定性字段裁剪，无需 AI、无需额外 Token。

现有详情接口不是理想的列表接口。即使第一阶段复用，也需有请求体积限制、可见性加载、取消/去重/缓存和权限隔离。仅有完整详情接口时不能宣称已经是服务端摘要/批量接口。

### 第二阶段：后端统一轻量预览

建议新增统一批量入口（例如 `POST /api/v1/shares/preview/batch`，仅为拟议命名，不是现有接口）。后端或 BFF 内部路由到各分享服务。

每项最小输出：稳定身份/版本、内容 kind、title、author 的公开快照及可信原作者身份或 viewer_is_author、summary_lines、类型特有 meta、availability、expires_at、允许的打开目标。数量和摘录长度需要固定上限；当前行内 UI 不需要头像/缩略图。

必要合同：

- 预览是纯读：不计已读/查看、不写最近访问，不加入群聊、不开始通话、不安装扩展、不重新触发内容审核。
- 仅返回链接授权范围及当前查看者可见内容，不扩大到原会话历史/完整录音。
- 通话记录优先增加无查看副作用的 preview；当前 detail 有明确 RecordView 写入。
- 明确总条数口径、转发包标题、快照时间、媒体和录音子类型；缺字段可以为空，不要求客户端猜测。
- “我：”要求可信原作者身份：个人快记实测认证 resolve 仍可能只返回 `link_read_only` 和昵称/头像/正文/时间，不含原作者 ID。建议所有单条来源统一返回 `viewer_is_author`（相对当前登录者）或原作者 ID；必须是原作者而非分享者，AI 输出不可按会话归属人标成“我”。缺字段时前端保留快照昵称。
- 账号/环境隔离缓存。失效、撤销、权限变化后作废；不将临时签名媒体 URL 永久写回消息。
- 分享预览可由各端使用同一合同，不能把发送端的本地摘要当成跨端授权凭证。正文仍保留原始 URL，预览失败不损失可打开目标。

## 6. 源码索引

以下路径相对 `/Users/tison/arkme`，便于继续开发时复核：

- `arkme-dsh-plugin/src/client/ArkmeRichContent.tsx`：内部 `/s/` 识别与固定标签。
- `arkme-dsh-plugin/src/client/ArkmeLinkText.tsx`、`src/host-api.ts`：通用链接标题和扩展标题兜底。
- `arkme-dsh-plugin/src/services/chat-service.ts`：copy-link 创建/resolve，resolve 额外拉取延展。
- `arkme-dsh-plugin/src/types.ts`：ArkmeMessageCopyLinkResolveResult、SnapshotItem、PresentationNode。
- `jotmo-frontend/lib/features/sharing/application/message_copy_link_port.dart`：record/chat/audioSession/agentMessage 类型、录音片段、媒体结构。
- `jotmo-frontend/lib/features/chat/application/chat_forward_records_share_link.dart`：旧 forward 链接别名与参数。
- `jotmo-frontend-web/apps/jotmo-web-pages/src/app/s/[sid]/message-copy-link-page-client.tsx`：公共分享快照、DSH/Agent、媒体和录音显示合同。
- `jotmo-frontend-web/apps/jotmo-web-pages/src/utils/api/message-copy-link-public-detail.ts`：`/api/public/v1/chats/messages/copy-link/detail`。
- `jotmo-frontend-web/apps/jotmo-web-pages/src/app/app/forward/[token]/forward-share-open-client.tsx`：标题、summary_lines、嵌套转发结构。
- `jotmo-frontend/lib/shared/utils/world_share/world_share_utils.dart`、Web `src/app/shijie/[jotmoid]/`：个人世界与公开快记。
- `jotmo-frontend/lib/shared/utils/link/shared_topic_invite_preview_client.dart`：`/api/public/v1/subject/preview-remote-subject`。
- `jotmo-webrtc/gin/api/handlers/call_detail_share_handler.go`：通话详情分享及 RecordView 副作用。
- `jotmo-webrtc/gin/api/handlers/share_call_link_handler.go`：通话邀请、独立 resolve、有效期与 start 分离。
- `jotmo-frontend/lib/app/di/audio_voiceprint_invite_secondary_bindings.dart`：声纹 p 预览凭证与 t 绑定凭证分离。
- Web `src/service/jotmo-audio-services/modules/voiceprint/index.ts`：`/api/public/v1/audio/voiceprint/invites/preview`。
- Web `src/utils/jotmo/auto-sticker-invite-landing.ts`、`src/service/jotmo-photo-services/modules/main/index.ts`：自动贴图邀请预览。
- `arkme-dsh-plugin/src/extensions/publish-client.ts`、Web `src/service/extension-share.ts`：扩展公开 share/detail 与只读内容范围。
- `jotmo-frontend-web/apps/jotmo-web-pages/next.config.js`：`/app/share`、`/app/shijie`、`/forward`、`/v` 等兼容映射。

## 7. 本轮落地范围

- 共用富文本的 resolved 模式原位替换蓝色链接文字，覆盖发给自己、私聊/群聊和采用该模式的语音转写。详情原文继续 raw 模式；不向长文或摘要递归追加预览。
- 单条、多条、转发包、长文、媒体、录音片段、AI/DSH 根据分享快照字段分类；世界、公开快记、主题、通话邀请、声纹预览凭证和扩展接入已确认的公开读取路径。
- 已结束的通话只显示“通话记录”：不自动调用会记查看记录的详情。自动贴图邀请只显示类别：当前插件没有配置对应公开服务地址。声纹缺少 `p` 时也只显示类别。
- 不抓取内部功能、登录、Webhook 等地址；不借预览触发加入、绑定、呼叫、安装或审核。不消耗 AI Token。
- 可见链接才请求，同链接去重、最多 4 个并发，限制响应体积，按账号/环境隔离短期缓存，离开/切号取消请求。
- 原消息正文和 URL 均不改写。混合消息保留说明文字；旧编辑器误写进 URL 标签的尾随文字也保持可见。
- 仅更新 3100 独立 Web 预览；不更新已安装桌面客户端，不推代码，不发布版本。
