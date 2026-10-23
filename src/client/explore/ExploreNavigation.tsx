import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ChartBar } from '@phosphor-icons/react/dist/icons/ChartBar'
import { ArkmeLocationDialog } from '../ArkmeLocationDialog.js'
import { MapPin } from '@phosphor-icons/react/dist/icons/MapPin'
import { Compass } from '@phosphor-icons/react/dist/icons/Compass'
import { IdentificationCard } from '@phosphor-icons/react/dist/icons/IdentificationCard'
import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree'
import { Flag } from '@phosphor-icons/react/dist/icons/Flag'
import { Target } from '@phosphor-icons/react/dist/icons/Target'
import { Gift } from '@phosphor-icons/react/dist/icons/Gift'
import { GlobeHemisphereWest } from '@phosphor-icons/react/dist/icons/GlobeHemisphereWest'
import { EXPLORE_LABELS, EXPLORE_MODULES, type ExploreModule } from '../../explore-contract.js'
import { arkmeUi } from '../ui-controller.js'
import { tr } from '../locale.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import type { CSSProperties } from 'react'
export const exploreIcons = {statistics:ChartBar,profile:IdentificationCard,relations:UsersThree,events:Flag,goals:Target,anniversaries:Gift,world:GlobeHemisphereWest,location:MapPin}
export function ExploreNavigation({style,active,current,locked,compact=false}:{style:CSSProperties;active:boolean;current?:ExploreModule|'world'|'statistics'|undefined;locked:boolean;compact?:boolean}) {
  const locationOpen=useSyncExternalStore(arkmeUi.subscribe,()=>arkmeUi.getViewSnapshot().locationOpen===true)
  const [openMode,setOpenMode]=useState<'hover'|'click'|'keyboard'|null>(null),[position,setPosition]=useState({left:0,top:0})
  const open=openMode!==null
  const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null)
  const closeTimer=useRef<ReturnType<typeof setTimeout>>()
  const keepOpen=()=>{clearTimeout(closeTimer.current);closeTimer.current=undefined}
  const close=()=>{keepOpen();setOpenMode(null)}
  const leave=()=>{
    keepOpen()
    // A keyboard user can leave the mouse elsewhere while navigating the menu.
    if(openMode==='keyboard'||panel.current?.contains(document.activeElement))return
    closeTimer.current=setTimeout(()=>{setOpenMode(null);closeTimer.current=undefined},150)
  }
  const within=(target:EventTarget|null)=>target instanceof Node&&(trigger.current?.contains(target)||panel.current?.contains(target))
  useEffect(()=>()=>{clearTimeout(closeTimer.current)},[])
  useEffect(()=>{if(locked){clearTimeout(closeTimer.current);setOpenMode(null)}},[locked])
  useLayoutEffect(()=>{if(!open)return
    const move=()=>{const r=trigger.current?.getBoundingClientRect();if(r)setPosition({left:Math.min(r.right+8,window.innerWidth-210),top:Math.max(8,Math.min(r.top,window.innerHeight-(panel.current?.offsetHeight ?? 380)-8))})};move()
    const pointer=(e:PointerEvent)=>{if(!within(e.target))close()}
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){const restore=openMode==='keyboard'||panel.current?.contains(document.activeElement);close();if(restore)trigger.current?.focus()}}
    document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);window.addEventListener('resize',move)
    // Hover must not steal focus from a composer the user is still editing.
    if(openMode==='keyboard')(panel.current?.querySelector<HTMLButtonElement>(`[aria-current="page"]`)??panel.current?.querySelector('button'))?.focus()
    return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);window.removeEventListener('resize',move)}
  },[open,openMode])
  return <><button ref={trigger} type="button" data-arkme-hover="button" title={open?undefined:tr('探索')} aria-label={tr('探索')} aria-expanded={open} aria-controls={open?'arkme-explore-menu':undefined} aria-current={active?'page':undefined} style={style}
    onPointerEnter={event=>{if(event.pointerType==='touch'||locked)return;keepOpen();setOpenMode(mode=>mode??'hover')}} onPointerLeave={leave}
    onBlur={event=>{if(!within(event.relatedTarget)&&openMode==='keyboard')close()}}
    onKeyDown={event=>{if(event.key==='ArrowDown'&&!locked){event.preventDefault();keepOpen();setOpenMode('keyboard')}}}
    onClick={event=>{if(locked){arkmeUi.openWebLoginDialog();return}keepOpen();setOpenMode(mode=>mode&&mode!=='hover'?null:event.detail===0?'keyboard':'click')}}><Compass size={22} weight={active?'fill':'regular'}/>{compact&&<span>{tr('探索')}</span>}</button>
    {open&&createPortal(<div ref={panel} id="arkme-explore-menu" aria-label={tr('探索板块')} onPointerEnter={keepOpen} onPointerLeave={leave}
      onBlur={event=>{if(!within(event.relatedTarget))close()}}
      style={{position:'fixed',...position,width:190,padding:8,zIndex:1600,border:`1px solid ${theme.border}`,borderRadius:12,background:theme.menu,boxShadow:theme.shadow,color:theme.text}}>
      {['statistics' as const,...EXPLORE_MODULES,'location' as const,'world' as const].map(module=>{const Icon=exploreIcons[module];return <button key={module} type="button" aria-current={current===module?'page':undefined} style={{display:'flex',alignItems:'center',gap:12,width:'100%',border:0,borderRadius:7,padding:'11px 12px',font:'inherit',fontSize:13,textAlign:'left',cursor:'pointer',background:current===module?theme.active:'transparent',color:theme.text}} onClick={()=>{close();module==='location'?arkmeUi.openLocation():module==='statistics'?arkmeUi.showStatistics():module==='world'?arkmeUi.showWorld():arkmeUi.showExplore(module)}}><Icon size={20}/>{tr(module==='location'?'位置':module==='statistics'?'统计与分析':EXPLORE_LABELS[module])}</button>})}
    </div>,document.body)}
    {locationOpen&&!locked&&<ArkmeLocationDialog onClose={()=>arkmeUi.closeLocation()} returnFocusRef={trigger}/>}
  </>
}
