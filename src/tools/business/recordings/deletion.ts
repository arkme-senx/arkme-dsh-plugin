import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeContextToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { RECORDING_DELETION_SETTINGS_QUERY } from '../../../recording-deletion-contract.js'

export const recordingDeletionTool = defineArkmeContextToolModule({
  meta: { id: 'business.recordings.delete-prepare.v1', toolName: 'arkme_recording_delete_prepare', kind: 'business', phase: 'host', effect: 'read', profiles: ['business', 'hybrid'] },
  create: (ctx, ports) => defineTool({
    name: 'arkme_recording_delete_prepare',
    description: 'On an explicit request to delete entire cloud recordings, prepare a read-only plan for exact local calendar dates, using the account setting timezone and current owned storage. Use the dates already found by the storage query. For a daily size rule pass the strict lower bound in bytes (400 MiB = 419430400). Up to 31 dates and 100 distinct recordings. The result never deletes: show the returned confirmationUrl as an Arkme link; only the human can confirm that frozen list on its page. If disabled, display settingsUrl. Explain entire recordings and associated data are permanently deleted, including their cross-day portion. After the human uses the page, read status via plan_ref; never claim deletion from a prepared plan or resubmit uncertain results automatically.',
    parameters: {
      action: { type: 'string', enum: ['prepare', 'status'], required: true },
      dates: { type: 'array', items: { type: 'string' }, description: 'For prepare, exact YYYY-MM-DD dates the human selected or that matched the preceding query.' },
      above_bytes: { type: 'number', description: 'Optional strict per-day threshold in bytes. Omit only for explicitly requested dates without a storage rule.' },
      plan_ref: { type: 'string', description: 'For status, the unchanged planRef returned by prepare.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      if (args.action === 'status') return taggedJSON('录音删除结果', await ports.recordingDeletionStatus(String(args.plan_ref ?? ''), exec.signal))
      const port = ctx.webServer.port
      if (port === undefined) throw new Error('当前 DSH 未启用本机确认页面')
      const base = `http://127.0.0.1:${port}`
      const plan = await ports.recordingDeletionPlan({ dates: args.dates, aboveBytes: args.above_bytes }, exec.signal)
      if (plan.status === 'disabled') {
        return taggedJSON('录音删除未启用', { status: plan.status,
          settingsUrl: `${base}/?${RECORDING_DELETION_SETTINGS_QUERY}=1`, message: '请在设置 › 数据管理中开启「允许 DSH 删除云端录音」。' })
      }
      if (plan.status === 'empty') return taggedJSON('没有可删除的录音', plan)
      const { path, ...summary } = plan
      return taggedJSON('录音删除确认', { ...summary, confirmationUrl: new URL(path, base).toString() })
    },
  }),
})
