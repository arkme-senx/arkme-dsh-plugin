import {useEffect,useState} from 'react'
export interface ShortcutSnapshot {accelerator:string;available:boolean}
export interface ScreenshotShortcutBridge {
 get():Promise<ShortcutSnapshot|null>;set(key:string):Promise<ShortcutSnapshot>;record(value:boolean):Promise<boolean>
 onChanged(listener:(snapshot:ShortcutSnapshot)=>void):()=>void
 onTrigger(listener:()=>void):()=>void
}
export function screenshotShortcutBridge(){return (globalThis as typeof globalThis & {arkmeScreenshotShortcut?:ScreenshotShortcutBridge}).arkmeScreenshotShortcut}
export function useScreenshotShortcut(){
 const [snapshot,setSnapshot]=useState<ShortcutSnapshot|null>(null)
 useEffect(()=>{const bridge=screenshotShortcutBridge();if(!bridge)return;let live=true,revision=0;const stop=bridge.onChanged(value=>{revision++;if(live)setSnapshot(value)});void bridge.get().then(value=>{if(live&&!revision)setSnapshot(value)}).catch(()=>{});return ()=>{live=false;stop()}},[])
 return snapshot
}
export function shortcutLabel(value:string){const mac=value.includes('Command');return value.split('+').map(key=>key==='Command'?'⌘':key==='Control'?'Ctrl':key==='Alt'&&mac?'⌥':key==='Shift'&&mac?'⇧':key).join(' + ')}
export function shortcutFromKey(event:Pick<KeyboardEvent,'code'|'metaKey'|'ctrlKey'|'altKey'|'shiftKey'>):string|null{
 const key=/^Key[A-Z]$/.test(event.code)?event.code.slice(3):/^Digit[0-9]$/.test(event.code)?event.code.slice(5):/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)?event.code:null
 if(!key||!(event.metaKey||event.ctrlKey||event.altKey))return null
 return [event.metaKey?'Command':'',event.ctrlKey?'Control':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',key].filter(Boolean).join('+')
}
