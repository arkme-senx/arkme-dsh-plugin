import type { Mock } from 'vitest'
// Models the Host persistence seam; UI tests exercise remounts without giving
// the browser an authoritative recovery store.
const installations=new WeakMap<object,{implementation:Function,pending:Map<string,any>}>()
export function installArkoPendingHostMock(mock:Mock):void {
 const current=mock.getMockImplementation()
 if (!current || installations.get(mock)?.implementation===current) return
 const pending=new Map<string,any>()
 const implementation=async(method:string,input?:Record<string,any>,...rest:unknown[])=>{
  if(method==='arko.pending.read')return [...pending.values()].filter(turn=>input?.expectedUserId===undefined || turn.userId===input.expectedUserId)
  if(method==='arko.pending.prepare'){pending.set(input!.turn.clientTurnUid,structuredClone(input!.turn));return {saved:true}}
  if(method==='arko.pending.acknowledge'){pending.delete(String(input?.clientTurnUid));return {saved:true}}
  const result=await current(method,input,...rest)
  if(method==='arko.ask')pending.delete(String(input?.clientTurnUid))
  return result
 }
 installations.set(mock,{implementation,pending});mock.mockImplementation(implementation)
}
