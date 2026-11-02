# 录音语音触发 v2 接入合同

正式路线为既有 Audio ASR → 字面/严格同音候选 → Intelligent 付费语境与原文边界 → Audio 决定 → 原生个人 Record。上传旧文件、移动/PC 长录音、全天候录音共用规范源确认入口；主动短语音发送是另一业务。不能恢复 ASR 完全漏掉的口令，不宣称具有原音 KWS 的召回保证。

| 能力面 | 共用 owner 与调用 | 验收 |
| --- | --- | --- |
| UI | 原有更多 → 语音触发、规则、候选、播放、保存、忽略、独立说话人编辑 | 官方未修改 DSH、正式 tgz、真实浏览器与跨服务回路 |
| Host | RecordingVoiceTriggerService：账号核验、规则 CAS、密封候选/游标；RecordingService 精确定位 | owner/UI/SDK/Tools 相关 22 项，完整插件 15086 项通过 |
| SDK | 公开 voiceTriggerSettings/Page/Detail、setVoiceTriggerRules、decideVoiceTrigger；探测 recordingVoiceTriggersV2 | 独立带空格目录 consumer 从正式安装的公开包导入、类型编译和调用、不支持能力、abort、dispose |
| Tools | arkme_recording_voice_triggers；arkme_recording_voice_trigger_command，explicit-user-write + 当前人工确认 | 官方 DSH 实际会话发现并调用读取工具；写入 grant/准备确认/CAS 的正式框架与 owner 测试 |

三者复用同一 Host owner；Tools 从该 owner 取得当前账号范围，不依赖额度设置业务来推断账号。Tools 不能开启持续扣费，保存不隐式标记声音或训练。SDK 无后台监听资源，单次请求支持 caller AbortSignal；沿用 SDK 既有 dispose。

## HTTP 与证据

统一 POST `/api/v1/audio/voice-triggers/`，沿用用户认证和标准 envelope，data.user_id 必须为当前登录用户。capabilities `{}` 返回 version=2、detector=transcript、ready 与 upload/long-recording/all-day；旧 acoustic v1 不按等价能力接受。真实网络、鉴权、DB/依赖失败保留错误，不能显示无候选；部署能力缺失与临时故障区分。

- rules/query `{}`；rules/set `{expected_revision,rules}`。最多20条、每条5别名；NFKC归一，3–32字，有效字母/数字≥3，禁止归一后重复。默认“帮我记一下”关闭，autoSaveSelf=true。云规则扩展现有偏好；未就绪时原有本机草稿不表示云检测启动。
- candidates/query `{limit:30,order:"self-first",cursor?}`。全局稳定分页用服务端有界快照，当前身份与权限重新核验；过期/冲突要求刷新。Host 将真实游标和候选 ID 密封为账号/Profile 范围的不透明引用。
- 候选提供 phrase/text/start_at/end_at/speaker/speaker_label/status/boundary/pending_reason/revision。evidence={kind:"transcript",model,match:"literal"|"phonetic"}，不伪造声学分数。仅 saved 提供已持久化 record_uid，Host 公共类型为 recordUID。
- candidates/detail `{id}` 返回 Host 内部 canonical recording/child/ordinal/view_revision 锚点；Host 从原有 primary transcript 精确恢复 Workbench itemRef，不按邻近时间猜片段，不把内部 ID 或凭据交给 UI/SDK/Tools。播放复用既有授权 ClipRef。
- candidates/decide `{id,expected_revision,decision:"save"|"ignore",confirmed_range?}`。完整正文直接确认，uncertain 必须明确确认当前显示文本，open/无正文不能保存。pending+save_in_progress 是已受理，非完成；真实 Record 回执后 saved，回执丢失重试同一候选仍指向同一 Record。相反决定409。

规则启用、autoSaveSelf 与中央自动使用额度是三个不同事实；移动端与插件复用 recording_voice_trigger 默认关闭的中央设置，明确同意后开启。关闭/重开不授权旧材料回扫；手动保存已有已解释候选不重新调用模型或要求声纹。

自动保存还要求字面匹配、明确完整指令、最新可用的本人身份和未改变的规则/授权版本。未知/其他人/严格同音/缺上下文保留人工确认。音频时长只用于来源、播放和原话发生日期，正文预算按文字/片段，技术分片不等于语义结束。

## 安装与验证边界

插件版本保持3.0.39，根README与版本字段未修改。验证使用官方 dsh-v0.2.1-rc.2 / 687f282e8625c6b8d11ff58211a90524be2e4317 的未修改运行时和独立任务 Profile；没有替换常驻实例。跨仓 runner 位于 Meta `scripts/e2e/run_recording_voice_pc.py`，只允许隔离本机依赖。

ASR 原文来自实际既有 recognizer 报告，绑定波形SHA256；正式转写提交、候选、服务间HTTP、中央同意设置、原生 Record/Mongo、播放授权和实际媒体字节走真实路径。供应商响应与对象字节读取是明示 fixture；真实三模型评估、真实钱包 MySQL 故障回归另行验证，不把这些 seam 宣称为生产供应商/真实用户佩戴测试。实际运行平台为 macOS arm64；没有宣称 Windows/Linux 实机验收。
