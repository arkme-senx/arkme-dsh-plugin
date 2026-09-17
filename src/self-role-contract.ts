import type { ArkmeSelfRole, ArkmeSelfRoleSnapshot, ArkmeSourceItem } from './types.js'
/** All adapters use the Host owner; expectedUserId rejects account switches. */
export interface ArkmeSelfRolePort {
 selfTarget(signal?:AbortSignal):Promise<ArkmeSourceItem>
 listSelfRoles(expectedUserId:number):Promise<ArkmeSelfRole[]>
 createSelfRole(expectedUserId:number,name:string,avatarRef?:string):Promise<ArkmeSelfRole>
 updateSelfRole(expectedUserId:number,roleId:string,name:string|undefined,avatarRef?:string):Promise<ArkmeSelfRole>
 deleteSelfRole(expectedUserId:number,roleId:string):Promise<{ok:true}>
 bindSelfRole(expectedUserId:number,sourceRef:string,recordUid:string,roleId:string):Promise<ArkmeSelfRoleSnapshot>
}
