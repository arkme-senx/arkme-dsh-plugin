// @vitest-environment jsdom
import { act, StrictMode, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../src/client/api.js', () => ({ callArkme: async () => ({ profile: { userId: options.auth?.userId, createdAt: Date.parse('2026-09-10T00:00:00+08:00') } }) }))
import { useRecordingTour, type RecordingTourOptions } from '../src/client/ArkmeRecordingTour.js'
import { ArkmeRecordingTourSession } from '../src/client/recording-tour-session.js'
let root: Root, host: HTMLDivElement, storage: Map<string,string>, options: Omit<RecordingTourOptions, 'root'>
function Fixture() {
 const ref = useRef<HTMLDivElement>(null)
 const tour = useRecordingTour({ ...options, root: ref })
 const [tab,setTab] = useState('转写')
 return <div ref={ref}><button data-arkme-recording-tour-target="import" onClick={() => tour.finish(false)}>导入</button><div data-arkme-recording-tour-target="calendar"><button onClick={() => tour.finish(false)}>选择日期</button></div>{tour.sample ? <div data-sample data-arkme-recording-tour-sample><div data-arkme-recording-tour-target="tabs">{['转写','总结','时间轴'].map(label => <button key={label} onClick={() => setTab(label)}>{label}</button>)}</div><p>{tab}内容</p><button onClick={() => tour.finish()}>退出体验</button></div> : <p>真实内容</p>}{tour.panel}</div>
}
async function settle() { await act(async () => { await new Promise(r=>setTimeout(r,45)) }) }
async function render(changes: Partial<typeof options>={}) { options={...options,...changes}; await act(async()=>root.render(<StrictMode><Fixture /></StrictMode>)); await settle() }
async function click(label: string) { const el=[...document.querySelectorAll('button')].find(b=>b.textContent===label); expect(el).toBeDefined(); await act(async()=>el!.click()); await settle() }
function panel() { return document.querySelector('[data-arkme-recording-tour-panel]') }
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){ if(this.hasAttribute('data-arkme-recording-tour-sample')) return new DOMRect(100,220,280,200); return this.hasAttribute('data-arkme-recording-tour-viewport') ? new DOMRect(0,0,window.innerWidth,window.innerHeight) : this.hidden ? new DOMRect() : new DOMRect(100,100,280,60) })
 vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockReturnValue(280)
 vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(60)
 vi.stubGlobal('ResizeObserver', class { observe(){} unobserve(){} disconnect(){} })
 HTMLElement.prototype.scrollIntoView=vi.fn()
 storage=new Map(); options={auth:{status:'authenticated',environment:'prod',userId:1},active:true,blocked:false,deepLink:false,notificationRevision:0,session:new ArkmeRecordingTourSession(()=>({getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,v)}}))}
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{ await act(async()=>root.unmount());document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals() })
it('runs three steps, allows free tabs without advancement and restores real content',async()=>{
 await render(); expect(panel()?.textContent).toContain('1 / 3');expect(document.querySelector('[data-sample]')).toBeNull()
 await click('下一步');expect(panel()?.textContent).toContain('2 / 3');expect(document.querySelector('[data-sample]')).not.toBeNull()
 await click('总结');expect(panel()?.textContent).toContain('2 / 3');expect(host.textContent).toContain('总结内容')
 await click('下一步');expect(panel()?.textContent).toContain('3 / 3');await click('上一步');expect(host.textContent).toContain('总结内容')
 await click('上一步');expect(host.textContent).toContain('真实内容');await click('下一步');expect(host.textContent).toContain('总结内容')
 await click('下一步');await click('完成体验');expect(panel()).toBeNull();expect(host.textContent).toContain('真实内容');expect(storage.get('dsh-arkme:recording-tour:v1:prod:1')).toBe('done')
 expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
})
it('waits for active visible surface and delayed import target without consuming attempt',async()=>{
 await render({active:false});expect(panel()).toBeNull();await render({active:true});expect(panel()).not.toBeNull()
})
it('deep links skip the visit without consuming the next ordinary entry',async()=>{
 await render({deepLink:true});expect(panel()).toBeNull();await render({deepLink:false});expect(panel()).toBeNull();await render({active:false});await render({active:true});expect(panel()).not.toBeNull()
})
it('notification interrupts without marking done or repeating in this page session',async()=>{
 await render();await click('下一步');await render({notificationRevision:1});expect(panel()).toBeNull();expect(document.querySelector('[data-sample]')).toBeNull();expect(storage.size).toBe(0);await render({active:false});await render({active:true});expect(panel()).toBeNull()
})
it('is nonmodal, allows focus on sample tabs, and Escape finishes',async()=>{
 await render();await click('下一步');expect(panel()?.getAttribute('aria-modal')).toBeNull();expect(panel()?.getAttribute('data-arkme-notification-blocking-overlay')).toBeNull()
 const tab=host.querySelector<HTMLButtonElement>('[data-arkme-recording-tour-target="tabs"] button')!;tab.focus();expect(document.activeElement).toBe(tab)
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await settle();expect(panel()).toBeNull();expect(storage.size).toBe(1)
})
it('waits for other overlays then interrupts when a new overlay appears',async()=>{
 const overlay=document.createElement('div');overlay.setAttribute('role','dialog');document.body.append(overlay);await render();expect(panel()).toBeNull();overlay.remove();await settle();expect(panel()).not.toBeNull();document.body.append(overlay);await settle();expect(panel()).toBeNull();expect(storage.size).toBe(0)
})

