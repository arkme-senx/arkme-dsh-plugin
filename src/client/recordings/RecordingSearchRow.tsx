import type { ArkmeRecordingSearchItem } from '../../types.js'
import { ArkmeUserAvatar } from '../ArkmeAvatar.js'
import { arkmeTheme } from '../arkme-theme.js'
import { arkmeUi } from '../ui-controller.js'
import { recordingSpeakerColor } from './recording-speaker-presentation.js'
import { RecordingTranscriptText } from './RecordingTranscriptText.js'
import { tr } from '../locale.js'

export function RecordingSearchRow({ item }: {item: ArkmeRecordingSearchItem}) {
  return <button type="button" data-arkme-feedback="neutral" onClick={() => arkmeUi.showRecordingTarget(item.dateStamp, item.startAtMillis, item.match)}
    style={{display:'block',width:'100%',textAlign:'left',border:0,borderBottom:`1px solid ${arkmeTheme.border}`,background:'transparent',padding:'12px 16px',cursor:'pointer',font:'inherit'}}>
    <time data-recording-search-group-time="true" style={{display:'block',marginBottom:4,fontSize:12,color:arkmeTheme.secondary}}>{tr('录音')} · {new Date(item.startAtMillis).toLocaleString()}</time>
    {[item.previous, item.match, item.next].map((segment, index) => segment && <span key={index} data-recording-search-segment={segment === item.match ? 'match' : 'context'}
      style={{display:'grid',gridTemplateColumns:'minmax(0,min(104px,32%)) minmax(0,1fr)',gap:8,padding:'3px 0',color:segment === item.match ? arkmeTheme.text : arkmeTheme.secondary}}>
      <span style={{display:'flex',alignItems:'flex-start',gap:6,fontSize:12}}>
        {segment.speaker?.avatarRef === undefined
          ? <span aria-hidden="true" style={{width:10,height:10,borderRadius:'50%',marginTop:3,flex:'none',background:recordingSpeakerColor(segment.speaker?.colorIndex ?? -1)}} />
          : <ArkmeUserAvatar avatarRef={segment.speaker.avatarRef} size={16} label={`${segment.speaker.label}头像`} />}
        <span>{segment.speaker?.label || tr('未知说话人')}</span>
      </span>
      <span style={{minWidth:0,lineHeight:1.5,...(segment === item.match ? {whiteSpace:'pre-wrap',overflowWrap:'anywhere'} as const : {whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'} as const)}}>
        {segment === item.match ? <RecordingTranscriptText text={segment.text} matches={item.highlightRanges.map((range,index) => ({...range,index,itemId:''}))} activeIndex={-1} /> : segment.text}
      </span>
    </span>)}
  </button>
}
