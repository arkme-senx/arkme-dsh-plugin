export const automaticCapabilityKeys = ['personal_profile', 'record_thought', 'chat_thought', 'arrangement_recognition', 'goal_insight', 'offline_context'] as const
export type AutomaticCapabilityKey = typeof automaticCapabilityKeys[number]
export interface ArkmeCapabilitySetting { key: AutomaticCapabilityKey; title: string; enabled: boolean; version: number; enabledAt: number }
export interface ArkmeCapabilitySettings { accountScope: string; settings: ArkmeCapabilitySetting[] }
export interface ArkmeCapabilityUpdate { key: AutomaticCapabilityKey; enabled: boolean; expectedVersion: number; billingConsent: boolean }
export const automaticCapabilityDescriptions: Record<AutomaticCapabilityKey, string> = {
  personal_profile: '持续更新个人档案。首次开启会分析所选来源的历史材料。结果可在移动端「探索 → 个人档案」查看。',
  record_thought: '阿森会阅读你开启后新增的快记，在有想法时给出回应。',
  chat_thought: '阿森会根据你开启后的聊天内容给出想法，仅你自己可见。',
  arrangement_recognition: '从开启后的快记、录音总结和通话中识别自己的安排。',
  offline_context: '根据开启后新增的录音或聊天内容，自动发现线下交流与聊天的关联，仅你自己可见。需要理解附件时会分析附件内容，消耗 AI 额度。',
  goal_insight: '根据开启后的新材料自动更新目标。',
}
