import { randomUUID } from 'node:crypto'

/**
 * Arkme Host 进程生命周期身份。
 *
 * 模块只在当前 Node 进程内生成一次；SSE 重连与 provider.instance 共用该值。
 * 该值不持久化，也不参与用户、账号或设备鉴权。
 */
export const ARKME_RUNTIME_INSTANCE_ID = randomUUID()
