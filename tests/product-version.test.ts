import { describe, expect, it } from 'vitest'
import { formatProductVersion } from '../src/client/product-version.js'

describe('product version', () => {
  it('reflects independent plugin and installed client updates', () => {
    expect(formatProductVersion('0.1.55', 277)).toBe('v0.1.55+277')
    expect(formatProductVersion('0.1.56', 277)).toBe('v0.1.56+277')
    expect(formatProductVersion('0.1.55', 278)).toBe('v0.1.55+278')
  })
  it.each([undefined, null, 0, -1, 1.5, '277', NaN, Infinity, 2_147_483_648])('omits unavailable or invalid client metadata: %s', value => {
    expect(formatProductVersion('0.1.55', value)).toBe('v0.1.55')
  })
})
