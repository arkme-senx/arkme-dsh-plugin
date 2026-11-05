import {createHash} from 'node:crypto'
import {expect,it} from 'vitest'
import {matchExcerptOriginal,rebaseExcerptSelection} from '../../src/services/excerpt-original.js'
import {quoteSourceContent,quoteCanonicalText} from '../../src/message-quote.js'

it('locates the exact selected occurrence with source digest and UTF16 instead of searching equal prose',()=>{
 const original={title:'原文',text:'前文 😀 相同 **文字**。相同 **文字**。后文',textFormat:'markdown' as const,recordVersion:3}
 const content={textContent:original.text,textFormat:original.textFormat},canonical=quoteCanonicalText(content)
 const text='相同 文字',start=canonical.lastIndexOf(text)
 const quote={version:1 as const,sourceLabel:'私聊',senderName:'原作者',sourceAtMillis:1,text,sourceSelection:{projection:'arkme-text-v1' as const,source_digest:createHash('sha256').update(quoteSourceContent(content)).digest('hex'),start,end:start+text.length,record_version:3}}
 expect(matchExcerptOriginal(original,quote).selection).toEqual({start,end:start+text.length})
 expect(()=>matchExcerptOriginal({...original,recordVersion:4},quote)).toThrow(/版本或选区/)
 expect(()=>matchExcerptOriginal({...original,text:original.text+'修改'},quote)).toThrow(/版本或选区/)
 expect(()=>matchExcerptOriginal(original,{...quote,sourceSelection:{...quote.sourceSelection,start:start+1}})).toThrow(/版本或选区/)
 expect(matchExcerptOriginal(original,{...quote,sourceSelection:undefined} as never)).toEqual(original)
})

it('rebases a paged recording view by owner scalar offsets across emoji and whitespace, including repeated prose',()=>{
 const fragment='  相同 😀\n相同 文字  ',full='前文 😀\n'+fragment+'后文',start=Array.from('前文 😀\n').length
 const canonical=quoteCanonicalText({textContent:fragment,textFormat:'plain'}),selected='相同 文字',offset=canonical.indexOf(selected)
 const quote={version:1 as const,sourceLabel:'录音',senderName:'作者',sourceAtMillis:1,text:selected,sourceSelection:{projection:'arkme-text-v1' as const,source_digest:createHash('sha256').update(quoteSourceContent({textContent:fragment,textFormat:'plain'})).digest('hex'),start:offset,end:offset+selected.length}}
 const selection=rebaseExcerptSelection(full,start,start+Array.from(fragment).length,quote)
 expect(matchExcerptOriginal({title:'录音',text:full},{...quote,sourceSelection:selection}).selection).toEqual({start:selection.start,end:selection.end})
 expect(quoteCanonicalText({textContent:full}).slice(selection.start,selection.end)).toBe(selected)
 expect(()=>rebaseExcerptSelection(full,0,Array.from(fragment).length,quote)).toThrow()
})
