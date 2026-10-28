import { useEffect, useState, useRef } from 'react'
import type { TeamMessage } from '../team-app-contract.js'
import type { TeamMessageSnapshot } from '../team-snapshot-contract.js'
import { callArkme } from './api.js'

export function useTeamMessageSnapshot(accountKey: string, conversationRef: string, message: TeamMessage | undefined, unavailable: () => void) {
  const [state,setState]=useState<{identity?:string;value?:TeamMessageSnapshot;loading:boolean;error?:string}>({loading:false})
  const [attempt,retry]=useState(0)
  const identity=message?JSON.stringify([accountKey,conversationRef,message.key,message.version]):''
  const latest=useRef(identity);latest.current=identity
  useEffect(()=>{
    if(!message){setState({loading:false});return}
    let request:AbortController|undefined,disposed=false,generation=0
    const run=()=>{
      request?.abort();const controller=new AbortController();request=controller;const current=++generation
      setState({identity,loading:true})
      void callArkme<TeamMessageSnapshot>('team.app.snapshot.read',{conversationRef,messageRef:message.ref,expectedAccountKey:accountKey},controller.signal).then(value=>{
        if(value?.schemaVersion!==1||!value.detail)throw new Error('记忆快照响应无效，请重试')
        if(!disposed&&!controller.signal.aborted&&generation===current)setState({identity,value,loading:false})
      }).catch(error=>{
        if(disposed||controller.signal.aborted||generation!==current)return
        const code=(error as {body?:{code?:string}})?.body?.code
        if(latest.current!==identity)return
        if(code==='team-not_accessible'||code==='team-account-changed'){setState({loading:false});unavailable();return}
        setState({identity,loading:false,error:error instanceof Error?error.message:'记忆快照读取失败，请重试'})
      })
    }
    const hide=()=>{request?.abort();++generation;setState({loading:false})}
    const visibility=()=>document.visibilityState==='hidden'?hide():run()
    const offline=()=>{hide();unavailable()}
    run();window.addEventListener('focus',run);window.addEventListener('online',run);window.addEventListener('offline',offline);document.addEventListener('visibilitychange',visibility)
    return()=>{disposed=true;request?.abort();window.removeEventListener('focus',run);window.removeEventListener('online',run);window.removeEventListener('offline',offline);document.removeEventListener('visibilitychange',visibility)}
  },[accountKey,conversationRef,message?.key,message?.version,attempt,unavailable])
  return {...(state.identity===identity?state:{loading:!!message}),retry:()=>retry(value=>value+1)}
}
