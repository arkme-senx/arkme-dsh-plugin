import type {ArkmeBackgroundSoundFailure} from './record-input-capture.js'

const ARKME_BACKGROUND_TRANSFER_TIMEOUT_MILLIS = 20_000

export async function boundedArkmeBackgroundTransfer<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMillis = ARKME_BACKGROUND_TRANSFER_TIMEOUT_MILLIS,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  parent?.throwIfAborted()
  const abort = () => controller.abort(parent?.reason)
  parent?.addEventListener('abort',abort,{once:true})
  const timer = globalThis.setTimeout(() => { controller.abort(new Error('背景音处理超时')) }, timeoutMillis)
  try {
    return await operation(controller.signal)
  } finally {
    parent?.removeEventListener('abort',abort)
    globalThis.clearTimeout(timer)
  }
}


export function arkmeBackgroundSoundCaptureFailureFeedback(
  failure: ArkmeBackgroundSoundFailure | undefined,
): string {
  if (failure === 'permission-denied') return '未获得麦克风权限'
  if (failure === 'unavailable') return '当前设备无法录制'
  if (failure === 'start-failed') return '录音启动失败'
  if (failure === 'stop-failed') return '录音结束失败'
  if (failure === 'retention-evicted') return '切换会话较多，较早草稿的背景音已释放'
  if (failure === 'limit-reached') return '录音达到上限且未生成可用片段'
  return ''
}
