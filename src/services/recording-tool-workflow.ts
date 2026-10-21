import type { RecordingToolBatchPlanner } from '../recording-tool-batch.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
import type { RecordingWorkflowService } from './recording-workflow-service.js'

export function recordingToolBatchPlanner(runtime: ServiceRuntime, workflow: RecordingWorkflowService): RecordingToolBatchPlanner {
  return async (userId, candidates, signal) => {
    const current = async () => {
      signal?.throwIfAborted()
      const session = await runtime.requireSession()
      if (session.userId !== userId) throw new ArkmePluginError('recording-import-account-mismatch', '账号已切换，导入已停止', false, 409)
    }
    await current()
    // Never treat a network/authentication failure as permission to omit the batch.
    const capability = await workflow.request({ operation: 'capabilities' }, signal)
    await current()
    if (!capability || !('supported' in capability)) throw new Error('录音批次能力返回无效')
    if (!runtime.stateStore.planRecordingToolBatch) throw new Error('录音批次本机保存不可用，请重试')
    const members = await runtime.stateStore.planRecordingToolBatch(
      `${runtime.config.environment}:${userId}`, capability.supported ? candidates : candidates.map(row => ({ ...row, isNew: false })),
      Intl.DateTimeFormat().resolvedOptions().timeZone, signal,
    )
    await current()
    if (!capability.supported && candidates.some(row => row.isNew && members[row.key])) {
      throw new ArkmePluginError('recording-workflow-support-lost', '原导入批次暂不可继续，请稍后重试；不会转为普通上传', true, 503)
    }
    return { supported: capability.supported, members }
  }
}
