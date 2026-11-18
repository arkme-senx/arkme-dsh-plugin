// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest'
const mock=vi.hoisted(()=>({call:vi.fn(),auth:{status:'authenticated',userId:1,environment:'test'}}))
vi.mock('../src/client/api.js',()=>({callArkme:mock.call}))
vi.mock('../src/client/auth-store.js',()=>({arkmeAuthStore:{getSnapshot:()=>({auth:mock.auth})}}))
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.resetModules()})
it('single-flights repeated launches and only resolves after child accepts the command',async()=>{
 vi.useFakeTimers();mock.call.mockResolvedValue({path:'/arkme-self/api/game/index.html',account:'test:1'})
 vi.stubGlobal('BroadcastChannel',class{onmessage:any;postMessage(){}close(){}})
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n:string,fn:()=>Promise<void>)=>fn()}})
 const child:any={closed:false,focus:vi.fn(),close(){this.closed=true},postMessage:vi.fn(),location:{replace:vi.fn(()=>{queueMicrotask(()=>window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:child,data:{channel:'arkme.game.window.v1',id:'init',action:'init'}})))})}}
 const opened=vi.spyOn(window,'open').mockReturnValue(child)
 const {openGame}=await import('../src/client/game/window.js');const a=openGame({kind:'create'}),b=openGame({kind:'create'});await vi.advanceTimersByTimeAsync(200);await Promise.all([a,b]);expect(opened).toHaveBeenCalledTimes(1);expect(child.location.replace).toHaveBeenCalledTimes(1);expect(child.focus).toHaveBeenCalled();child.closed=true;await vi.advanceTimersByTimeAsync(1000)
})
it('does not open or reload a child when another conversation already owns a different room',async()=>{
 vi.useFakeTimers();mock.call.mockClear()
 vi.stubGlobal('BroadcastChannel',class{onmessage:any;postMessage(m:any){queueMicrotask(()=>this.onmessage?.({data:{kind:'found',id:m.id,roomId:'existing'}}))}close(){}})
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n:string,fn:()=>Promise<void>)=>fn()}})
 const opened=vi.spyOn(window,'open').mockReturnValue(null);const {openGame}=await import('../src/client/game/window.js');await expect(openGame({kind:'join',roomId:'another',token:'token'})).rejects.toThrow('退出');expect(opened).not.toHaveBeenCalled();expect(mock.call).not.toHaveBeenCalled()
})
