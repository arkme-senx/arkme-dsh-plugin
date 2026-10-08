import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { afterReactionLayout, afterMessageVisible } from '../src/client/reaction-locate-layout.js'
let ready=false, changed:()=>void
beforeEach(()=>{vi.useFakeTimers();ready=false;vi.stubGlobal('requestAnimationFrame',(fn:()=>void)=>setTimeout(fn,16));vi.stubGlobal('cancelAnimationFrame',clearTimeout);vi.stubGlobal('MutationObserver',class{constructor(fn:()=>void){changed=fn}observe(){}disconnect(){}})})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
const row=()=>({querySelector:()=>ready?null:{}} as unknown as HTMLElement)
describe('reaction locate geometry',()=>{
 it('highlights an already-rendered reaction immediately even if reminder removal rerenders the view',()=>{
  ready=true
  const locate=vi.fn();const stop=afterReactionLayout(row(),locate)
  expect(locate).toHaveBeenCalledTimes(1)
  stop();vi.advanceTimersByTime(16)
  expect(locate).toHaveBeenCalledTimes(1)
 })

 it('waits for first rendered reaction layout before locating and highlighting',()=>{
  const locate=vi.fn();const stop=afterReactionLayout(row(),locate)
  vi.advanceTimersByTime(500);expect(locate).not.toHaveBeenCalled()
  ready=true;changed();expect(locate).not.toHaveBeenCalled();vi.advanceTimersByTime(16);expect(locate).toHaveBeenCalledTimes(1);stop()
 })
 it('cannot steal scroll after navigation changes',()=>{
  const locate=vi.fn();const stop=afterReactionLayout(row(),locate);stop();ready=true;changed();vi.advanceTimersByTime(5000);expect(locate).not.toHaveBeenCalled()
 })
 it('does not block navigation forever on an offline target',()=>{
  const locate=vi.fn();const stop=afterReactionLayout(row(),locate);vi.advanceTimersByTime(4016);expect(locate).toHaveBeenCalledTimes(1);stop()
 })
})

describe('original message highlight after reaction cancellation', () => {
 const setup = () => {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true, defaultView: win })
  const viewport = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ top: 0, bottom: 600 }) })
  const row = { ownerDocument: doc, getBoundingClientRect: () => ({ top: 200, bottom: 300 }) }
  const highlight = vi.fn()
  const stop = afterMessageVisible(viewport as unknown as HTMLElement, row as unknown as HTMLElement, highlight)
  return { win, doc, viewport, row, highlight, stop }
 }
 it('highlights the original message without any reaction element', () => {
  const { highlight, stop } = setup()
  expect(highlight).not.toHaveBeenCalled()
  vi.advanceTimersByTime(180)
  expect(highlight).toHaveBeenCalledTimes(1)
  stop()
 })
 it('does not spend highlight time while scrolling to the original', () => {
  const { viewport, highlight, stop } = setup()
  for (let i = 0; i < 30; i++) {
   vi.advanceTimersByTime(100)
   viewport.dispatchEvent(new Event('scroll'))
  }
  expect(highlight).not.toHaveBeenCalled()
  vi.advanceTimersByTime(180)
  expect(highlight).toHaveBeenCalledTimes(1)
  viewport.dispatchEvent(new Event('scroll'))
  vi.advanceTimersByTime(500)
  expect(highlight).toHaveBeenCalledTimes(1)
  stop()
 })
 it('waits until the window is visible and the message is on screen', () => {
  const { doc, row, viewport, highlight, stop } = setup()
  doc.hidden = true
  vi.advanceTimersByTime(3000)
  expect(highlight).not.toHaveBeenCalled()
  row.getBoundingClientRect = () => ({ top: 700, bottom: 800 })
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'))
  vi.advanceTimersByTime(180)
  expect(highlight).not.toHaveBeenCalled()
  row.getBoundingClientRect = () => ({ top: 200, bottom: 300 })
  viewport.dispatchEvent(new Event('scroll'))
  vi.advanceTimersByTime(180)
  expect(highlight).toHaveBeenCalledTimes(1)
  stop()
 })
 it('cancels pending highlights when leaving or selecting another source', () => {
  const { highlight, viewport, stop } = setup()
  stop(); viewport.dispatchEvent(new Event('scroll'))
  vi.advanceTimersByTime(5000)
  expect(highlight).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
 })
})
