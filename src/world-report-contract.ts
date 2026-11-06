/** Reports use public references; private source IDs and evidence stay on Host. */
export const WORLD_REPORT_REASONS = ['网络暴力', '违法信息', '人身攻击', '违规营销', '骚扰我', '诈骗信息'] as const
export type WorldReportRequest = { recordRef: string; expectedUserId: number } & (
  | { action: 'pending' }
  | { action: 'acknowledge'; requestUid: string }
  | { action: 'submit'; reportType: number; reason: string; requestUid: string; confirmed: true }
)
export interface WorldReportPending {
  requestUid: string
  reportType: number
  reason: string
}
export interface WorldReportResult { submitted?: true; pending?: WorldReportPending }
export interface WorldReportCommand extends WorldReportPending { recordUid: string; contentRevision: string; receipt?: {reportId:number} }
export function validWorldReportCommand(value: unknown): value is WorldReportCommand {
  if (!value || typeof value !== 'object') return false
  const v = value as WorldReportCommand
  return (v.receipt === undefined || !!v.receipt && Number.isSafeInteger(v.receipt.reportId) && v.receipt.reportId > 0)
    && typeof v.recordUid === 'string' && v.recordUid.length > 0 && v.recordUid.length <= 128
    && typeof v.contentRevision === 'string' && /^[a-f0-9]{32}$/u.test(v.contentRevision)
    && typeof v.requestUid === 'string' && /^[A-Za-z0-9_-]{16,128}$/u.test(v.requestUid)
    && Number.isInteger(v.reportType) && v.reportType >= 1 && v.reportType <= 6
    && typeof v.reason === 'string' && v.reason.trim() === v.reason && [...v.reason].length > 0 && [...v.reason].length <= 500
}

export function sameWorldReportCommand(a:WorldReportCommand,b:WorldReportCommand):boolean {
 return a.recordUid===b.recordUid && a.contentRevision===b.contentRevision && a.requestUid===b.requestUid && a.reportType===b.reportType && a.reason===b.reason
}
