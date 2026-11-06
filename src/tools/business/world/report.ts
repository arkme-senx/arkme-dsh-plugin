import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import type { WorldReportRequest } from '../../../world-report-contract.js'
export const worldReportTool = defineArkmeCoreToolModule({
  meta: { id:'business.world.report.v1', toolName:'arkme_world_report', kind:'business', phase:'core', effect:'write', grant:'explicit-user-write', profiles:['business','hybrid'] },
  create(ports) { return defineTool({ name:'arkme_world_report', description:'Report a public World item only after explicit user confirmation of the exact reason. Reasons: 1 网络暴力, 2 违法信息, 3 人身攻击, 4 违规营销, 5 骚扰我, 6 诈骗信息. Reuse the persisted original request after an uncertain response; pending reads the original request without sending it. Never report private content.', parameters:{request_json:{type:'string',required:true,description:'JSON recordRef, expectedUserId, action pending|submit|acknowledge. acknowledge requires requestUid and is allowed only after the Host has a confirmed receipt. submit requires confirmed:true, reportType 1..6, reason 1..500 Unicode characters, requestUid 16..128 safe characters. Preserve all fields from pending when retrying.'}}, output:TEXT_OUTPUT, async execute(args,exec) {
    const value=JSON.parse(args.request_json) as WorldReportRequest
    if (!value || !['pending','submit','acknowledge'].includes(value.action) || value.action==='submit' && value.confirmed!==true) throw new TypeError('Explicit report confirmation required')
    return taggedJSON('公开内容举报回执',await ports.worldReport(value,exec.signal))
  }}) },
})
