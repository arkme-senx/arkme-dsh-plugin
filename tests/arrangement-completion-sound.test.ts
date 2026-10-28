// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { prepareArrangementCompletionSound } from '../src/client/arrangement-completion-sound.js'
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();delete (window as unknown as {AudioContext?:unknown}).AudioContext})
function audio(fail = false) {
  const start=vi.fn(), stop=vi.fn(), connect=vi.fn(), close=vi.fn(async()=>{}), resume=vi.fn(async()=>{})
  const createOscillator=vi.fn(()=>{if(fail)throw Error('audio unavailable');return {frequency:{value:0},connect,start,stop,type:'sine'}})
  const context={state:'running',currentTime:0,destination:{},close,resume,createOscillator,createGain:()=>({gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect})}
  Object.defineProperty(window,'AudioContext',{configurable:true,value:vi.fn(function(){return context})})
  return {context,start,close,createOscillator}
}
it('only starts a short sound after play and releases the context',async()=>{
  vi.useFakeTimers();const a=audio(),sound=prepareArrangementCompletionSound()
  expect(a.start).not.toHaveBeenCalled()
  sound?.play();expect(a.createOscillator).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(501);expect(a.close).toHaveBeenCalledOnce()
})
it('can cancel a prepared sound without playing it',()=>{
  vi.useFakeTimers();const a=audio(),sound=prepareArrangementCompletionSound();sound?.cancel();sound?.play()
  expect(a.start).not.toHaveBeenCalled();expect(a.close).toHaveBeenCalledOnce()
})
it('does not throw when audio fails after a task was successfully saved',()=>{
  vi.useFakeTimers();const a=audio(true),sound=prepareArrangementCompletionSound()
  expect(()=>sound?.play()).not.toThrow();expect(a.close).toHaveBeenCalledOnce()
})
