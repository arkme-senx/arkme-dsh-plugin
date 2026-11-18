import {useEffect,useState} from 'react'
import type {TeamGroupParticipantsPage,TeamGroupParticipant} from '../team-group-contract.js'
import {subscribeTeamWorkspaceChanges} from './team-messaging-events.js'
import {callArkme} from './api.js'

const noTeams:TeamGroupParticipant[]=[]
export function useGroupTeamMentions(accountKey:string,sourceRef:string|undefined,enabled:boolean) {
  const scope=sourceRef&&accountKey?JSON.stringify([accountKey,sourceRef]):undefined
  const [state,setState]=useState<{scope:string;items:TeamGroupParticipant[];loading:boolean;error:boolean;unsupported?:boolean;canManage?:boolean;leaveAvailable?:boolean}>(),[attempt,retry]=useState(0)
  useEffect(()=>subscribeTeamWorkspaceChanges(account=>{if(account===accountKey&&enabled)retry(n=>n+1)}),[accountKey,enabled])
  useEffect(()=>{
    if(!sourceRef||!enabled||!scope)return
    const controller=new AbortController()
    setState(previous=>({scope,items:previous?.scope===scope?previous.items:[],loading:true,error:false}))
    void(async()=>{
      const items:TeamGroupParticipant[]=[],seen=new Set<string>()
      let cursor:string|undefined,canManage=true,leaveAvailable=true
      do {
        const page=await callArkme<TeamGroupParticipantsPage>('team.app.group.participants',{sourceRef,expectedAccountKey:accountKey,limit:100,...(cursor?{cursor}:{})},controller.signal)
        if(!Array.isArray(page.items)||page.hasMore&&(!page.nextCursor||seen.has(page.nextCursor)))throw new Error('团队候选分页未前进')
        items.push(...page.items)
        canManage&&=page.canManage===true;leaveAvailable&&=page.leaveAvailable===true
        cursor=page.hasMore?page.nextCursor:undefined
        if(cursor)seen.add(cursor)
      }while(cursor)
      if(!controller.signal.aborted)setState({scope,items,loading:false,error:false,canManage,leaveAvailable})
    })().catch(error=>{if(!controller.signal.aborted){const unsupported=(error as {body?:{code?:string}})?.body?.code==='team-group-backend-pending';setState({scope,items:[],loading:false,error:!unsupported,unsupported})}})
    return()=>controller.abort()
  },[accountKey,sourceRef,scope,enabled,attempt])
  const current=state?.scope===scope?state:undefined
  return {unavailable:current?.unsupported===true,canManage:current?.canManage===true,leaveAvailable:current?.leaveAvailable===true,ready:current!==undefined&&!current.loading&&!current.error&&!current.unsupported,items:current?.items??noTeams,loading:enabled&&scope!==undefined&&(current?.loading??true),error:current?.error===true,retry:()=>retry(n=>n+1)}
}
