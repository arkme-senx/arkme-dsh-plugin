import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

const list = defineArkmeCoreToolModule({
 meta:{id:'business.records.self-roles-list.v1',toolName:'arkme_self_roles_list',kind:'business',phase:'core',effect:'read',profiles:['business','hybrid']},
 create:ports=>defineTool({name:'arkme_self_roles_list',description:'List private display roles and their sync status for the current account. Roles never change the real author or permissions.',parameters:{expected_user_id:{type:'integer',required:true,description:'Current account user ID from the account profile.'}},output:TEXT_OUTPUT,isConcurrencySafe:()=>true,
 execute:async args=>taggedJSON('发言角色',await ports.listSelfRoles(args.expected_user_id))}),
})
const write = defineArkmeCoreToolModule({
 meta:{id:'business.records.self-roles-write.v1',toolName:'arkme_self_roles_write',kind:'business',phase:'core',effect:'write',grant:'explicit-user-write',profiles:['business','hybrid']},
 create:ports=>defineTool({name:'arkme_self_roles_write',description:'Only on explicit user request, create, update or delete a private display role, or accept its cloud value after a sync conflict. Writes persist locally while offline. Avatar references must come from the current account file upload tools; never use URLs. Deletion preserves historical message presentation.',parameters:{expected_user_id:{type:'integer',required:true,description:'Current account user ID.'},action:{type:'string',required:true,enum:['create','update','delete','accept_remote'],description:'Requested operation.'},role_id:{type:'string',description:'Existing role ID, required except create.'},name:{type:'string',description:'1–20 character role name for create/update.'},avatar_ref:{type:'string',description:'Current account file_asset:// reference; empty clears avatar.'}},output:TEXT_OUTPUT,
 execute:async args=>{
  const uid=args.expected_user_id
  if(args.action==='create')return taggedJSON('角色已保存',await ports.createSelfRole(uid,args.name??'',args.avatar_ref))
  if(args.action==='update')return taggedJSON('角色已保存',await ports.updateSelfRole(uid,args.role_id??'',args.name??'',args.avatar_ref))
  if(args.action==='delete')return taggedJSON('角色已删除',await ports.deleteSelfRole(uid,args.role_id??''))
  return taggedJSON('角色冲突已处理',await ports.resolveSelfRoleConflict(uid,args.role_id??''))
 }}),
})
export const selfRoleToolModules=[list,write] as const
