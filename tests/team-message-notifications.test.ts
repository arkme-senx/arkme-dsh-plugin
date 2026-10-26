import { afterEach, expect, it, vi } from 'vitest'
import { TeamMessageNotificationPresenter, createTeamMessageNotificationPresenter } from '../src/client/team-message-notifications.js'
import { callArkme } from '../src/client/api.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const notice = { eventUid:'event', sourceRef:'sealed-team', sourceKey:'key', sourceKind:'team_conversation' as const,
  title:'团队', body:'消息', eventAtMillis:1, expiresAtMillis:Date.now()+300000 }
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
function fixture() {
  let current = true, click: (()=>void)|undefined
  const controller = { close:vi.fn() }
  const ports = { current:()=>current, resolve:vi.fn(async()=>({key:'conversation'} as never)), open:vi.fn(),
    show:vi.fn((_title:string,_body:string,_tag:string,activate:()=>void)=>{click=activate;return controller.close}) }
  const presenter = new TeamMessageNotificationPresenter(ports)
  return { ports, presenter, controller, click:()=>click?.(), retire:()=>{current=false} }
}
it('dedupes a Team message and resolves current access on click', async()=>{
  const f=fixture();f.presenter.show(notice);f.presenter.show(notice)
  expect(f.ports.show).toHaveBeenCalledOnce();f.click();await vi.waitFor(()=>expect(f.ports.open).toHaveBeenCalledWith({key:'conversation'}))
  expect(f.ports.resolve.mock.calls[0]?.[0]).toBe('sealed-team');f.presenter.dispose();expect(f.controller.close).toHaveBeenCalledOnce()
})
it('rejects expired presentation but a prior notification can still open authorized history',async()=>{
  const f=fixture();f.presenter.show({...notice,expiresAtMillis:Date.now()-1});expect(f.ports.show).not.toHaveBeenCalled()
  f.presenter.show(notice);f.click();await vi.waitFor(()=>expect(f.ports.open).toHaveBeenCalledOnce());f.presenter.dispose()
})
it('failed authorization cannot navigate',async()=>{
  const f=fixture();f.ports.resolve.mockRejectedValueOnce(Error('revoked'));f.presenter.show(notice);f.click()
  await vi.waitFor(()=>expect(f.ports.resolve).toHaveBeenCalledOnce());expect(f.ports.open).not.toHaveBeenCalled();f.presenter.dispose()
})
it('account retirement during resolution discards content and disposal closes notifications',async()=>{
  const f=fixture();f.ports.resolve.mockImplementation(async()=>{f.retire();return {key:'old'} as never})
  f.presenter.show(notice);f.click();await vi.waitFor(()=>expect(f.ports.resolve).toHaveBeenCalledOnce())
  expect(f.ports.open).not.toHaveBeenCalled();f.presenter.dispose();expect(f.controller.close).toHaveBeenCalledOnce()
})
it('uses the existing browser API even when an unchanged Chat-only shell bridge exists',async()=>{
  const native=vi.fn(()=>{throw Error('Team must not enter the Chat native contract')})
  let created:{onclick?:()=>void}|undefined
  vi.stubGlobal('window',{arkmeDesktopNotifications:{show:native,onActivated:vi.fn()},focus:vi.fn()})
  vi.stubGlobal('Notification',class { static permission='granted'; onclick?:()=>void; constructor(){created=this} close(){} })
  vi.mocked(callArkme).mockResolvedValueOnce({key:'team'})
  const presenter=createTeamMessageNotificationPresenter(()=>true);presenter.show(notice)
  expect(created).toBeDefined();expect(native).not.toHaveBeenCalled();created!.onclick!()
  await vi.waitFor(()=>expect(callArkme).toHaveBeenCalledWith('team.app.notification.open',{notificationRef:'sealed-team'},expect.any(AbortSignal)))
  presenter.dispose()
})

it('the last clicked notification wins when an earlier authorization completes late', async () => {
  const clicks: Array<() => void> = []
  let first!: (value: never) => void
  const open = vi.fn()
  const presenter = new TeamMessageNotificationPresenter({
    current: () => true,
    resolve: vi.fn((ref: string) => ref === 'first'
      ? new Promise<never>(resolve => { first = resolve })
      : Promise.resolve({key:'second'} as never)),
    open,
    show: (_title,_body,_tag,activate) => { clicks.push(activate); return () => {} },
  })
  presenter.show({...notice,eventUid:'first',sourceRef:'first'})
  presenter.show({...notice,eventUid:'second',sourceRef:'second'})
  clicks[0]!(); clicks[1]!()
  await vi.waitFor(()=>expect(open).toHaveBeenCalledWith({key:'second'}))
  first({key:'first'} as never)
  await Promise.resolve()
  expect(open.mock.calls.map(([value])=>value.key)).toEqual(['second'])
  presenter.dispose()
})
