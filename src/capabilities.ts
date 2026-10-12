export const automaticCapabilityKeys = ['personal_profile', 'record_thought', 'chat_thought', 'arrangement_recognition', 'goal_insight'] as const
export type AutomaticCapabilityKey = typeof automaticCapabilityKeys[number]
export interface ArkmeCapabilitySetting { key: AutomaticCapabilityKey; title: string; enabled: boolean; version: number; enabledAt: number }
export interface ArkmeCapabilitySettings { accountScope: string; settings: ArkmeCapabilitySetting[] }
export interface ArkmeCapabilityUpdate { key: AutomaticCapabilityKey; enabled: boolean; expectedVersion: number; billingConsent: boolean }
export const automaticCapabilityDescriptions: Record<AutomaticCapabilityKey, string> = {
  personal_profile: '持续更新个人档案。首次开启会分析所选来源的历史材料。结果可在移动端「探索 → 个人档案」查看。',
  record_thought: '根据开启后的新快记生成建议。',
  chat_thought: '根据开启后的聊天生成仅自己可见的建议。',
  arrangement_recognition: '从开启后的快记、录音总结和通话中识别自己的安排。',
  goal_insight: '根据开启后的新材料自动更新目标。',
}
