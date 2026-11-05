import type {TeamCodexEvent} from '../../../team-codex-contract.js'

export const CODEX_READING_MESSAGES=200
export const CODEX_READING_BYTES=2*1024*1024
export function fitCodexReadingWindow(events:TeamCodexEvent[],edge:'older'|'newer'){
 let bytes=0,count=0
 const ordered=edge==='older'?events:[...events].reverse()
 for(const event of ordered){const size=new TextEncoder().encode(event.text).byteLength+(event.localProgress??[]).reduce((n,p)=>n+new TextEncoder().encode(p.text).byteLength,0)
  if(size>CODEX_READING_BYTES)throw Error('工作动态单条内容超过读取上限')
  if(count&&(count>=CODEX_READING_MESSAGES||bytes+size>CODEX_READING_BYTES))break
  bytes+=size;count++
 }
 return {items:edge==='older'?events.slice(0,count):events.slice(events.length-count),dropped:count<events.length}
}
