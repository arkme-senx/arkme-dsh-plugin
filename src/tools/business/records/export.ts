import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const recordExportToolModules = [
  defineArkmeCoreToolModule({
    meta: { id: 'business.records.export-preflight.v1', toolName: 'arkme_records_export_preflight', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
    create: ports => defineTool({
      name: 'arkme_records_export_preflight', description: 'Check full record backup eligibility and counts without consuming quota. Privacy-locked records are excluded.',
      parameters: { account_scope: { type: 'string', required: true, description: 'Current account scope from Arkme authentication, environment:userId.' } }, output: TEXT_OUTPUT,
      execute: async (args, exec) => taggedJSON('导出条件', await ports.dataExportPreflight(args.account_scope, exec.signal)),
    }),
  }),
  defineArkmeCoreToolModule({
    meta: { id: 'business.records.export.v1', toolName: 'arkme_records_export', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
    create: ports => defineTool({
      name: 'arkme_records_export', description: 'After explicit user confirmation, export all non-privacy-locked records with images and voice to a ZIP. Consumes export allowance. Returns an account-bound fileRef for the existing local-file download API; never a remote signed URL. Do not automatically retry an unknown outcome.',
      parameters: {
        account_scope: { type: 'string', required: true, description: 'Account scope used for preflight.' },
        order: { type: 'string', enum: ['newest', 'oldest'], required: true, description: 'Record order.' },
      }, output: TEXT_OUTPUT,
      execute: async (args, exec) => taggedJSON('记录备份', await ports.dataExport({ expectedAccountScope: args.account_scope, orderKind: args.order === 'oldest' ? 2 : 1, confirmed: true }, exec.signal)),
    }),
  }),
] as const
