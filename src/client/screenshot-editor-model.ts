export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export type Tool = 'rectangle' | 'ellipse' | 'arrow' | 'pen' | 'mosaic' | 'text'
export interface Annotation { tool: Tool; points: Point[]; color: string; size: number; text: string }
export interface History { done: Annotation[]; undone: Annotation[] }
export type HistoryAction = {type:'add';mark:Annotation} | {type:'undo'|'redo'|'reset'}
export const clamp = (value: number, min: number, max: number) => Math.max(min,Math.min(max,value))
export function rectBetween(a: Point,b: Point): Rect { return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)} }
export function imagePoint(x:number,y:number,bounds:{left:number;top:number;width:number;height:number},width:number,height:number):Point {
 return {x:clamp((x-bounds.left)/bounds.width*width,0,width),y:clamp((y-bounds.top)/bounds.height*height,0,height)}
}
export function moveSelection(r:Rect,dx:number,dy:number,width:number,height:number):Rect {
 return {...r,x:clamp(r.x+dx,0,width-r.width),y:clamp(r.y+dy,0,height-r.height)}
}
export function resizeSelection(r:Rect,handle:string,p:Point,width:number,height:number):Rect {
 const a={x:handle.includes('w')?clamp(p.x,0,width):r.x,y:handle.includes('n')?clamp(p.y,0,height):r.y}
 const b={x:handle.includes('e')?clamp(p.x,0,width):r.x+r.width,y:handle.includes('s')?clamp(p.y,0,height):r.y+r.height}
 return rectBetween(a,b)
}
export function historyStep(state:History,action:HistoryAction):History {
 if(action.type==='reset') return {done:[],undone:[]}
 if(action.type==='add') return {done:[...state.done,action.mark],undone:[]}
 if(action.type==='undo') { const mark=state.done.at(-1); return mark?{done:state.done.slice(0,-1),undone:[...state.undone,mark]}:state }
 const mark=state.undone.at(-1); return mark?{done:[...state.done,mark],undone:state.undone.slice(0,-1)}:state
}

/** Ordered front to back by the host; half-open edges avoid two hits at a shared border. */
export function windowAtPoint(windows:readonly Rect[],p:Point):Rect|undefined {
 return windows.find(r=>[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>=2&&r.height>=2&&p.x>=r.x&&p.y>=r.y&&p.x<r.x+r.width&&p.y<r.y+r.height)
}
