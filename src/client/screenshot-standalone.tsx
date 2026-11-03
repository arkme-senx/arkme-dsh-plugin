// Intentionally independent of index.tsx and the Harness module graph.
import {useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {ArkmeScreenshotWindow} from './ArkmeScreenshotWindow.js'
import {nativeScreenshotBridge} from './native-screenshot.js'
function StandaloneScreenshot() {
 const [generation,setGeneration]=useState(0)
 useEffect(()=>nativeScreenshotBridge()?.onReset?.(()=>{
  // Synchronously unmount the old canvas, revoke its image URL and reset all edit state.
  flushSync(()=>setGeneration(value=>value+1))
 }),[])
 return <ArkmeScreenshotWindow key={generation}/>
}
const root=document.getElementById('root')
if(root)createRoot(root).render(<StandaloneScreenshot/>)
