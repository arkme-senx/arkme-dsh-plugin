import {createRoot} from 'react-dom/client'
import {ArkmeScreenshotShortcutSetting} from '../../src/client/ArkmeScreenshotShortcutSetting.js'
import type {ShortcutSnapshot} from '../../src/client/screenshot-shortcut.js'
let snapshot:ShortcutSnapshot={accelerator:'Command+Shift+A',available:true}
const listeners=new Set<(value:ShortcutSnapshot)=>void>()
Object.assign(window,{arkmeScreenshotShortcut:{get:async()=>snapshot,record:async()=>true,set:async(accelerator:string)=>{snapshot={accelerator,available:true};listeners.forEach(fn=>fn(snapshot));return snapshot},onChanged:(fn:(value:ShortcutSnapshot)=>void)=>{listeners.add(fn);return ()=>listeners.delete(fn)},onTrigger:()=>()=>{}}})
createRoot(document.getElementById('root')!).render(<main style={{fontFamily:'system-ui',padding:32,maxWidth:520}}><h2>通用设置</h2><h3>通用</h3><p>通知</p><ArkmeScreenshotShortcutSetting/></main>)
