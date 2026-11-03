export const automaticCapabilityKeys = ['personal_profile', 'record_thought', 'chat_thought', 'arrangement_recognition', 'goal_insight', 'offline_context', 'recording_voice_trigger'] as const
export type AutomaticCapabilityKey = typeof automaticCapabilityKeys[number]
export interface ArkmeCapabilitySetting { key: AutomaticCapabilityKey; title: string; enabled: boolean; version: number; enabledAt: number }
export interface ArkmeCapabilitySettings { accountScope: string; settings: ArkmeCapabilitySetting[] }
export interface ArkmeCapabilityUpdate { key: AutomaticCapabilityKey; enabled: boolean; expectedVersion: number; billingConsent: boolean }
export const automaticCapabilityDescriptions: Record<AutomaticCapabilityKey, string> = {
  personal_profile: '持续更新个人档案。首次开启会分析所选来源的历史材料。',
  record_thought: 'Arko 会阅读你开启后新增的快记，在有想法时给出回应。',
  chat_thought: 'Arko 会根据你开启后的聊天内容给出想法，仅你自己可见。',
  arrangement_recognition: '从开启后的快记、录音总结和通话中识别自己的安排。',
  offline_context: '开启后会检查历史及新增的录音和聊天，自动发现线下交流与聊天的关联，仅你自己可见。分析文本或附件会消耗 AI 额度；相同内容的分析结果会复用，重复开关不会重复计费。关闭后暂停自动处理。',
  goal_insight: '根据开启后的新材料自动更新目标。',
  recording_voice_trigger: '先在电脑版「语音触发」中启用记事口令，例如「帮我记一下」。录音上传并转成文字后，会提取口令后面的原话，供你核对并保存为快记。若规则允许自动保存，且可靠识别为本人、内容完整，会保存到「发给自己」。分析会使用 AI 额度；只处理开启后新上传的录音，已有云端录音不会自动重新处理。',
}
