import { describe, expect, it, vi } from 'vitest'
import { MembershipService, parseMembership, parseMembershipProducts } from '../../src/services/membership-service.js'

const rawProduct = { spu_code: 1, money: 1800, name: '月度会员', month_count: 1, is_period: false, alipay_product_id: 12, wechat_product_id: 14 }
describe('membership owner contracts', () => {
  it.each([0,1,2])('uses actual membership type %s, regardless of payment source', memberType => {
    expect(parseMembership({ member_type: memberType, is_gifted: 1 }, 11)).toMatchObject({ userId:11, memberType, gifted:true, lifetime:false })
  })
  it('converts microseconds and recognizes lifetime, not a paid renewal obligation', () => {
    const now = Date.UTC(2026,8,18)
    const expire = Date.UTC(2226,8,18)
    expect(parseMembership({ member_type: 2, expire_at:expire*1000 }, 11, now)).toMatchObject({ expireAtMillis:expire, lifetime:true })
  })
  it.each([{}, {member_type:'0'}, {member_type:-1}, {member_type:3}, {member_type:1,expire_at:1_789_718_400_000}])('rejects invalid member contract %j instead of claiming free', raw => {
    expect(() => parseMembership(raw, 11)).toThrow()
  })
  it('reads currency in minor units and offers only actual sale products', () => {
    expect(parseMembershipProducts({data_ls:[rawProduct]})).toEqual([{id:'1:12:14:once', memberType:1, name:'月度会员',priceMinor:1800,currency:'CNY',recurring:false,monthCount:1}])
    expect(parseMembershipProducts({data_ls:[]})).toEqual([])
  })
  it.each([{data_ls:null}, {data_ls:[{...rawProduct,money:-1}]}, {data_ls:[{...rawProduct,money:'1800'}]}, {data_ls:[{...rawProduct,spu_code:3}]}, {data_ls:[rawProduct,rawProduct]}])('rejects malformed catalog %j', raw => {
    expect(() => parseMembershipProducts(raw)).toThrow()
  })
  it('uses two read endpoints, authenticated and bound to expected user', async () => {
    const requireSession = vi.fn(async () => ({userId:11}))
    const read = vi.fn().mockResolvedValueOnce({member_type:0}).mockResolvedValueOnce({data_ls:[rawProduct]})
    const service = new MembershipService({requireSession,authenticatedAuthReadPost:read} as never)
    await expect(service.current(11)).resolves.toMatchObject({memberType:0,userId:11})
    await expect(service.catalog(11)).resolves.toMatchObject({userId:11,checkout:'mobile-app-only'})
    expect(read.mock.calls.map(c=>c[0])).toEqual(['/api/v1/premium/get/member','/api/v1/payment/get/sale-product'])
    expect(read.mock.calls.every(c => Object.keys(c[1]).length===0 && c[2].userId===11)).toBe(true)
  })
  it('drops catalog after an account switch and rejects stale callers before querying', async () => {
    let userId=11
    const read=vi.fn(async()=>{userId=12;return {data_ls:[rawProduct]}})
    const service=new MembershipService({requireSession:async()=>({userId}),authenticatedAuthReadPost:read} as never)
    await expect(service.catalog(11)).rejects.toMatchObject({code:'membership-account-changed'})
    read.mockClear()
    await expect(service.catalog(11)).rejects.toMatchObject({code:'membership-account-changed'})
    expect(read).not.toHaveBeenCalled()
  })
})