it('keeps keyboard navigation available after each step and returns focus on explicit exit',async()=>{
 const previous=document.createElement('button');document.body.append(previous);previous.focus();await render()
 await click('下一步');expect(panel()?.contains(document.activeElement)).toBe(true)
 await click('跳过引导');expect(document.activeElement).toBe(previous)
})
it('waits for a delayed target and interrupts a disappearing established target',async()=>{
 await render({active:false});const el=host.querySelector<HTMLElement>('[data-arkme-recording-tour-target="import"]')!;el.hidden=true
 await render({active:true});expect(panel()).toBeNull();el.hidden=false;await settle();expect(panel()).not.toBeNull()
 el.hidden=true;await settle();expect(panel()).toBeNull();el.hidden=false;await settle();expect(panel()).toBeNull();expect(storage.size).toBe(0)
})
it('interrupts logout/account changes without marking done, but allows the new account',async()=>{
 await render();await render({auth:{status:'authenticated',environment:'prod',userId:2}});expect(panel()).not.toBeNull();expect(storage.size).toBe(0)
 await render({auth:undefined});expect(panel()).toBeNull();await render({auth:{status:'authenticated',environment:'prod',userId:1}});expect(panel()).toBeNull()
})
it('finishes before business action and preserves the action focus',async()=>{
 await render();const action=host.querySelector<HTMLButtonElement>('[data-arkme-recording-tour-target="calendar"] button')!;action.focus();await click('选择日期');expect(panel()).toBeNull();expect(storage.size).toBe(1);expect(document.activeElement).toBe(action)
})
it('observes same-origin iframe overlays before and during the tour',async()=>{
 const frame=document.createElement('iframe');document.body.append(frame);const dialog=frame.contentDocument!.createElement('div');dialog.setAttribute('role','dialog');dialog.getBoundingClientRect=()=>new DOMRect(0,0,300,200);frame.contentDocument!.body.append(dialog)
 await render();expect(panel()).toBeNull();dialog.remove();await settle();expect(panel()).not.toBeNull();frame.contentDocument!.body.append(dialog);await settle();expect(panel()).toBeNull();expect(storage.size).toBe(0)
})

it('interrupts if the real product navigation disappears',async()=>{
 const nav=document.createElement('nav');nav.dataset.arkmeOwned='product-navigation';document.body.append(nav);await render();expect(panel()).not.toBeNull()
 nav.remove();await settle();expect(panel()).toBeNull();expect(storage.size).toBe(0)
})

