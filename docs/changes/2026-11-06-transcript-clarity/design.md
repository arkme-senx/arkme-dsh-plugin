# 私人转写的可理解交互

基线：dev 39959712772357bbf0c49d56544669ad283e3300（3.0.55）。

## 代码与业务裁决

- `TranscriptViewService.saved` 按录音 session / call source 读取当前账号保存的视图，不返回某句的历次编辑。`revision` 还包含标记/恢复，不能解释为文字修改次数。
- 每句均显示“历史更正”错误表达了入口范围；原文、修改状态、恢复动作挤在正文里，源级列表以内联技术说明和版本计数呈现，干扰阅读。
- 录音日页包含多个来源，不能使用第一个行引用冒充整日修改列表。单录音入口沿用文件菜单中的 sessionRef；单通话使用明确 callRef，零当前片段时也应可查看已保存内容。

## 落地

1. 未更正正文无新增尾部操作；当前实际展示个人更正的行仅显示“已更正”，打开该行的原文/更正对照，按需恢复原文。继续复用既有选区工具条。
2. 单通话标题及单录音文件菜单各一个“我的修改”。列表是源范围的个人更正和标记，不叫逐句历史；当前句对照不调用 saved。
3. 复用 `ArkmeConfirmDialog` 的 picker 模式、`ArkmeRightPanelHeader` 和中性色。列表正文可复制、原文可展开、标记显示实际选中文字；不显示 revision、0标记计数、重分段/快照术语。
4. 仅过滤 text===original 且 marks 为空的恢复结果；标记项、失效标记和不再出现在当前列表的私人内容仍可查看。过滤不丢分页 cursor，不自动遍历所有页。
5. 沿用原账号/来源访问 epoch、撤权清理、冻结命令与保存重试 owner；只增加必要的弹层可见性/加载交互，不改服务端数据及协议。

## 能力矩阵

| 消费面 | 本次范围与证据 |
|---|---|
| UI | 纯客户端呈现和既有动作接线；行为反例、录音/通话实际页面及安装包验收 |
| Tools | N/A：未新增 Host/服务端能力，原私人视图工具及 grant 保持既有 owner |
| SDK | N/A：未新增公开能力或变更合同，原 SDK 合同回归 |
| Host owner | 沿用 TranscriptViewService；源级保存列表与当前行比较明确分离 |

## 验证

先用行为测试复现重复入口、错误范围、已恢复空项及弹层呈现；再验证当前句恢复、分页/重试、撤权、账号/来源切换、关闭/焦点、窄屏和长文本。扩大原录音/通话、选择工具条和共享对话框回归，运行 typecheck / 完整 test / build，并用不可变包在未修改官方 DSH 的全新 Profile 中渲染真实页面。最终只记录实际完成的结果。

原文变化边界已核对 Audio snapshot 实现：`original_changed` 对任何有修订的旧视图都可能成立，包含已经恢复且没有标记的视图。它不能作为“用户仍有更正”的判断。当前正文回到更新后的原文时不显示个人更正标记；真正保留的旧更正/标记仍从来源列表查看，已恢复空视图继续过滤。单句比较只接收 original/text，不混入 previousText 或修订元数据。两个反例（旧更正/已恢复）先红后绿。


## 场景与代码对应

