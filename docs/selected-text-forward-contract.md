# 选段转发与原文定位

选段转发沿用已有的文字选择工具栏和转发选择器。用户主动发送的是一份独立阅读摘录；不发送未选中的原文、附件或媒体授权。附言可不填写。

## 唯一事实来源

Record 保存一份加密正文及 `content_payload.excerpt`。Chat 保存现有的关系、审核和接受记录。新发送不写本地 quote 表；旧本地摘录继续由既有读取路径呈现。

新摘录保留 schema_version=1，使用 kind=forward。header_end、quote_start/end、note_start 是这份正文的 UTF-16 坐标；source_selection 则是原文 arkme-text-v1 规范化投影的坐标。两种坐标不可混用。source_selection 仅包含 projection、source_digest、start/end、可选 record_version，不含 Anchor.text、prefix、suffix。

引用标题与正文冻结。空附言没有“附言”分隔段；增删附言时，由已有 Record CAS 编辑入口重算边界及 frozen_digest。引用区域不生成标签、@ 或自动润色；附言的标签证据使用其在完整正文中的位置。群消息继续经过原有安全审核。

## Host 业务 owner 与三个入口

| 消费面 | 入口 | 业务 owner | 验证方式 |
| --- | --- | --- | --- |
| UI | 既有文字选择工具栏 → 既有多目标选择器 | ArkmeService.prepareSelectedText / forwardSelectedText / excerptOriginal | DOM 来源矩阵、选择器重试、实际浏览器验收 |
| DSH Tool | arkme_selected_text_prepare / arkme_selected_text_forward / arkme_selected_text_original | 同一 Host 方法 | 官方 DSH Session、正式 tools registrar、明确用户写确认 |
| SDK | prepareSelectedText / forwardSelectedText / excerptOriginal | 相同 Host operation | 不可变 tgz 安装后的仓外 Consumer |

Provider capabilities 的 selectedTextForwardV1 用于 SDK 合同探测，不是灰度或运维配置。SDK dispose 及调用者 AbortSignal 共同约束这三项请求。

prepare 在打开选择器前解析一次已有来源引用，之后每个目标使用同一冻结选段。录音分页视图利用 Audio owner 的标量边界，把选区一次映射到完整片段的规范投影；不按相同文字搜索位置，不增加持久化定位字段。每个目标有独立且稳定的 recordUid、relationUid、sendAtMillis。首个发送意图冻结后，重试复用原参数；成功目标不重发，未知结果不生成新身份。

私聊、群聊使用现有 native send；自己、默认分类、个人话题使用现有 Record 入口。Record 复用 creation anchor，Chat 复用 send_intent_digest。已完成的重试返回接受事实，不覆盖后续编辑、恢复删除或重建已移除的话题关系。审核任务登记失败仍交给原有幂等审核 owner 补齐，不另建队列或状态机。

## 原文定位

已发送摘录与原文的生命周期独立。原文修改、撤回、删除或撤权不追删摘录。每次查看原文都会重新读取摘录 occurrence，再通过已有来源 owner 校验当前权限，核对 digest、版本和确切选区，结束前重新核验摘录和账号。原文不匹配时保留摘录，禁止按相同文字猜测位置。账号切换关闭已打开的原文面板。

来源包括个人或聊天 Record、团队消息、Arko、Codex 事件、DSH 消息、录音及通话片段。来源读取接口不接受任意 URL，也不发放附件/媒体权限。旧摘录缺少精确选区时只维持原有权限检查，不伪造精确高亮。

## 存储和交付边界

无新增 Mongo 集合、SQLite 表、索引、回填、灰度开关或生产配置。后端合同须先于客户端发布。客户端回退可保留单份正文的可读性；后端回退须保留已发布 excerpt 结构和幂等接受合同，不能破坏性删除这些字段。

测试 fixture 仅在显式设置 CODEX_EXCERPT_CONTRACT_DIR / CODEX_EXCERPT_TEST_MONGO 时运行，强制 loopback Mongo，独占临时数据库。普通测试不连接线上服务。运行记录应区分真实 owner 写入、外部审核/通知测试替身、未执行的真实设备验收和基线既有失败，不以其他分支的通过结果替代本分支证据。
