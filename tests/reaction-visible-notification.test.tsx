import { act, create } from 'react-test-renderer'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { useVisibleReactionNotification } from '../src/client/ArkmeReactionNotification.js'
const { seen, forSource, canAcknowledge, startHighlights, hasHistoryHighlight }=vi.hoisted(()=>({seen:vi.fn(),forSource:vi.fn(),canAcknowledge:vi.fn(),startHighlights:vi.fn(),hasHistoryHighlight:vi.fn()}))
vi.mock('../src/client/reaction-notifications.js',()=>({reactionNotifications:{subscribe:()=>()=>{},getSnapshot:()=>0,startHighlights,hasHistoryHighlight,highlights:()=>undefined,forSource,seen,canAcknowledge}}))
const notice={id:'notice',revision:2,itemUid:'message',selections:[{key:'rendered'}]}
let callback:(entries:any[])=>void
let doc:EventTarget & {hidden:boolean;hasFocus:()=>boolean}
let focus=true
function Message({keys=['rendered']}:{keys?:string[]}) {const ref=useVisibleReactionNotification('test:1','chat','message',keys);return <div ref={ref}/>}
beforeEach(()=>{
 callback=()=>{}
 vi.useFakeTimers();seen.mockReset();startHighlights.mockReset();canAcknowledge.mockReturnValue(true);forSource.mockReturnValue([notice]);hasHistoryHighlight.mockReturnValue(false);focus=true
 doc=Object.assign(new EventTarget(),{hidden:false,hasFocus:()=>focus})
 vi.stubGlobal('document',doc);vi.stubGlobal('window',new EventTarget())
 vi.stubGlobal('IntersectionObserver',class {constructor(cb:typeof callback){callback=cb}observe(){}disconnect(){}})
})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
describe('reaction visible acknowledgement',()=>{
 it('starts a history highlight after arrival without acknowledging inbox notifications',()=>{
  forSource.mockReturnValue([]);hasHistoryHighlight.mockReturnValue(true)
  let ui!:ReturnType<typeof create>;act(()=>{ui=create(<Message/>,{createNodeMock:()=>({closest:()=>null})})})
  act(()=>{vi.advanceTimersByTime(3000)})
  expect(startHighlights).not.toHaveBeenCalled()
  act(()=>{callback([{isIntersecting:true,intersectionRatio:1}]);vi.advanceTimersByTime(180)})
  expect(startHighlights).toHaveBeenCalledTimes(1)
  act(()=>vi.advanceTimersByTime(3000))
  expect(seen).not.toHaveBeenCalled();act(()=>ui.unmount())
 })
 it('waits for the full reaction region and scrolling to settle before starting the accent',()=>{
  const viewport = new EventTarget()
  let ui!:ReturnType<typeof create>;act(()=>{ui=create(<Message/>,{createNodeMock:()=>({closest:()=>viewport})})})
  act(()=>{callback([{isIntersecting:true,intersectionRatio:.8}]);vi.advanceTimersByTime(2000)})
  expect(startHighlights).not.toHaveBeenCalled()
  act(()=>callback([{isIntersecting:true,intersectionRatio:1}]))
  for(let i=0;i<10;i++) act(()=>{vi.advanceTimersByTime(100);viewport.dispatchEvent(new Event('scroll'))})
  expect(startHighlights).not.toHaveBeenCalled()
  act(()=>vi.advanceTimersByTime(179));expect(startHighlights).not.toHaveBeenCalled()
  act(()=>vi.advanceTimersByTime(1));expect(startHighlights).toHaveBeenCalledTimes(1)
  act(()=>ui.unmount())
 })

 it('keeps orange reminders when returning to a visible conversation without clicking the preview',()=>{
  canAcknowledge.mockReturnValue(false)
  let ui!:ReturnType<typeof create>;act(()=>{ui=create(<Message/>,{createNodeMock:()=>({closest:()=>null})})})
  act(()=>{callback([{isIntersecting:true,intersectionRatio:1}]);window.dispatchEvent(new Event('focus'));vi.advanceTimersByTime(3000)})
  expect(seen).not.toHaveBeenCalled();act(()=>ui.unmount())
 })

 it('requires visible rendered reaction and foreground dwell, not simply entering the conversation',()=>{
  let ui!:ReturnType<typeof create>;act(()=>{ui=create(<Message/>,{createNodeMock:()=>({closest:()=>null})})})
  act(()=>vi.advanceTimersByTime(1000));expect(seen).not.toHaveBeenCalled()
  act(()=>{callback([{isIntersecting:true,intersectionRatio:.5}]);vi.advanceTimersByTime(1000)});expect(seen).not.toHaveBeenCalled()
  act(()=>{callback([{isIntersecting:true,intersectionRatio:1}]);vi.advanceTimersByTime(879)});expect(seen).not.toHaveBeenCalled()
  act(()=>vi.advanceTimersByTime(1));expect(seen).toHaveBeenCalledWith('test:1',[notice]);act(()=>ui.unmount())
 })
 it('does not clear when unfocused, hidden, scrolled away or unmounted before dwell completes',()=>{
  let ui!:ReturnType<typeof create>;act(()=>{ui=create(<Message/>,{createNodeMock:()=>({closest:()=>null})})})
  focus=false;act(()=>{callback([{isIntersecting:true,intersectionRatio:1}]);vi.advanceTimersByTime(1000)});expect(seen).not.toHaveBeenCalled()
  focus=true;doc.hidden=true;act(()=>{doc.dispatchEvent(new Event('visibilitychange'));vi.advanceTimersByTime(1000)});expect(seen).not.toHaveBeenCalled()
  doc.hidden=false;act(()=>{doc.dispatchEvent(new Event('visibilitychange'));vi.advanceTimersByTime(300);callback([{isIntersecting:false,intersectionRatio:0}]);vi.advanceTimersByTime(1000)});expect(seen).not.toHaveBeenCalled()
  act(()=>{callback([{isIntersecting:true,intersectionRatio:1}]);vi.advanceTimersByTime(300)});act(()=>ui.unmount());act(()=>vi.advanceTimersByTime(1000));expect(seen).not.toHaveBeenCalled()
 })
 it('does not acknowledge a notification when the new reaction has not rendered yet',()=>{
  let ui!:ReturnType<typeof create>;act(()=>{ui=create(<Message keys={['old-key']}/>,{createNodeMock:()=>({closest:()=>null})})});act(()=>vi.advanceTimersByTime(2000));expect(seen).not.toHaveBeenCalled();act(()=>ui.unmount())
 })
})
