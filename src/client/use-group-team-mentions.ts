import {useEffect,useState} from 'react'
import type {TeamGroupParticipantsPage,TeamGroupParticipant} from '../team-group-contract.js'
import {subscribeTeamWorkspaceChanges} from './team-messaging-events.js'
import {callArkme} from './api.js'

const noTeams:TeamGroupParticipant[]=[]
export function useGroupTeamMentions(accountKey:string,sourceRef:string|undefined,enabled:boolean) {
  const [state,setState]=useState<{source?:string;items:TeamGroupParticipant[];loading:boolean;error:boolean;canManage?:boolean;leaveAvailable?:boolean}>({items:[],loading:false,error:false}),[attempt,retry]=useState(0)
  useEffect(()=>subscribeTeamWorkspaceChanges(account=>{if(account===accountKey&&enabled)retry(n=>n+1)}),[accountKey,enabled])
  useEffect(()=>{
    if(!sourceRef||!enabled||!accountKey)return
    const controller=new AbortController()
    setState({source:sourceRef,items:[],loading:true,error:false})
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
      if(!controller.signal.aborted)setState({source:sourceRef,items,loading:false,error:false,canManage,leaveAvailable})
    })().catch(()=>{if(!controller.signal.aborted)setState({source:sourceRef,items:[],loading:false,error:true})})
    return()=>controller.abort()
  },[accountKey,sourceRef,enabled,attempt])
  return {canManage:state.source===sourceRef&&state.canManage===true,leaveAvailable:state.source===sourceRef&&state.leaveAvailable===true,ready:!!sourceRef&&state.source===sourceRef&&!state.loading&&!state.error,items:state.source===sourceRef?state.items:noTeams,loading:state.source===sourceRef&&state.loading,error:state.source===sourceRef&&state.error,retry:()=>retry(n=>n+1)}
}