| 用户场景 / 边界 | 代码 owner | 验证 |
|---|---|---|
| 正常阅读、只标记、已恢复且没有标记 | `useTranscriptInteractions.renderText` / `TranscriptPersonalChanges` | 仅实际文字差异显示“已更正”；源列表过滤已恢复空项，保留标记 |
| 点击某句“已更正” | `TranscriptCorrectionDetails` | 比较 original/text，不读取源列表、不替换为 previousText |
| 比较中恢复：连续点击、暂时失败、重试 | `TranscriptCorrectionDetails.restore` → 原 `change` owner | 单次在途，失败保留对照，成功后退出；原 CAS/receipt 不变 |
| 比较打开后原文更新、另一设备恢复 | hook 的 `correctionVisible` / panel 生命周期 | 版本不符或已无更正时退出，后续新更正不会自行重开 |
| 原文版本更新，旧视图曾更正或已恢复 | 原 snapshot → `renderText` 版本/文字差异判断 | 两个先红后绿反例，均不把 original_changed 当个人修改 |
| 一次通话、零当前片段但仍有旧视图 | `ArkmeCallDetailContent` 两种标题 → 显式 callRef | 恢复入口不依赖当前行存在 |
| 同一天多份录音 | `ArkmeRecordingFiles` 文件菜单 → 显式 sessionRef | 实际菜单依次打开两份文件，Host 查询参数分别为 ref1/ref2；不从首行冒充整日来源 |
| 列表首批全是已恢复项、后页失败、重复点击 | `TranscriptPersonalChanges.load` | 保留 cursor，相同 cursor 重试，在途合并，按 segment_uid 去重 |
| 旧来源/账号响应晚到、关闭读取中的弹层 | source key + AbortController + 共享对话框 | 忽略晚响应，允许关闭只读读取并归还焦点 |
| 已知撤权、账号变化 | hook 的 access epoch / saved error owner | 清理私人正文及源列表/行比较/替换弹层；实际 Go 撤权再验证 |
| 失效标记和不在当前行中的保存内容 | saved 列表本身 | 展示真实标记文字及失效提示，不依赖当前行映射 |
| 中英文切换 | 原 `connectArkmeLocale` / actionEnglish | 新弹层跟随语言，转写正文保持原值 |
| 窄屏下查看比较 | 原共享 picker + 本次内容区约束 | 官方安装包 360px 实测弹层不越界；不声称原桌面整页完成手机适配 |
| 精确替换重复词、跨设备恢复、mark/cancel、旧命令重放 | 原选区工具条 → Host → Audio/public WebRTC → Mongo | 官方 DSH 实际运行；另一参与者视图隔离、外部账号拒绝、ASR/Room 原始事实不变 |

只沿用已有 Host 及后端业务 owner；本次不创建源级历史修改能力、不把当前保存视图解释为编辑时间线。


## 最终验收结果

- `typecheck`、完整 `build`、`git diff --check` 均通过。
- 全量 Vitest：1515 文件通过、29 文件跳过；17012 测试通过、39 测试按已有环境条件跳过，0 失败。最终测试期间产品代码未变动。
- 本次更正交互/弹层/语言切换相关 42 项通过；录音文件页 33 项通过，包含同日不同 sessionRef 的菜单接线验证。录音文件页一次在其他编译并行时发生原有 5 秒测试超时；保持代码和超时原值，整文件独立复测及最终全量均通过。
- 以相同 3.0.55 版本生成不可变 tgz，包 SHA256 为 `b96822170242f3bdf82c6403c6414989cda95a97b73a2832e1905efbe6157ded`；构建目录、tgz、全新官方 Profile 中的 client/index/sdk/CSS 校验和一致，打包内容没有本机路径及临时凭据。
- 未修改的官方 DSH 0.2.1-rc.2，经官方 CLI 安装到全新临时 Profile，实际完成原录音/通话 UI 操作 → Host → Go Audio/public WebRTC → Mongo 验收。既有 Tools 的正式会话发现/授权/写入与独立安装包 SDK Consumer 也通过。登录身份周边为隔离 oracle，并非生产登录权威；没有声称完成真实音视频硬件或 Windows/Linux 运行验收。
- 正文阅读、单句比较、“我的修改”、360px 比较弹层均留存最终安装包实际截图。为复现多句阅读，页面另补 6 条只读展示语句；可编辑行及私人视图读写/授权都经过真实 Go owner。
- 复审已覆盖原文更新、远端恢复、撤权、切换来源、分页重试、恢复重试及源级/行级语义，未留下已确认待修复问题。原 checkout 和上一任务 checkout 状态保持不变，临时后端 fixture 正常退出、其专用容器已停止、临时凭据已定点清理。
