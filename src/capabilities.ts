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
  offline_context: '自动分析录音与聊天内容，识别相关的线下交流。开启后会分析历史录音和聊天内容，运行时消耗 AI 额度。',
  goal_insight: '根据开启后的新材料自动更新目标。',
  recording_voice_trigger: '录音时说「帮我记一下」和要记的内容，上传后保存为快记，必要时由你确认。仅处理开启后新上传的录音，使用 AI 额度。',
}
