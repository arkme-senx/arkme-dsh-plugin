import { createArkmeSdk, type ArkmeSelfRole } from '@senguoyun/dsh-arkme/sdk'
function assert(value: unknown): asserts value { if (!value) throw new Error('Consumer assertion failed') }
assert.equal = (actual: unknown, expected: unknown) => assert(actual === expected)
assert.rejects = async (operation: Promise<unknown>, pattern: RegExp) => {
  try { await operation } catch (error) { assert(pattern.test(String(error))); return }
  throw new Error('Expected unsupported capability rejection')
}
const calls:Array<{operation:string;params:Record<string,unknown>}>=[]
const role:ArkmeSelfRole={roleId:'role-1',name:'Consumer 角色',createdAtMillis:1,updatedAtMillis:1}
const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{
 const request=JSON.parse(String(init?.body));calls.push(request)
 return new Response(JSON.stringify({ok:true,value:request.operation==='provider.capabilities'?{contractVersion:1,features:{selfRoles:true}}:request.operation==='self-roles.list'?[role]:role}),{headers:{'content-type':'application/json'}})
}})
assert.equal((await sdk.listSelfRoles(7))[0]?.roleId,'role-1')
await sdk.createSelfRole(7,'Consumer 角色')
await sdk.updateSelfRole(7,'role-1','新名字','')
await sdk.bindSelfRole(7,'opaque-source','record-1','role-1')

await sdk.deleteSelfRole(7,'role-1')
assert(calls.filter(r=>r.operation.startsWith('self-roles.')).every(r=>r.params.expectedUserId===7))
const old=createArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}),{headers:{'content-type':'application/json'}})})
await assert.rejects(old.listSelfRoles(7),/不支持跨端角色/)
console.log('External public SDK role consumer: passed')
