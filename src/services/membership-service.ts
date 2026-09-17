import type { ArkmeMembership, ArkmeMembershipCatalog, ArkmeMembershipProduct } from '../types.js'
import { BackgroundSoundMembershipService } from './background-sound-membership-service.js'
import { ArkmePluginError, ServiceRuntime } from './service.js'

function invalid(): never {
  throw new ArkmePluginError('membership-contract-invalid', '会员信息暂时无法确认，请稍后重试', true, 502)
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid()
  return value
}
function timestamp(value: unknown): number | null {
  if (value === undefined || value === null || value === 0) return null
  // premium/get/member uses UnixMicro, not JavaScript milliseconds.
  const micros = integer(value)
  const millis = Math.floor(micros / 1000)
  if (millis < Date.UTC(2000, 0) || millis > Date.UTC(3000, 0)) return invalid()
  return millis
}

export function parseMembership(raw: Record<string, unknown>, userId: number, now = Date.now()): ArkmeMembership {
  const memberType = integer(raw.member_type)
  if (memberType > 2) return invalid()
  const expireAtMillis = timestamp(raw.expire_at)
  return {
    userId, memberType: memberType as 0 | 1 | 2,
    expireAtMillis,
    gifted: raw.is_gifted === 1,
    // Same lifetime convention as Flutter. Do not infer free from payment origin.
    lifetime: memberType === 2 && expireAtMillis !== null && expireAtMillis > now + 100 * 365.25 * 86_400_000,
  }
}

export function parseMembershipProducts(raw: Record<string, unknown>): ArkmeMembershipProduct[] {
  if (!Array.isArray(raw.data_ls)) return invalid()
  const products = raw.data_ls.map((entry: unknown): ArkmeMembershipProduct => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return invalid()
    const row = entry as Record<string, unknown>
    const memberType = integer(row.spu_code)
    if (memberType !== 1 && memberType !== 2) return invalid()
    if (typeof row.name !== 'string' || !row.name.trim() || typeof row.is_period !== 'boolean') return invalid()
    const alipayId = integer(row.alipay_product_id)
    const wechatId = integer(row.wechat_product_id)
    if (alipayId === 0 && wechatId === 0) return invalid()
    return {
      id: `${memberType}:${alipayId}:${wechatId}:${row.is_period ? 'recurring' : 'once'}`,
      memberType, name: row.name.trim(), priceMinor: integer(row.money), currency: 'CNY',
      recurring: row.is_period, monthCount: integer(row.month_count),
    }
  })
  if (new Set(products.map(p => p.id)).size !== products.length) return invalid()
  return products.sort((a, b) => a.memberType - b.memberType || a.monthCount - b.monthCount || a.priceMinor - b.priceMinor)
}

/** Membership is distinct from managed-AI balance billing. Only read endpoints are exposed. */
export class MembershipService {
  private readonly membership: BackgroundSoundMembershipService
  constructor(private readonly runtime: ServiceRuntime) {
    this.membership = new BackgroundSoundMembershipService(runtime)
  }
  async current(expectedUserId: number): Promise<ArkmeMembership> {
    const { raw, userId } = await this.membership.readCurrent({ expectedUserId })
    return parseMembership(raw, userId)
  }
  async catalog(expectedUserId: number): Promise<ArkmeMembershipCatalog> {
    if (!Number.isSafeInteger(expectedUserId) || expectedUserId <= 0) return invalid()
    const session = await this.runtime.requireSession()
    if (session.userId !== expectedUserId) throw new ArkmePluginError('membership-account-changed', '账号已切换，请重新打开会员页面', false, 409)
    const raw = await this.runtime.authenticatedAuthReadPost<Record<string, unknown>>('/api/v1/payment/get/sale-product', {}, session)
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('membership-account-changed', '账号已切换，已丢弃套餐结果', false, 409)
    return { userId: session.userId, products: parseMembershipProducts(raw), checkout: 'mobile-app-only' }
  }
}
