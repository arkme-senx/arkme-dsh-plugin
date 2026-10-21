import {useEffect, useRef, type ReactNode} from 'react'
import {forwardTargetStyles as styles} from './forward-target-styles.js'
import {ArkmeForwardSearch} from './ArkmeForwardSearch.js'
import {ArkmeRichText} from './ArkmeRichText.js'
import {ArkmeSelectActionIcon} from './message-selection-presentation.js'
import {tr} from './locale.js'

/** Shared presentation only. Destination authority, selection and retries stay
 * in each caller's existing forwarding owner. */
export function ArkmeForwardTargetDialog({fixed=false,keyword,busy,onClose,onKeywordChange,previewTitle,previewSubtitle,selectedAvatars,comment,commentFrozen=false,onCommentChange,error,onSubmit,children}:{fixed?:boolean;keyword:string;busy:boolean;onClose():void;onKeywordChange(value:string):void;previewTitle:string;previewSubtitle:string;selectedAvatars?:ReactNode;comment:string;commentFrozen?:boolean;onCommentChange(value:string):void;error:string;onSubmit():void;children:ReactNode}){
 const titleId='arkme-forward-target-title',dialog=useRef<HTMLElement>(null)
 const controls=()=>[...(dialog.current?.querySelectorAll<HTMLElement>('button, input, textarea, a[href], select, summary, [tabindex]')??[])]
  .filter(control=>control.tabIndex>=0&&!control.matches(':disabled')&&!control.closest('[hidden], [inert]')&&getComputedStyle(control).display!=='none'&&getComputedStyle(control).visibility!=='hidden')
 const focusDialog=()=>{(controls()[0]??dialog.current)?.focus({preventScroll:true})}
 useEffect(()=>{
  if(typeof document==='undefined'||!dialog.current)return
  const previous=typeof HTMLElement!=='undefined'&&document.activeElement instanceof HTMLElement?document.activeElement:undefined
  focusDialog()
  const contain=(event:FocusEvent)=>{if(event.target instanceof Node&&!dialog.current?.contains(event.target))focusDialog()}
  document.addEventListener('focusin',contain)
  return()=>{document.removeEventListener('focusin',contain);if(previous?.isConnected)previous.focus({preventScroll:true})}
 },[])
 useEffect(()=>{if(busy)dialog.current?.focus({preventScroll:true})},[busy])
 return <div data-arkme-notification-blocking-overlay="true" style={{...styles.forwardTargetBackdrop,...(fixed?{position:'fixed' as const,zIndex:10000}:{})}} role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
  <section ref={dialog} tabIndex={-1} style={styles.forwardTargetDialog} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)onClose();return}
    if(event.key!=='Tab')return
    const elements=controls(),first=elements[0],last=elements[elements.length-1]
    if(!first){event.preventDefault();dialog.current?.focus()}
    else if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus()}
   }}>
   <header style={styles.forwardTargetHeader}><span aria-hidden/><h3 id={titleId} style={styles.forwardTargetTitle}>{tr('转发给')}</h3><button data-arkme-feedback="neutral" type="button" style={styles.forwardTargetClose} disabled={busy} aria-label={tr('关闭转发对象选择')} onClick={onClose}>×</button></header>
   <div style={styles.forwardTargetSearchWrap}><ArkmeForwardSearch value={keyword} disabled={busy} onChange={event=>onKeywordChange(event.currentTarget.value)}/></div>
   <div style={styles.forwardTargetBody}>{children}</div>
   {selectedAvatars!==undefined&&<footer style={styles.forwardTargetFooter}>
    <div style={styles.forwardTargetRecipients}><span>{tr('发送给：')}</span><span style={styles.forwardTargetAvatarStack}>{selectedAvatars}</span></div>
    <div style={styles.forwardTargetFooterDivider}/>
    <div style={styles.forwardTargetPreview}><span style={styles.forwardTargetPreviewIcon}><ArkmeSelectActionIcon kind="forward" size={18}/></span><span style={styles.forwardTargetPreviewText}><span style={styles.forwardTargetPreviewTitle}><ArkmeRichText text={previewTitle} presentation="preview"/></span><span style={styles.forwardTargetPreviewSubtitle}><ArkmeRichText text={previewSubtitle} presentation="preview"/></span></span><button data-arkme-feedback="neutral" type="button" style={styles.forwardTargetPreviewClose} disabled={busy} aria-label={tr('关闭转发对象选择')} onClick={onClose}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="8" r="6.5" stroke="currentColor"/><path d="M6 6L10 10M10 6L6 10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg></button></div>
    {error&&<div role="alert" style={styles.forwardTargetSendError}>{error}</div>}
    <div style={styles.forwardTargetComposer}><textarea style={styles.forwardTargetCommentInput} value={comment} placeholder={tr('说点什么...')} aria-label={tr('转发附言')} disabled={busy||commentFrozen} onChange={event=>onCommentChange(event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();onSubmit()}}}/><button data-arkme-feedback="primary" type="button" style={{...styles.forwardTargetSend,...(busy?styles.forwardTargetSendDisabled:{})}} disabled={busy} aria-label={busy?tr('转发中'):tr('发送转发')} onClick={onSubmit}><ArkmeSelectActionIcon kind="forward" size={22}/></button></div>
   </footer>}
  </section>
 </div>
}
