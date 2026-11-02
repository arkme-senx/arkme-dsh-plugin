// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorldPreviewImages, readPreviewImage } from '../src/client/WorldPreviewImages.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
const call = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => call(...args) }))
vi.mock('../src/client/ArkmeWorldSurface.js', () => ({ WorldImagePreviewDialog: () => <div role="dialog">图片查看器</div> }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const revoke = vi.fn()
beforeEach(() => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); call.mockReset(); revoke.mockClear()
 vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:thumbnail'; static revokeObjectURL = revoke })
 arkmeAuthStore.setAuth({ status:'authenticated',environment:'test',userId:42 })
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('loads only visible thumbnails, releases bytes offscreen, and reads again when visible',async()=>{
 let observe!: (entries: {isIntersecting:boolean}[])=>void
 const disconnect=vi.fn()
 vi.stubGlobal('IntersectionObserver',class { constructor(callback: typeof observe){observe=callback} observe(){} disconnect=disconnect })
 call.mockResolvedValue({mediaType:'image/png',dataBase64:'cG5n'})
 await act(async()=>root.render(<WorldPreviewImages imageRefs={['original-image']} />))
 expect(call).not.toHaveBeenCalled()
 await act(async()=>observe([{isIntersecting:true}]))
 expect(host.querySelector('img')?.src).toBe('blob:thumbnail')
 expect(call.mock.calls[0]?.[0]).toBe('image.read')
 await act(async()=>observe([{isIntersecting:false}]))
 expect(host.querySelector('img')).toBeNull();expect(revoke).toHaveBeenCalledWith('blob:thumbnail')
 await act(async()=>observe([{isIntersecting:true}]))
 expect(call).toHaveBeenCalledTimes(2)
 await act(async()=>root.render(null));expect(disconnect).toHaveBeenCalled()
})
it('limits the visible grid to three pictures and opens the existing viewer without opening its row',async()=>{
 call.mockResolvedValue({mediaType:'image/png',dataBase64:'cG5n'})
 const openRow=vi.fn()
 await act(async()=>root.render(<div onClick={openRow}><WorldPreviewImages publicImage imageRefs={['a','b','c','d','e']} /></div>))
 expect(host.querySelectorAll('img')).toHaveLength(3);expect(host.textContent).toContain('+2')
 expect(call.mock.calls.every(([op])=>op==='world.image.read')).toBe(true)
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="放大图片 1"]')!.click())
 expect(host.querySelector('[role="dialog"]')).not.toBeNull();expect(openRow).not.toHaveBeenCalled()
})
it('does not retain old bytes after account change or display an aborted response',async()=>{
 const pending: ((v: unknown)=>void)[]=[]
 call.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)))
 await act(async()=>root.render(<WorldPreviewImages imageRefs={['old-account-ref']} />))
 const oldSignal=call.mock.calls[0]![2] as AbortSignal
 await act(async()=>arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:43}))
 expect(oldSignal.aborted).toBe(true)
 await act(async()=>pending[0]!({mediaType:'image/png',dataBase64:'cG5n'}))
 expect(host.querySelector('img')).toBeNull()
 await act(async()=>root.render(null))
 for(const resolve of pending.slice(1)) await act(async()=>resolve({mediaType:'image/png',dataBase64:'cG5n'}))
})
it('bounds active reads to two and removes cancelled work from the queue',async()=>{
 const finish: ((v: unknown)=>void)[]=[]
 call.mockImplementation(()=>new Promise(resolve=>finish.push(resolve)))
 const controllers=Array.from({length:5},()=>new AbortController())
 const work=controllers.map((c,i)=>readPreviewImage(String(i),false,c.signal).catch(()=>undefined))
 expect(call).toHaveBeenCalledTimes(2)
 controllers[2]!.abort()
 finish[0]!({});finish[1]!({});await new Promise(resolve=>setTimeout(resolve,0))
 expect(call.mock.calls.map(([,input])=>input.imageRef)).toEqual(['0','1','3','4'])
 finish[2]!({});finish[3]!({});await Promise.all(work)
})

it('owns Escape while an original image is open and releases the listener on close',async()=>{
 call.mockResolvedValue({mediaType:'image/png',dataBase64:'cG5n'})
 await act(async()=>root.render(<WorldPreviewImages imageRefs={['original-image']} />))
 const trigger=host.querySelector<HTMLButtonElement>('[aria-label="放大图片 1"]')!
 await act(async()=>{trigger.focus();trigger.click()})
 expect(host.querySelector('[role="dialog"]')).not.toBeNull()
 const underlying=vi.fn();window.addEventListener('keydown',underlying)
 try{
  await act(async()=>trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(underlying).not.toHaveBeenCalled();expect(document.activeElement).toBe(trigger)
  await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  expect(underlying).toHaveBeenCalledTimes(1)
 }finally{window.removeEventListener('keydown',underlying)}
})
