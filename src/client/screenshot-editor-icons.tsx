import type { Tool } from './screenshot-editor-model.js'
export type ScreenshotIcon = Tool | 'undo' | 'redo' | 'reselect' | 'save' | 'close' | 'complete'
const paths:Record<ScreenshotIcon,string>={
 rectangle:'M4 5h16v14H4z',ellipse:'M21 12a9 7 0 1 1-18 0 9 7 0 1 1 18 0',arrow:'M4 20 20 4M9 4h11v11',
 pen:'m4 16 12-12 4 4L8 20H4v-4Zm9-9 4 4',mosaic:'M3 3h6v6H3zM15 3h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z',
 text:'M4 5V3h16v2M12 3v18M8 21h8',undo:'M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12',redo:'m15 4 5 5-5 5M20 9H10a6 6 0 0 0 0 12',
 reselect:'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 7h10v10H7z',save:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',close:'m6 6 12 12M6 18 18 6',complete:'m4 12 5 5L20 6'
}
export function ScreenshotToolIcon({name}:{name:ScreenshotIcon}) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg> }
