/** Exact decimal points are transport values. Never use Number for accounting. */
export interface ArkmeAiPointsAccount {
  accountScope: string
  unit: 'ai_points'
  availablePoints: string
  reservedPoints: string
  grantedPoints: string
  purchasedPoints: string
  observedAt: number
  grants: { source: string; availablePoints: string; expiresAt: number }[]
}
export interface ArkmeAiPointsConsumption {
  requestUid: string
  businessCode: string
  model: string
  chargedPoints: string
  modelPoints: string
  services: { code: string; quantity: string; chargedPoints: string }[]
  grantedPoints: string
  purchasedPoints: string
  createdAt: number
  completedAt: number
  tokens: { cacheHitInput: string; cacheMissInput: string; output: string }
}
export interface ArkmeAiPointsPage {
  accountScope: string
  unit: 'ai_points'
  month: string
  chargedPoints: string
  items: ArkmeAiPointsConsumption[]
  nextBeforeId: string
}
export interface ArkmeAiPointsQuery { month: string; beforeId?: string }

export function pointsUnits(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value)) throw new TypeError('Invalid exact AI points')
  const [whole = '0', fraction = ''] = value.split('.')
  const units = BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'))
  if (units > 9_223_372_036_854_775_807n) throw new TypeError('AI points exceed accounting range')
  return units
}

/** Display floors only; a rounded label can never overpromise spendable points. */
export function formatAiPoints(value: string): string {
  const units = pointsUnits(value)
  if (units > 0n && units < 100_000n) return '< 0.01'
  const hundredths = units / 100_000n
  const whole = (hundredths / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

/** Existing recharge values retain their nano-CNY meaning: ¥1 = 100 points. */
export function nanoCnyToPoints(value: string): string {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new TypeError('Invalid nano-CNY')
  const units = BigInt(value)
  const whole = units / 10_000_000n
  const fraction = (units % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}
