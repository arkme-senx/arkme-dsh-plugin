export const automaticCapabilityKeys = ['personal_profile', 'record_thought', 'chat_thought', 'arrangement_recognition', 'goal_insight', 'offline_context', 'recording_voice_trigger', 'event_insight', 'anniversary_insight', 'record_entity', 'call_summary'] as const
export type AutomaticCapabilityKey = typeof automaticCapabilityKeys[number]
export interface ArkmeCapabilitySetting { key: AutomaticCapabilityKey; title: string; enabled: boolean; version: number; enabledAt: number }
export interface ArkmeCapabilitySettings { accountScope: string; settings: ArkmeCapabilitySetting[] }
export interface ArkmeCapabilityUpdate { key: AutomaticCapabilityKey; enabled: boolean; expectedVersion: number; billingConsent: boolean }
export const automaticCapabilityDescriptions: Record<AutomaticCapabilityKey, string> = {
  record_entity: '自动识别快记中的实体，运行时消耗 AI 额度。',
  call_summary: '通话结束后自动生成 AI 总结，生成时会消耗 AI 积分。',
  personal_profile: '持续更新个人档案。首次开启会分析所选来源的历史材料。',
  record_thought: 'Arko 会阅读你开启后新增的快记，在有想法时给出回应。',
  chat_thought: 'Arko 会根据你开启后的聊天内容给出想法，仅你自己可见。',
  arrangement_recognition: '从开启后的快记、录音总结和通话中识别自己的安排。',
  offline_context: '自动分析录音与聊天内容，识别相关的线下交流。开启后会分析历史录音和聊天内容，运行时消耗 AI 额度。',
  goal_insight: '根据开启后的新材料自动更新目标。',
  event_insight: '使用当前选择的模型整理事件。会处理所选模型尚未完成的历史记录，并持续分析新材料，运行时消耗 AI 额度。',
  anniversary_insight: '根据开启后的新材料自动更新纪念日，使用所选模型并消耗 AI 额度。手动重新分析由你单独触发。',
  recording_voice_trigger: '录音时说「帮我记一下」和要记的内容，上传后保存为快记，必要时由你确认。仅处理开启后新上传的录音，使用 AI 额度。',
}
