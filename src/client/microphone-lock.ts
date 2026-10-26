/** Shared with direct recordings; one origin cannot silently record the same microphone twice. */
export async function lockMicrophone(): Promise<() => void> {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('当前环境不支持安全的多窗口录音，请更新客户端后重试')
  return await new Promise((resolve, reject) => {
    void navigator.locks.request('arkme.direct-microphone', { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('其他窗口正在录音或听写，请先结束后重试')); return }
      await new Promise<void>(release => resolve(release))
    }).catch(reject)
  })
}
