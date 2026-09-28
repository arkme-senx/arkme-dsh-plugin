import {expect,it} from 'vitest'
import {createArkmeSdk} from '../src/sdk/index.js'
const ok=(value:unknown)=>new Response(JSON.stringify({ok:true,value}),{headers:{'content-type':'application/json'}})
it('discovers roles and routes SDK operations through account-bound Host contracts',async()=>{
 const calls:unknown[]=[];const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const req=JSON.parse(String(init?.body));calls.push(req);return ok(req.operation==='provider.capabilities'?{contractVersion:1,features:{selfRoles:true}}:{roleId:'r',name:'角色'})}})
 await sdk.listSelfRoles(42);await sdk.createSelfRole(42,'角色');await sdk.updateSelfRole(42,'r','新名');await sdk.deleteSelfRole(42,'r');await sdk.resolveSelfRoleConflict(42,'r');await sdk.bindSelfRole(42,'source','record','r')
 expect(calls).toContainEqual({operation:'self-roles.bind',params:{expectedUserId:42,sourceRef:'source',recordUid:'record',roleId:'r'}})
 const old=createArkmeSdk({fetchImpl:async()=>ok({contractVersion:1,features:{}})})
 await expect(old.listSelfRoles(42)).rejects.toThrow('不支持跨端角色')
})
