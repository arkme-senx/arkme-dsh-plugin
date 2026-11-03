// @vitest-environment jsdom
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import {CodexMessageBody} from '../src/client/redesign/contacts/TeamCodexConversation.js'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:api}))
it('renders frozen Codex history as ordinary text/Markdown without asking DSH to restore a native conversation',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const frozen=JSON.parse(readFileSync(resolve('tests/fixtures/codex-content-v1.json'),'utf8')) as {events:{event_id:string;text:string}[]}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>root.render(<>{frozen.events.map(e=><CodexMessageBody key={e.event_id} text={e.text}/>)}</>))
 expect(host.textContent).toContain('升级前的问题');expect(host.textContent).toContain('🌏');expect(host.querySelector('strong')?.textContent).toBe('过程信息');expect(host.querySelector('pre code')?.textContent).toContain('历史可读');expect(api).not.toHaveBeenCalled()
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