it('remeasures the same target after nested scroll and layout changes without looping',async()=>{
 await render();await click('下一步')
 const owner=host.firstElementChild as HTMLElement
 owner.style.overflowY='auto';owner.getBoundingClientRect=()=>new DOMRect(80,80,400,600)
 const tabs=host.querySelector<HTMLElement>('[data-arkme-recording-tour-sample]')!
 let top=240;tabs.getBoundingClientRect=()=>new DOMRect(100,top,280,60)
 await act(async()=>owner.dispatchEvent(new Event('scroll')));await settle()
 const placeholder=()=>document.querySelector<HTMLElement>('.arkme-home-tour-target-placeholder')!
 expect(placeholder().style.top).toBe('234px')
 top=290;owner.append(document.createElement('span'));await settle()
 expect(placeholder().style.top).toBe('284px')
 const signal=vi.fn();window.addEventListener('scroll',signal)
 await settle();await settle();expect(signal).not.toHaveBeenCalled();window.removeEventListener('scroll',signal)
})
it('suppresses an offscreen bubble during user scroll and resumes the same sample step',async()=>{
 await render();await click('下一步')
 const owner=host.firstElementChild as HTMLElement
 owner.style.overflowY='auto';owner.getBoundingClientRect=()=>new DOMRect(80,80,400,500)
 const tabs=host.querySelector<HTMLElement>('[data-arkme-recording-tour-sample]')!
 const focusedTab=tabs.querySelector<HTMLButtonElement>('button')!;focusedTab.focus()
 let top=800;tabs.getBoundingClientRect=()=>new DOMRect(100,top,280,60)
 owner.scrollTop=0;await act(async()=>owner.dispatchEvent(new Event('scroll')));await settle()
 expect(panel()).toBeNull();expect(host.querySelector('[data-sample]')).not.toBeNull();expect(storage.size).toBe(0);expect(owner.scrollTop).toBe(0)
 top=300;await act(async()=>owner.dispatchEvent(new Event('scroll')));await settle()
 expect(panel()?.textContent).toContain('2 / 3');expect(document.querySelector<HTMLElement>('.arkme-home-tour-target-placeholder')?.style.top).toBe('294px');expect(document.activeElement).toBe(focusedTab)
})

it('remeasures after a layout resize moves the existing target without a DOM mutation',async()=>{
 let resized: ResizeObserverCallback | undefined
 vi.stubGlobal('ResizeObserver',class { constructor(callback: ResizeObserverCallback) { resized=callback } observe(){} unobserve(){} disconnect(){} })
 await render();await click('下一步')
 const tabs=host.querySelector<HTMLElement>('[data-arkme-recording-tour-sample]')!
 tabs.getBoundingClientRect=()=>new DOMRect(100,240,280,60)
 expect(resized).toBeDefined()
 await act(async()=>resized!([],{} as ResizeObserver));await settle()
 expect(document.querySelector<HTMLElement>('.arkme-home-tour-target-placeholder')?.style.top).toBe('234px')
})

it('realigns the actual rc-trigger popup after the placeholder moves during visible nested scroll',async()=>{
 vi.spyOn(document.documentElement,'clientWidth','get').mockReturnValue(1024)
 vi.spyOn(document.documentElement,'clientHeight','get').mockReturnValue(768)
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  if(this.hasAttribute('data-arkme-recording-tour-viewport')) return new DOMRect(0,0,1024,768)
  if(this.classList.contains('arkme-home-tour-target-placeholder')) return new DOMRect(parseFloat(this.style.left)||0,parseFloat(this.style.top)||0,parseFloat(this.style.width)||0,parseFloat(this.style.height)||0)
  if(this.classList.contains('arkme-home-tour-panel')) return new DOMRect(0,0,320,208)
  if(this.hasAttribute('data-arkme-recording-tour-sample')) return new DOMRect(100,400,280,260)
  if(this.classList.contains('arkme-home-tour')) return new DOMRect(this.style.left==='auto'?704:parseFloat(this.style.left)||0,this.style.top==='auto'?560:parseFloat(this.style.top)||0,320,208)
  return new DOMRect(80,80,600,600)
 })
 const css=document.createElement('style');css.textContent='.arkme-home-tour { width:320px; height:208px; position:fixed; }';document.body.append(css)
 await render();await click('下一步')
 const owner=host.firstElementChild as HTMLElement;owner.style.overflowY='auto'
 const tabs=host.querySelector<HTMLElement>('[data-arkme-recording-tour-sample]')!
 let top=500;tabs.getBoundingClientRect=()=>new DOMRect(100,top,280,60)
 await act(async()=>owner.dispatchEvent(new Event('scroll')));await settle();await settle()
 const popup=()=>document.querySelector<HTMLElement>('.arkme-home-tour')!
 const before=popup().getBoundingClientRect().top
 top=600;await act(async()=>owner.dispatchEvent(new Event('scroll')));await settle();await settle()
 expect(document.querySelector<HTMLElement>('.arkme-home-tour-target-placeholder')?.style.top).toBe('594px')
 expect(popup().getBoundingClientRect().top-before).toBe(100)
 expect(popup().getBoundingClientRect().bottom).toBeLessThan(top)
 top=100;await act(async()=>owner.dispatchEvent(new Event('scroll')));await settle();expect(panel()).toBeNull();expect(host.querySelector('[data-sample]')).not.toBeNull()
})

