// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { useCalendarAutoRefresh } from '../src/client/use-calendar-auto-refresh.js'
import { arkmeCalendarInvalidations } from '../src/client/calendar-invalidation-store.js'

let view: ReactTestRenderer | undefined
afterEach(() => { act(() => view?.unmount()); view=undefined; vi.restoreAllMocks(); vi.useRealTimers() })
function Harness({account='a',date='2026-10-20',refresh}:{account?:string;date?:string;refresh:(hard:boolean)=>void}) {
  useCalendarAutoRefresh(account,date,refresh)
  return null
}
it('coalesces foreground events, ignores hidden focus and stops on unmount', async () => {
  vi.useFakeTimers()
  let visibility='visible'
  vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visibility as DocumentVisibilityState)
  const refresh=vi.fn()
  await act(async()=>{view=create(<Harness refresh={refresh}/>)})
  expect(refresh).not.toHaveBeenCalled()
  act(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))})
  expect(refresh).toHaveBeenCalledTimes(1)
  act(()=>{vi.advanceTimersByTime(600);visibility='hidden';window.dispatchEvent(new Event('focus'))})
  expect(refresh).toHaveBeenCalledTimes(1)
  act(()=>{visibility='visible';document.dispatchEvent(new Event('visibilitychange'))})
  expect(refresh).toHaveBeenCalledTimes(2)
  act(()=>view!.unmount());view=undefined
  act(()=>{vi.advanceTimersByTime(600);window.dispatchEvent(new Event('focus'))})
  expect(refresh).toHaveBeenCalledTimes(2)
})
it('refreshes only the selected date and propagates immediate hard invalidation', async () => {
  const refresh=vi.fn()
  await act(async()=>{view=create(<Harness refresh={refresh}/>)})
  await act(async()=>arkmeCalendarInvalidations.publish({dateKey:'2026-10-21'}))
  expect(refresh).not.toHaveBeenCalled()
  await act(async()=>arkmeCalendarInvalidations.publish({dateKey:'2026-10-20'}))
  expect(refresh).toHaveBeenLastCalledWith(false)
  await act(async()=>{view!.update(<Harness date="2026-10-21" refresh={refresh}/>)})
  refresh.mockClear()
  await act(async()=>arkmeCalendarInvalidations.publish({dateKey:'2026-10-20'}))
  expect(refresh).not.toHaveBeenCalled()
  await act(async()=>arkmeCalendarInvalidations.publishAll({hard:true}))
  expect(refresh).toHaveBeenCalledExactlyOnceWith(true)
  await act(async()=>{view!.update(<Harness account="" refresh={refresh}/>)})
  refresh.mockClear()
  await act(async()=>arkmeCalendarInvalidations.publishAll())
  expect(refresh).not.toHaveBeenCalled()
})
