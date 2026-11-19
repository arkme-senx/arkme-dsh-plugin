import {describe,it,expect} from 'vitest'
import {PrivateChannel} from '../src/client/game/private-channel.js'
const ctx={room:'room',runtime:'runtime',member:'guest',round:'round',version:3}
async function pair(){const a=await PrivateChannel.create(),b=await PrivateChannel.create();await a.bind('guest',b.publicKey);await b.bind('host',a.publicKey);return {a,b}}
describe('private hand channel',()=>{
 it('only the bound recipient decrypts, with a unique nonce for each transmission',async()=>{
  const {a,b}=await pair(),outsider=await PrivateChannel.create();await outsider.bind('host',a.publicKey)
  const one=await a.seal('guest',ctx,{hand:[1,2,3]}),two=await a.seal('guest',ctx,{hand:[1,2,3]})
  expect(one.nonce).not.toBe(two.nonce);expect(JSON.stringify(one)).not.toContain('hand')
  await expect(outsider.open('host',ctx,one)).rejects.toThrow()
  expect(await b.open('host',ctx,one)).toEqual({hand:[1,2,3]})
  await expect(b.open('host',ctx,one)).rejects.toThrow()
 })
 it('rejects altered ciphertext and room/runtime/member/round/version substitution',async()=>{
  const {a,b}=await pair(),p=await a.seal('guest',ctx,{hand:[53]})
  for(const field of ['room','runtime','member','round','version'] as const){
   const changed={...p,[field]:field==='version'?4:'other'}
   await expect(b.open('host',{...ctx,[field]:changed[field]},changed)).rejects.toThrow()
  }
  await expect(b.open('host',ctx,{...p,ciphertext:(p.ciphertext[0]==='A'?'B':'A')+p.ciphertext.slice(1)})).rejects.toThrow()
  expect(await b.open('host',ctx,p)).toEqual({hand:[53]})
 })
 it('rejects old session envelopes after a new handshake',async()=>{
  const {a,b}=await pair(),p=await a.seal('guest',ctx,{hand:[3]});const replacement=await PrivateChannel.create()
  await a.bind('guest',replacement.publicKey);await replacement.bind('host',a.publicKey)
  await expect(replacement.open('host',ctx,p)).rejects.toThrow()
  expect(await replacement.open('host',ctx,await a.seal('guest',ctx,{hand:[3]}))).toEqual({hand:[3]})
 })
 it('rejects duplicate concurrent decrypt and invalid private keys',async()=>{
  const {a,b}=await pair(),p=await a.seal('guest',ctx,{hand:[]})
  const results=await Promise.allSettled([b.open('host',ctx,p),b.open('host',ctx,p)])
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  await expect(a.bind('bad',{epoch:'x',key:{...b.publicKey.key,d:'private'}})).rejects.toThrow()
 })
})

describe('私有通道生命周期', () => {
  it('仅接受规范的 nonce 编码', async () => {
    const {a,b} = await pair()
    const packet = await a.seal('guest', ctx, 42)
    await expect(b.open('host', ctx, {...packet, nonce: packet.nonce + ' '})).rejects.toThrow()
    await expect(b.open('host', ctx, packet)).resolves.toBe(42)
  })

  it('解绑使在途握手失效，重新加入需要新 epoch', async () => {
    const a = await PrivateChannel.create()
    const b = await PrivateChannel.create()
    const binding = a.bind('guest', b.publicKey)
    a.forget('guest')
    await expect(binding).rejects.toThrow()
    expect(a.has('guest')).toBe(false)
    await expect(a.bind('guest', b.publicKey)).rejects.toThrow()
    const next = await PrivateChannel.create()
    await a.bind('guest', next.publicKey)
    expect((await a.seal('guest', ctx, 1)).peerEpoch).toBe(next.publicKey.epoch)
  })

  it('后续公钥导入失败时，被取代的合法握手可以重新发起', async () => {
    const host = await PrivateChannel.create()
    const guest = await PrivateChannel.create()
    const valid = host.bind('guest', guest.publicKey)
    const invalid = host.bind('guest', {epoch: 'invalid', key: {kty: 'EC', crv: 'P-256'}})
    const results = await Promise.allSettled([valid, invalid])
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(host.has('guest')).toBe(false)
    await host.bind('guest', guest.publicKey)
    await guest.bind('host', host.publicKey)
    const packet = await host.seal('guest', ctx, 42)
    await expect(guest.open('host', ctx, packet)).resolves.toBe(42)
  })

  it.each(['解绑', '换钥'] as const)('握手失败后%s会退役先前在途的 epoch', async action => {
    const host = await PrivateChannel.create()
    const guest = await PrivateChannel.create()
    const attempts = await Promise.allSettled([
      host.bind('guest', guest.publicKey),
      host.bind('guest', {epoch: 'invalid', key: {kty: 'EC', crv: 'P-256'}}),
    ])
    expect(attempts.map(attempt => attempt.status)).toEqual(['rejected', 'rejected'])
    if (action === '解绑') {
      host.forget('guest')
    } else {
      const next = await PrivateChannel.create()
      await host.bind('guest', next.publicKey)
    }
    await expect(host.bind('guest', guest.publicKey)).rejects.toThrow('临时公钥已退役')
  })

  it('并发换钥仅提交最新握手，并保留旧 epoch 的退役记录', async () => {
    const {a,b} = await pair()
    const second = await PrivateChannel.create()
    const third = await PrivateChannel.create()
    const older = a.bind('guest', second.publicKey)
    const newer = a.bind('guest', third.publicKey)
    const results = await Promise.allSettled([older, newer])
    expect(results.map(r => r.status)).toEqual(['rejected', 'fulfilled'])
    expect((await a.seal('guest', ctx, 1)).peerEpoch).toBe(third.publicKey.epoch)
    for (const retired of [b, second]) await expect(a.bind('guest', retired.publicKey)).rejects.toThrow()
    a.forget('guest')
    await expect(a.bind('guest', third.publicKey)).rejects.toThrow()
  })
})
