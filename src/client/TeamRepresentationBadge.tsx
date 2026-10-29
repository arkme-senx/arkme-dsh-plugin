import {useState} from 'react'
import {Users} from '@phosphor-icons/react/dist/icons/Users'
import type {TeamRepresentationSnapshot} from '../team-group-contract.js'
import {arkmeAuthStore} from './auth-store.js'
import {TeamPublicCardDialog} from './TeamPublicCardDialog.js'
import {arkmeTheme} from './arkme-theme.js'
export function TeamRepresentationBadge({value,compact=false}:{value:Pick<TeamRepresentationSnapshot,'name'|'jotmoId'>;compact?:boolean}){
 const[open,setOpen]=useState(false),auth=arkmeAuthStore.getSnapshot().auth,accountKey=auth?.status==='authenticated'?`${auth.environment}:${auth.userId}`:undefined
 return <><button type="button" title={`代表${value.name}发言；查看团队资料`} aria-label={`查看${value.name}团队资料`} onClick={event=>{event.stopPropagation();if(accountKey)setOpen(true)}}
  style={compact?{position:'absolute',right:-3,bottom:0,border:`2px solid ${arkmeTheme.base}`,borderRadius:'50%',width:18,height:18,display:'grid',placeItems:'center',padding:0,color:arkmeTheme.accent,background:arkmeTheme.accentSoft,cursor:'pointer'}:{border:0,background:'transparent',color:arkmeTheme.accent,cursor:'pointer',fontSize:11,padding:'0 4px'}}><Users size={compact?10:12} weight="fill"/>{!compact&&value.name}</button>
  {open&&accountKey&&<TeamPublicCardDialog accountKey={accountKey} jotmoId={value.jotmoId} onClose={()=>setOpen(false)}/>}</>
}
