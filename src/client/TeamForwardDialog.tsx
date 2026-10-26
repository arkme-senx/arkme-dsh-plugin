import {useEffect,useRef,useState,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import type {ArkmeSourceItem,ArkmeSourceList} from '../types.js'
import type {TeamConversation,TeamSide} from '../team-app-contract.js'
import {createArkmeSdk} from '../sdk/index.js'
import {callArkme} from './api.js'
import {ArkmeForwardTargetDialog} from './ArkmeForwardTargetDialog.js'
import {forwardTargetStyles as styles} from './forward-target-styles.js'
import {ArkmeDirectorySourceAvatar,ArkmeUserAvatar} from './ArkmeAvatar.js'
import {ArkmeTeamChannelAvatar} from './ArkmeTeamAvatar.js'
import {teamAvatarImages} from './team-avatar-image-runtime.js'
import {ArkmePinnedCorner} from './ArkmePinnedCorner.js'
import {ArkmeRichText} from './ArkmeRichText.js'
import {arkmeSourceIdentityKey} from './source-identity.js'
import {arkmeSourceAllowsUserWrite} from '../topic-policy.js'
import {requireDirectMessageSendAllowed} from './direct-message-admission.js'
import {TeamForwardAttempt} from './team-forward-attempt.js'
import {teamText as tr} from './team-messaging-i18n.js'

type Choice={key:string;name:string;subtitle:string;avatar:ReactNode;source?:ArkmeSourceItem;team?:TeamConversation}
function nativeChoice(source:ArkmeSourceItem):Choice{return {key:source.kind==='send_to_self'||source.kind==='default_category'?'self':`${source.kind}:${arkmeSourceIdentityKey(source)}`,name:source.displayName,subtitle:source.latestPreview|| (source.kind==='group_chat'?'群聊':source.kind==='private_chat'?'私聊':source.kind==='topic'?'主题':'默认分类'),avatar:<ArkmeDirectorySourceAvatar source={source} size={38}/>,source}}
function teamChoice(value:TeamConversation):Choice{return {key:`team:${value.key}`,name:value.side==='team'?`${value.channel.name} · ${value.visitor?.nickname||'外部用户'}`:value.channel.name,subtitle:value.side==='team'?'团队接待':'我联系的团队',avatar:value.side==='team'&&value.visitor?<ArkmeUserAvatar avatarRef={value.visitor.imageRef} imageKey={value.visitor.imageKey} imagePort={teamAvatarImages} size={38} label={value.visitor.nickname}/>:<ArkmeTeamChannelAvatar channel={value.channel} size={38}/>,team:value}}

export function TeamForwardDialog({attempt,previewTitle,previewSubtitle,onClose,onComplete}:{attempt:TeamForwardAttempt;previewTitle:string;previewSubtitle:string;onClose():void;onComplete():void}){
 const [directory,setDirectory]=useState<'root'|'send_to_self'>('root')
 const [native,setNative]=useState<ArkmeSourceItem[]>([]),[teams,setTeams]=useState<TeamConversation[]>([])
 const [nativeCursor,setNativeCursor]=useState<string>(),[teamCursors,setTeamCursors]=useState<Partial<Record<TeamSide,string>>>({})
 const [selected,setSelected]=useState(new Map<string,Choice>()),[keyword,setKeyword]=useState(''),[comment,setComment]=useState(attempt.commentText??'')
 const [error,setError]=useState(''),[loading,setLoading]=useState(false),[sending,setSending]=useState(false),[results,setResults]=useState(new Map<string,string>())
 const alive=useRef(true),busy=useRef(false),controller=useRef(new AbortController()),directoryRequest=useRef<AbortController>()
 useEffect(()=>{alive.current=true;if(controller.current.signal.aborted)controller.current=new AbortController();return()=>{alive.current=false;controller.current.abort();directoryRequest.current?.abort()}},[])
 const loadNative=async(cursor?:string)=>{
  directoryRequest.current?.abort();const request=new AbortController();directoryRequest.current=request;setLoading(true);setError('')
  try{const page=await callArkme<ArkmeSourceList>('sources.list',{directory,limit:50,...(cursor?{cursor}:{})},request.signal)
   if(!alive.current||request.signal.aborted)return
   const rows=page.items.filter(source=>arkmeSourceAllowsUserWrite(source))
   setNative(previous=>[...new Map([...(cursor?previous:[]),...rows].map(source=>[nativeChoice(source).key,source])).values()])
   setSelected(previous=>{const next=new Map(previous);for(const source of rows){const value=nativeChoice(source);if(next.has(value.key))next.set(value.key,value)}return next})
   if(page.hasMore&&(!page.nextCursor||page.nextCursor===cursor))throw new Error(tr('目标列表分页暂不可用，请刷新后重试'))
   setNativeCursor(page.hasMore?page.nextCursor:undefined)
  }catch(reason){if(alive.current&&!request.signal.aborted)setError(reason instanceof Error?reason.message:tr('加载失败'))}
  finally{if(alive.current&&!request.signal.aborted)setLoading(false)}
 }
 const loadTeams=async(side:TeamSide,cursor?:string)=>{
  try{const page=await createArkmeSdk().listTeamConversations(side,{limit:50,...(cursor?{cursor}:{})},controller.current.signal)
   if(!alive.current||controller.current.signal.aborted)return
   setTeams(previous=>[...new Map([...previous,...page.items].map(value=>[value.key,value])).values()])
   setSelected(previous=>{const next=new Map(previous);for(const value of page.items){const choice=teamChoice(value);if(next.has(choice.key))next.set(choice.key,choice)}return next})
   if(page.hasMore&&(!page.nextCursor||page.nextCursor===cursor))throw new Error(tr('目标列表分页暂不可用，请刷新后重试'))
   setTeamCursors(previous=>({...previous,[side]:page.hasMore?page.nextCursor:undefined}))
  }catch(reason){if(alive.current&&!controller.current.signal.aborted)setError(reason instanceof Error?reason.message:tr('加载失败'))}
 }
 useEffect(()=>{setNative([]);setNativeCursor(undefined);void loadNative();return()=>directoryRequest.current?.abort()},[directory])
 useEffect(()=>{void Promise.allSettled([loadTeams('team'),loadTeams('external')])},[])
 const toggle=async(choice:Choice)=>{
  if(busy.current)return
  if(selected.has(choice.key)){setSelected(previous=>{const next=new Map(previous);next.delete(choice.key);return next});return}
  if(selected.size>=5){setError(tr('最多选择 5 个转发对象'));return}
  if(choice.source&&!attempt.hasAttempt(choice.key))try{await requireDirectMessageSendAllowed(choice.source,controller.current.signal)}catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:tr('发送失败'));return}
  if(!alive.current||busy.current)return
  if(choice.team&&(choice.team.blocked||!choice.team.channel.enabled)&&!attempt.hasAttempt(choice.key)){setError(tr('该团队对话暂时不能发送'));return}
  setSelected(previous=>{if(previous.size>=5)return previous;return new Map(previous).set(choice.key,choice)})
 }
 const send=async()=>{
  if(busy.current||!selected.size)return;busy.current=true;setSending(true);setError('')
  let complete=true
  try{for(const choice of selected.values()){
   if(controller.current.signal.aborted)return
   try{const receipt=await attempt.send(choice.key,choice.team?{kind:'team',conversationRef:choice.team.ref}:{kind:'source',sourceRef:choice.source!.sourceRef},comment,controller.current.signal)
    if(!alive.current)return
    setResults(previous=>new Map(previous).set(choice.key,receipt.warningText||tr('已转发')));if(receipt.warningText)complete=false
   }catch(reason){complete=false;if(alive.current)setResults(previous=>new Map(previous).set(choice.key,reason instanceof Error?reason.message:tr('转发结果尚未确认，请使用原请求重试')))}
  }
  if(complete&&alive.current)onComplete()
  }finally{busy.current=false;if(alive.current)setSending(false)}
 }
 const choices=[...native.map(nativeChoice),...(directory==='root'?teams.map(teamChoice):[])].filter(choice=>!keyword.trim()||`${choice.name} ${choice.subtitle}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))
 return createPortal(<ArkmeForwardTargetDialog fixed keyword={keyword} busy={sending} onClose={onClose} onKeywordChange={setKeyword} previewTitle={previewTitle} previewSubtitle={previewSubtitle} selectedAvatars={selected.size?<>{[...selected.values()].map(choice=><span key={choice.key} style={{display:'inline-flex',width:26,height:26,overflow:'hidden'}}>{choice.avatar}</span>)}</>:undefined} comment={attempt.commentText??comment} commentFrozen={attempt.commentText!==undefined} onCommentChange={setComment} error={error} onSubmit={()=>{void send()}}>
  {directory==='send_to_self'&&<button type="button" disabled={sending} onClick={()=>setDirectory('root')}>{tr('返回转发对象')}</button>}
  <ul style={styles.forwardTargetList} aria-label={tr('转发对象列表')}>
   {choices.map(choice=><li key={choice.key}><div style={{display:'flex',alignItems:'center'}}><button data-arkme-feedback="neutral" type="button" style={{...styles.forwardTargetRow,...(selected.has(choice.key)?styles.forwardTargetRowSelected:{})}} disabled={sending} aria-pressed={selected.has(choice.key)} onClick={()=>{void toggle(choice)}}>
    {choice.source?.isPinned&&<ArkmePinnedCorner/>}<span style={{...styles.forwardTargetCheck,...(selected.has(choice.key)?styles.forwardTargetCheckSelected:{})}} aria-hidden>✓</span>{choice.avatar}<span style={styles.forwardTargetText}><span style={styles.forwardTargetName}><ArkmeRichText text={choice.name} presentation="preview"/></span><span style={styles.forwardTargetMeta}><ArkmeRichText text={results.get(choice.key)||choice.subtitle} presentation="preview"/></span></span>
   </button>{directory==='root'&&choice.source?.kind==='send_to_self'&&<button type="button" disabled={sending} aria-label={tr('选择本人主题')} onClick={()=>setDirectory('send_to_self')}>›</button>}</div></li>)}
   {!choices.length&&<li role="status" style={styles.forwardTargetStatus}>{tr(loading?'正在加载转发对象...':'暂无可转发对象')}</li>}
   {nativeCursor&&<li><button type="button" disabled={loading||sending} onClick={()=>{void loadNative(nativeCursor)}}>{tr('更多')}</button></li>}
   {directory==='root'&&(['team','external'] as const).map(side=>teamCursors[side]&&<li key={side}><button type="button" disabled={sending} onClick={()=>{void loadTeams(side,teamCursors[side])}}>{tr(side==='team'?'更多团队接待对话':'更多我联系的团队')}</button></li>)}
  </ul>
  {error&&!selected.size&&<div role="alert" style={styles.forwardTargetStatus}>{error}<button type="button" disabled={loading||sending} onClick={()=>{void loadNative();if(directory==='root')void Promise.allSettled([loadTeams('team'),loadTeams('external')])}}>{tr('重试')}</button></div>}
 </ArkmeForwardTargetDialog>,document.body)
}
