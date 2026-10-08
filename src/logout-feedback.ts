import { randomUUID } from 'node:crypto'
import { ArkmePluginError } from './services/service.js'
import type { ArkmeLogoutFeedback } from './types.js'

/** In-memory feedback survives renderer navigation, not account credentials. */
export class LogoutFeedback {
  private state: ArkmeLogoutFeedback = { status: 'idle' }

  snapshot(): ArkmeLogoutFeedback { return { ...this.state } }

  async run<T>(logout: () => Promise<T>): Promise<T> {
    this.state = { status: 'pending' }
    try {
      const result = await logout()
      this.state = { status: 'idle' }
      return result
    } catch (error) {
      const reasons: string[] = []
      const seen = new Set<unknown>()
      for (let cause: unknown = error; cause !== undefined && !seen.has(cause) && seen.size < 4;) {
        seen.add(cause)
        const reason = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
        if (reason.trim() && !reasons.includes(reason)) reasons.push(reason)
        cause = cause instanceof Error ? cause.cause : undefined
      }
      const detail = reasons.join('；')
        .replace(/Bearer\s+[^\s;,]+/gi, 'Bearer [已隐藏]')
        .replace(/((?:access[_-]?token|refresh[_-]?token|authorization|password)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[已隐藏]')
        .slice(0, 800)
      const message = `退出登录失败：${detail || '未知错误，请重试'}`
      this.state = { status: 'failed', id: randomUUID(), message }
      throw new ArkmePluginError('logout-failed', message, true, 500)
    }
  }
}
