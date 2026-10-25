import { act, create } from 'react-test-renderer'
import { it, vi } from 'vitest'
import { ArkmeLongArticleActions } from '../src/client/ArkmeLongArticleActions.js'
vi.mock('../src/client/api.js',()=>({callArkme:vi.fn()}))
it('can render actions without a browser document in the native window bootstrap', async()=>{
 vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()})
 vi.stubGlobal('document',{title:''})
 let renderer:ReturnType<typeof create>
 try { await act(async()=>{renderer=create(<ArkmeLongArticleActions sourceRef="self" detail={{sourceRef:'self',itemUid:'a',title:'标题',textContent:'正文',sendAtMillis:1,updateAtMillis:1,recordDurationMillis:0,editDurationMillis:0,thinkingDurationMillis:0,version:1,editable:true}} dismissRef={{current:undefined}} onDeleted={()=>{}}/>) }); await act(async()=>renderer!.unmount()) }
 finally{vi.unstubAllGlobals()}
})
