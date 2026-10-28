import { describe, expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { createArkmeCoreToolDefinitions, arkmeToolCatalog, type ArkmeCoreToolPorts } from '../src/tools/index.js'

const success = (value: unknown) => new Response(JSON.stringify({ok:true,value}), {headers:{'content-type':'application/json'}})

describe('speaker presence public contracts', () => {
  it('SDK discovers capability and uses the same Host routes with cancellation', async () => {
    const calls: Array<{operation:string;params?:unknown}> = []
    const controller = new AbortController()
    const sdk = createArkmeSdk({fetchImpl: async (_url,init) => {
      init?.signal?.throwIfAborted()
      const call = JSON.parse(String(init?.body)); calls.push(call)
      if (call.operation === 'provider.capabilities') return success({contractVersion:1,features:{speakerPresence:true}})
      expect(init?.signal).toBe(controller.signal)
      return success({state:'fresh',scope:'all-history',version:'v1',items:[]})
    }})
    await sdk.recordingSpeakerCandidates(controller.signal)
    await sdk.recordingSpeakerPresence(controller.signal)
    await sdk.recordingSpeakerMembers('opaque', {expectedVersion:'v1',signal:controller.signal})
    expect(calls.filter(c=>c.operation!=='provider.capabilities')).toEqual([
      {operation:'recordings.speaker.options',params:{}},
      {operation:'recordings.speaker.presence',params:{}},
      {operation:'recordings.speaker.members',params:{speakerRef:'opaque',expectedVersion:'v1'}},
    ])
    const unsupported=createArkmeSdk({fetchImpl:async()=>success({contractVersion:1,features:{}})})
    await expect(unsupported.recordingSpeakerPresence()).rejects.toThrow('不支持')
    controller.abort()
    await expect(sdk.recordingSpeakerPresence(controller.signal)).rejects.toThrow()
  })

  it('registers a read Tool and projects only safe fields from the shared Host owner', async () => {
    const ports = {
      recordingSpeakerOptions:vi.fn(async()=>[{kind:'speaker',speakerRef:'opaque',optionKey:'option',label:'甲',internalToken:'secret'}]),
      recordingSpeakerPresence:vi.fn(async()=>({state:'fresh',version:'v1',items:[{optionKey:'option',dayCount:2,lastSeenAt:5,internalID:'secret'}]})),
      recordingSpeakerMembers:vi.fn(async()=>({state:'fresh',scope:'all-history',dayCount:2,lastSeenAt:5,items:[{identityKey:'opaque-original',token:'12',dayCount:2,lastSeenAt:5}],internalID:'secret'})),
    }
    const tool=createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts).find(t=>t.name==='arkme_speaker_presence')!
    expect(tool).toBeDefined()
    expect(arkmeToolCatalog.modulesFor('business','core').find(m=>m.meta.toolName===tool.name)?.meta.effect).toBe('read')
    const exec={signal:new AbortController().signal} as never
    expect(String(await tool.execute({action:'list'},exec))).not.toContain('secret')
    expect(String(await tool.execute({action:'detail',speaker_ref:'opaque',expected_version:'v1'},exec))).toContain('opaque-original')
    expect(ports.recordingSpeakerMembers).toHaveBeenCalledWith('opaque',expect.any(AbortSignal),'v1')
    await expect(tool.execute({action:'detail'},exec)).rejects.toThrow()
    await expect(tool.execute({action:'list',speaker_ref:'other'},exec)).rejects.toThrow()
  })
})
