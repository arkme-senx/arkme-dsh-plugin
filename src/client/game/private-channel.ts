/** Ephemeral per-membership encryption. Callers must authenticate keys using IM's real sender. */
export interface PrivateContext {
  room: string
  runtime: string
  member: string
  round: string
  version: number
}
export interface PublicKey { epoch: string; key: JsonWebKey }
export interface SealedView extends PrivateContext {
  epoch: string
  peerEpoch: string
  nonce: string
  ciphertext: string
}
const utf8 = new TextEncoder()
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
function bytes(value: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > 6000) throw Error('无效加密消息')
  return Uint8Array.from(atob(value), c => c.charCodeAt(0))
}
function context(value: PrivateContext) {
  return [value.room, value.runtime, value.member, value.round, value.version]
}
function valid(value: PrivateContext) {
  return [value.room,value.runtime,value.member,value.round].every(x=>typeof x==='string' && x.length>0 && x.length<=160) && Number.isSafeInteger(value.version) && value.version>0
}
export class PrivateChannel {
  private constructor(private pair: CryptoKeyPair, readonly publicKey: PublicKey) {}
  private peers = new Map<string, { epoch: string; key: CryptoKey; received: Set<string>; sent: Set<string> }>()
  private pending = new Map<string, { epoch: string; ready: Promise<void> }>()
  private attempted = new Map<string, Set<string>>()
  // Retain tombstones for the lifetime of this local ECDH key pair, including across forget().
  private retired = new Map<string, Set<string>>()
  private retire(member: string, epoch?: string) {
    if (!epoch) return
    const epochs = this.retired.get(member) ?? new Set<string>()
    epochs.add(epoch)
    this.retired.set(member, epochs)
  }
  private retireAttempts(member: string, keep?: string) {
    const attempts = this.attempted.get(member)
    if (!attempts) return
    for (const epoch of attempts) {
      if (epoch !== keep) this.retire(member, epoch)
    }
    this.attempted.delete(member)
  }
  static async create(): Promise<PrivateChannel> {
    const pair = await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, false, ['deriveKey'])
    return new PrivateChannel(pair, {epoch:crypto.randomUUID(),key:await crypto.subtle.exportKey('jwk',pair.publicKey)})
  }
  has(member: string) { return this.peers.has(member) }
  isBound(member: string, epoch: string) {
    const pending = this.pending.get(member)
    return this.peers.get(member)?.epoch === epoch && (!pending || pending.epoch === epoch)
  }
  forget(member: string) {
    this.retire(member, this.peers.get(member)?.epoch)
    this.retireAttempts(member)
    this.pending.delete(member)
    this.peers.delete(member)
  }
  async bind(member: string, value: PublicKey): Promise<void> {
    if (!member || !value || typeof value.epoch!=='string' || value.epoch.length>80 || !value.epoch || value.key?.kty!=='EC' || value.key.crv!=='P-256' || value.key.d) throw Error('无效临时公钥')
    const epoch = value.epoch
    if (this.retired.get(member)?.has(epoch)) throw Error('临时公钥已退役')
    if (this.peers.get(member)?.epoch === epoch) return
    const previous = this.pending.get(member)
    if (previous?.epoch === epoch) return previous.ready
    const attempts = this.attempted.get(member) ?? new Set<string>()
    attempts.add(epoch)
    this.attempted.set(member, attempts)
    const derive = async () => {
      const publicKey = await crypto.subtle.importKey('jwk',value.key,{name:'ECDH',namedCurve:'P-256'},false,[])
      const key = await crypto.subtle.deriveKey({name:'ECDH',public:publicKey},this.pair.privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
      if (this.pending.get(member) !== operation) throw Error('临时公钥绑定已过期')
      this.retireAttempts(member, epoch)
      this.retire(member, this.peers.get(member)?.epoch)
      this.peers.set(member,{epoch,key,received:new Set(),sent:new Set()})
    }
    const operation = { epoch, ready: derive() }
    this.pending.set(member, operation)
    try {
      await operation.ready
    } finally {
      if (this.pending.get(member) === operation) this.pending.delete(member)
    }
  }
  async seal(peer: string, value: PrivateContext, payload: unknown): Promise<SealedView> {
    const connection=this.peers.get(peer)
    if (!connection || !valid(value)) throw Error('手牌密钥尚未就绪')
    let nonce: string
    do { nonce=base64(crypto.getRandomValues(new Uint8Array(12))) } while(connection.sent.has(nonce))
    connection.sent.add(nonce)
    const packet = {...value,epoch:this.publicKey.epoch,peerEpoch:connection.epoch,nonce}
    const data=utf8.encode(JSON.stringify(payload))
    if(data.length>2300) throw Error('私有视图超过大小限制')
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:bytes(nonce),additionalData:utf8.encode(JSON.stringify([...context(value),packet.epoch,packet.peerEpoch]))},connection.key,data)
    return {...packet,ciphertext:base64(new Uint8Array(ciphertext))}
  }
  async open(peer: string, expected: PrivateContext, packet: SealedView): Promise<unknown> {
    const connection=this.peers.get(peer)
    if(!connection || !valid(expected) || !packet || JSON.stringify(context(packet))!==JSON.stringify(context(expected)) || packet.epoch!==connection.epoch || packet.peerEpoch!==this.publicKey.epoch) throw Error('私有视图身份或版本无效')
    const iv=bytes(packet.nonce)
    if(iv.length!==12 || base64(iv)!==packet.nonce || connection.received.has(packet.nonce)) throw Error('无效加密消息')
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:utf8.encode(JSON.stringify([...context(packet),packet.epoch,packet.peerEpoch]))},connection.key,bytes(packet.ciphertext))
    // Re-check after asynchronous decrypt to reject concurrent duplicates/rekey races.
    if(this.peers.get(peer)!==connection || connection.received.has(packet.nonce)) throw Error('私有视图已过期')
    const result=JSON.parse(new TextDecoder().decode(clear))
    connection.received.add(packet.nonce)
    return result
  }
}
