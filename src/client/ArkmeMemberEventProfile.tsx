import { useEffect, useRef, useState } from 'react'
import type { ArkmeMemberEvent, ArkmeMemberEventProfile, ArkmeOpenPrivateChatResult } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeMemberProfileCard } from './ArkmeChatMemberActions.js'
import { memberEventsUnavailable } from './member-event-timeline.js'

export function ArkmeMemberEventProfileDialog(props: {
  sourceRef:string
  event:ArkmeMemberEvent
  onClose:()=>void
  onUnavailable:()=>void
  onOpen:(result:ArkmeOpenPrivateChatResult)=>void
  onError:(message:string)=>void
}) {
  const [profile,setProfile]=useState<ArkmeMemberEventProfile>({displayName:props.event.displayName})
  const [busy,setBusy]=useState(true)
  const request=useRef<AbortController>()
  useEffect(() => {
    const controller=new AbortController()
    request.current=controller
    void callArkme<ArkmeMemberEventProfile>('source.member-event.profile',{sourceRef:props.sourceRef,eventId:props.event.eventId},controller.signal)
      .then(value => { if (!controller.signal.aborted) setProfile(value) })
      .catch(error => {
        if (controller.signal.aborted) return
        if (memberEventsUnavailable(error)) { props.onUnavailable(); props.onClose() }
        else props.onError(error instanceof Error ? error.message : '读取用户资料失败')
      }).finally(() => { if (!controller.signal.aborted) { request.current=undefined; setBusy(false) } })
    return () => { controller.abort(); request.current?.abort() }
  }, [props.sourceRef,props.event.eventId])
  const send=() => {
    if (busy || request.current !== undefined) return
    const controller=new AbortController()
    request.current=controller; setBusy(true)
    void callArkme<ArkmeOpenPrivateChatResult>('source.member-event.private.open',{sourceRef:props.sourceRef,eventId:props.event.eventId},controller.signal)
      .then(result => { if (!controller.signal.aborted) props.onOpen(result) })
      .catch(error => {
        if (controller.signal.aborted) return
        if (memberEventsUnavailable(error)) { props.onUnavailable(); props.onClose() }
        else props.onError(error instanceof Error ? error.message : '发送消息失败')
      }).finally(() => { if (!controller.signal.aborted) { request.current=undefined; setBusy(false) } })
  }
  return <ArkmeMemberProfileCard member={profile} showTopicNickname busy={busy} onClose={props.onClose} onSend={send}/>
}
