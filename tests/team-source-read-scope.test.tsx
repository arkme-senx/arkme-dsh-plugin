// @vitest-environment jsdom
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {afterEach,expect,it,vi} from 'vitest'
import {TeamSourceReadScope} from '../src/client/TeamSourceReadScope.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'
const call=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:call}))
let view:ReactTestRenderer|undefined
afterEach(async()=>{await act(async()=>view?.unmount());view=undefined;call.mockReset()})
it('hides a frozen source until read, hides it immediately on a changed hint, and ignores a stale response',async()=>{
 const pending:Array<{resolve(value:unknown):void;reject(reason:unknown):void}>=[]
 call.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})))
 const target={text:'frozen source',version:3}
 await act(async()=>{view=create(<TeamSourceReadScope accountKey="a" conversationRef="conversation" messageRef="source" version={target.version}>{ok=><span>{ok?target.text:'unavailable'}</span>}</TeamSourceReadScope>)})
 expect(view!.toJSON()).toMatchObject({children:['unavailable']})
 await act(async()=>pending[0]!.resolve([]))
 expect(view!.toJSON()).toMatchObject({children:['frozen source']})
 await act(async()=>invalidateTeamMessages('a',true));expect(pending).toHaveLength(1)
 await act(async()=>invalidateTeamMessages('a'))
 expect(view!.toJSON()).toMatchObject({children:['unavailable']})
 await act(async()=>invalidateTeamMessages('a'))
 await act(async()=>pending[2]!.reject(new Error('message_recalled')))
 await act(async()=>pending[1]!.resolve([]))
 expect(view!.toJSON()).toMatchObject({children:['unavailable']})
 await act(async()=>window.dispatchEvent(new Event('online')))
 await act(async()=>pending.at(-1)!.resolve([]))
 expect(view!.toJSON()).toMatchObject({children:['frozen source']})
 expect(target).toEqual({text:'frozen source',version:3})
})
