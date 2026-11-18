import {it,expect,vi} from 'vitest'
import {GameService} from '../src/services/game-service.js'
import {ArkmePluginError} from '../src/services/service.js'
it('preserves a safe actionable registration failure across the host boundary', async()=>{
  const runtime={config:{webrtcBaseUrl:'https://test.invalid'},requireSession:async()=>({userId:1}),authenticatedWebrtcPost:async()=>({user_id:'u'})}
  const registration={waitUntilReady:vi.fn(async()=>{throw Error('internal detail')})}
  const service=new GameService(runtime as any,registration as any,{} as any)
  const error=await service.execute('ready',{registration_id:'u'},'1:https://test.invalid').catch(e=>e)
  expect(error).toBeInstanceOf(ArkmePluginError)
  expect(error.message).toBe('设备 IM 登记尚未完成，请重试')
  expect(error.message).not.toContain('internal detail')
})