it('dims the page, spotlights the entire interactive sample, and restores real content for the final calendar spotlight',async()=>{
 await render();expect(document.querySelector('[data-arkme-recording-tour-mask]')).not.toBeNull()
 await click('下一步')
 const sample=host.querySelector<HTMLElement>('[data-arkme-recording-tour-sample]')!
 sample.getBoundingClientRect=()=>new DOMRect(100,300,400,360)
 await act(async()=>window.dispatchEvent(new Event('resize')));await settle()
 const sampleHole=()=>document.querySelector<SVGRectElement>('[data-arkme-recording-tour-spotlight="sample"]')
 expect(sampleHole()?.getAttribute('height')).toBe('360')
 expect(document.querySelector<SVGElement>('[data-arkme-recording-tour-mask]')?.style.pointerEvents).toBe('none')
 const blocker=document.querySelector<SVGPathElement>('[data-arkme-recording-tour-mask-blocker]')!
 expect(blocker.style.pointerEvents).toBe('auto');expect(blocker.getAttribute('fill-rule')).toBe('evenodd')
 await act(async()=>blocker.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(panel()).not.toBeNull()
 await click('总结');expect(panel()?.textContent).toContain('2 / 3')
 await click('下一步');expect(sampleHole()).toBeNull();expect(host.querySelector('[data-sample]')).toBeNull();expect(host.textContent).toContain('真实内容');expect(document.querySelector('[data-arkme-recording-tour-spotlight="calendar"]')).not.toBeNull()
})

it('reserves popup space relative to the recording owner while scrolling only that owner',async()=>{
 await render()
 const owner=host.firstElementChild as HTMLElement
 owner.style.overflowY='auto'
 owner.getBoundingClientRect=()=>new DOMRect(80,200,500,500)
 Object.defineProperty(owner,'clientHeight',{value:500});Object.defineProperty(owner,'scrollHeight',{value:1100})
 let naturalTop=700
 const original=vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  if(this.hasAttribute('data-arkme-recording-tour-sample')) return new DOMRect(100,naturalTop-owner.scrollTop,400,300)
  return original.call(this)
 })
 await click('下一步')
 expect(owner.scrollTop).toBe(408)
 expect(document.querySelector<HTMLElement>('.arkme-home-tour-target-placeholder')?.style.top).toBe('286px')
 naturalTop=1100;await act(async()=>window.dispatchEvent(new Event('resize')));await settle();expect(owner.scrollTop).toBe(808)
 owner.scrollTop=600;await act(async()=>owner.dispatchEvent(new Event('scroll')));await settle();expect(owner.scrollTop).toBe(600)
 expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
})

it('anchors the calendar bubble to the full calendar instead of its top header',async()=>{
 await render();
 const calendar=host.querySelector<HTMLElement>('[data-arkme-recording-tour-target="calendar"]')!
 calendar.getBoundingClientRect=()=>new DOMRect(80,40,400,600)
 const header=document.createElement('header');header.getBoundingClientRect=()=>new DOMRect(80,40,400,60);calendar.prepend(header)
 await click('下一步');await click('下一步');
 const placeholder=document.querySelector<HTMLElement>('.arkme-home-tour-target-placeholder')!
 expect(placeholder.style.height).toBe('612px')
 expect(host.querySelector('[data-sample]')).toBeNull()
 await click('上一步');expect(host.querySelector('[data-sample]')).not.toBeNull()
})
