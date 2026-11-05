import React,{useEffect,useState,useSyncExternalStore} from 'react'
import {createRoot} from 'react-dom/client'
import {ArkmeArkoSurface} from '../../../src/client/ArkmeArkoSurface.js'
import {ArkmeTimelineDetailDrawer} from '../../../src/client/ArkmeNoteDetails.js'
import {RecordThoughtsProvider} from '../../../src/client/RecordThoughts.js'
import {arkmeAuthStore} from '../../../src/client/auth-store.js'
import {arkmeUi} from '../../../src/client/ui-controller.js'
import {arkmeSourceIdentityKey} from '../../../src/client/source-identity.js'
import {publishThoughtInvalidation} from '../../../src/client/thought-invalidations.js'
import {arkmeComposerDraftStore,arkmeSourceComposerDraftKey} from '../../../src/client/composer-draft-store.js'
import {callArkme} from '../../../src/client/api.js'
import type {ArkmeTimelineAroundPage,ArkmeTimelineItem} from '../../../src/types.js'
const globals=window as unknown as Record<string,unknown>
arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:11})
globals.hpkRecheck=()=>publishThoughtInvalidation({accountScope:'test:11'})
globals.hpkDraft=()=>{const source=arkmeUi.getSnapshot().selectedSource;return source?arkmeComposerDraftStore.get(arkmeSourceComposerDraftKey(11,source)).text:''}
function App(){
 const ui=useSyncExternalStore(arkmeUi.subscribe,arkmeUi.getSnapshot,arkmeUi.getSnapshot)
 const [detail,setDetail]=useState<{key:number;item:ArkmeTimelineItem}>(),[error,setError]=useState('')
 useEffect(()=>{
  const source=ui.selectedSource,target=ui.conversationTarget
  if(!source||!target){setDetail(undefined);return}
  const controller=new AbortController();setError('')
  const read = ['private_chat','group_chat'].includes(source.kind)
   ? callArkme<ArkmeTimelineAroundPage>('source.timeline-around',{sourceRef:source.sourceRef,itemUid:target.itemUid,recordOwnerUserId:target.recordOwnerUserId},controller.signal).then(page=>page.items)
   : callArkme<ArkmeTimelineAroundPage>('source.timeline',{sourceRef:source.sourceRef,limit:30},controller.signal).then(page=>page.items)
  void read.then(items=>{
   const item=items.find(item=>item.itemUid===target.itemUid&&String(item.recordOwnerUserId??11)===String(target.recordOwnerUserId))
   if(!item)throw new Error('Actual source window did not contain the requested owner/root')
   if(!controller.signal.aborted){setDetail({key:target.revision,item});globals.hpkActualSourceItem={sourceRef:source.sourceRef,messageActionRef:item.messageActionRef}}
  }).catch(error=>{if(!controller.signal.aborted)setError(String(error))})
  return()=>controller.abort()
 },[ui.selectedSource,ui.conversationTarget])
 return <main style={{fontFamily:'system-ui',height:'95vh'}}><ArkmeArkoSurface/>{error&&<p data-chain-error>{error}</p>}
 {detail&&ui.selectedSource&&<RecordThoughtsProvider accountScope="test:11" enabled sourceRef={ui.selectedSource.sourceRef} sourceKey={arkmeSourceIdentityKey(ui.selectedSource)} source={ui.selectedSource} chat={['private_chat','group_chat'].includes(ui.selectedSource.kind)}>
 <ArkmeTimelineDetailDrawer key={detail.key} item={detail.item} sourceRef={ui.selectedSource.sourceRef} sourceIdentityKey={arkmeSourceIdentityKey(ui.selectedSource)} sourceKind={ui.selectedSource.kind} showOriginal={false} onClose={()=>arkmeUi.showArko()} onToggleOriginal={()=>{}}/>
 </RecordThoughtsProvider>}
 </main>
}
createRoot(document.getElementById('root')!).render(<App/> )
