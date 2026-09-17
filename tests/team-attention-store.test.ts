// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { startTeamAttention, readTeamAttention } from '../src/client/team-attention-store.js'
import { invalidateTeamMessages } from '../src/client/team-messaging-events.js'
import { showBrowserNotification } from '../src/client/browser-notification.js'
let stops: Array<() => void> = []
afterEach(() => { for (const stop of stops) stop(); stops = []; vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.call.mockReset() })
it('keeps unread discovery in the persistent shell and contains Team failures', async () => {
 const notify = vi.fn()
 mocks.call.mockResolvedValue({ external: false, team: false })
 stops.push(startTeamAttention('a', notify))
 await vi.waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1))
 mocks.call.mockResolvedValue({ external: true, team: false })
 invalidateTeamMessages('a')
 await vi.waitFor(() => expect(readTeamAttention('a').external).toBe(true))
 expect(notify).toHaveBeenCalledTimes(1)
 mocks.call.mockRejectedValue(new Error('Team offline'))
 invalidateTeamMessages('a')
 await vi.waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(3))
 expect(readTeamAttention('a').external).toBe(true)
 expect(mocks.call.mock.calls.every(v => v[0] === 'team.app.attention')).toBe(true)
})
it('coalesces hints and discards a previous account response', async () => {
 let finish!: (value: unknown) => void
 mocks.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
 const stop = startTeamAttention('old', vi.fn()); stops.push(stop)
 for (let i=0;i<100;i++) invalidateTeamMessages('old')
 expect(mocks.call).toHaveBeenCalledTimes(1)
 stop(); mocks.call.mockResolvedValue({ external: false, team: true })
 stops.push(startTeamAttention('new', vi.fn()))
 finish({external: true, team: false})
 await vi.waitFor(() => expect(readTeamAttention('new').team).toBe(true))
 expect(readTeamAttention('old').external).toBe(false)
 expect(mocks.call).toHaveBeenCalledTimes(2)
})
it('uses a business-neutral browser notification and cancels old activations', () => {
 const notices: Array<{onclick: null|(()=>void); close: ReturnType<typeof vi.fn>}> = []
 class Notice {static permission='granted';onclick:null|(()=>void)=null;close=vi.fn();constructor(){notices.push(this)}}
 vi.stubGlobal('Notification', Notice);vi.spyOn(window,'focus').mockImplementation(()=>{})
 const activate = vi.fn(), close = showBrowserNotification('Team','Unread','team-a',activate)
 notices[0]!.onclick?.();expect(activate).toHaveBeenCalledTimes(1)
 close?.();expect(notices[0]!.onclick).toBeNull()
 Notice.permission='denied';expect(showBrowserNotification('Team','Unread','team-a',activate)).toBeUndefined()
 expect(notices).toHaveLength(1)
})
