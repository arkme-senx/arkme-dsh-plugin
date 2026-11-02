import { describe, expect, it } from 'vitest'
import { formatProductVersion } from '../src/client/product-version.js'

describe('product version', () => {
  it('reflects independent plugin and installed client updates', () => {
    expect(formatProductVersion('3.0.38', 300)).toBe('v3.38.300')
    expect(formatProductVersion('3.0.39', 300)).toBe('v3.39.300')
    expect(formatProductVersion('3.0.38', 301)).toBe('v3.38.301')
  })
  it.each([undefined, null, 0, -1, 1.5, '300', NaN, Infinity, 2_147_483_648])('omits unavailable or invalid client metadata: %s', value => {
    expect(formatProductVersion('3.0.38', value)).toBe('v3.38')
  })
})
