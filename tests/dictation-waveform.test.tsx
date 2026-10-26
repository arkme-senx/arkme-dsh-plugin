// @vitest-environment jsdom
import { act, createRef, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DictationWaveform, dictationWaveHeights, type DictationWaveformHandle } from '../src/client/DictationWaveform.js'
let host: HTMLDivElement, root: Root, frames: Map<number, FrameRequestCallback>, nextId: number
const reference = createRef<DictationWaveformHandle>()
const heights = () => [...host.querySelectorAll('line')].map(line => Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')))
function flushFrames() { for (let n=0;n<80 && frames.size;n++) { const work=[...frames.values()];frames.clear();work.forEach(callback=>callback(0)) } }
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);frames=new Map();nextId=0
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++nextId,callback);return nextId})
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id))
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('uses the mobile mirrored eight-level geometry, ignores old samples and bounds invalid levels',()=>{
  const result=dictationWaveHeights([0,.1,.2,.3,.4,.5,.6,.7,.8])
  expect(result).toHaveLength(16);expect(result).toEqual(result.slice().reverse())
  expect(result[0]).toBe(15);expect(result[7]).toBe(4.5)
  expect(dictationWaveHeights([NaN,-1,2]).every(height=>height>=3.75 && height<=18)).toBe(true)
})
it('reacts to actual audio levels, returns to a quiet baseline and has no idle animation loop',async()=>{
  await act(async()=>root.render(<StrictMode><DictationWaveform ref={reference}/></StrictMode>))
  expect(frames.size).toBe(0)
  reference.current!.sample(.25);flushFrames()
  expect(Math.max(...heights())).toBe(18);expect(heights()).toEqual(heights().slice().reverse())
  expect(frames.size).toBe(0)
  for(let i=0;i<8;i++)reference.current!.sample(0)
  flushFrames();expect(heights()).toEqual(Array(16).fill(3.75));expect(frames.size).toBe(0)
  reference.current!.sample(.2);expect(frames.size).toBe(1)
  await act(async()=>root.unmount());expect(frames.size).toBe(0)
  root=createRoot(host)
})
it('honors reduced motion without frame interpolation',async()=>{
  vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}))
  await act(async()=>root.render(<DictationWaveform ref={reference}/>))
  reference.current!.sample(.25)
  expect(Math.max(...heights())).toBe(18);expect(frames.size).toBe(0)
})
