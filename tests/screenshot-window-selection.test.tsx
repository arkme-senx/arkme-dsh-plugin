// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {ArkmeScreenshotEditor} from '../src/client/ArkmeScreenshotEditor.js';
const {exportImage}=vi.hoisted(()=>({exportImage:vi.fn(async()=>new Blob(['png']))}));
vi.mock('../src/client/screenshot-editor-render.js',()=>({paintScreenshot:vi.fn(),exportScreenshot:exportImage}));
let root:Root,host:HTMLDivElement;
const select=vi.fn(async()=>true);
const frame={blob:new Blob(['image']),width:1600,height:900};
const windows=[{x:200,y:200,width:400,height:300},{x:100,y:100,width:1000,height:600}];
async function mount(rects=windows){await act(async()=>root.render(<ArkmeScreenshotEditor frame={frame} desktop windows={rects} onSelect={select} onClose={()=>{}} onComplete={()=>{}}/>));}
async function pointer(type:string,x:number,y:number){await act(async()=>{
 const e=new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});Object.defineProperty(e,'pointerId',{value:1});
 host.querySelector('[data-arkme-screenshot-stage]')!.dispatchEvent(e);
});}
const selected=()=>host.querySelector<HTMLElement>('[data-arkme-screenshot-selection]');
const hover=()=>host.querySelector<HTMLElement>('[data-arkme-screenshot-window-hover]');
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 vi.stubGlobal('Image',class {onload?:()=>void;set src(v:string){queueMicrotask(()=>this.onload?.())}});
 vi.stubGlobal('URL',{createObjectURL:()=> 'blob:mock',revokeObjectURL:()=>{}});
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:800,height:450} as DOMRect);
 HTMLElement.prototype.setPointerCapture=()=>{};HTMLElement.prototype.releasePointerCapture=()=>{};
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('highlights the foremost hit window and click exports precisely its bounds despite pointer jitter',async()=>{
 await mount();await pointer('pointermove',150,150);
 expect(hover()?.style.left).toBe('100px');expect(hover()?.style.width).toBe('200px');expect(selected()).toBeNull();
 await pointer('pointerdown',150,150);await pointer('pointerup',152,151);
 expect(selected()?.style.width).toBe('200px');expect(select).toHaveBeenCalledOnce();expect(hover()).toBeNull();
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="完成"]')!.click());
 expect(exportImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement),windows[0]);
});
it('dragging from a highlighted window creates a custom region and never snaps back',async()=>{
 await mount();await pointer('pointermove',150,150);await pointer('pointerdown',150,150);await pointer('pointermove',300,250);await pointer('pointerup',300,250);
 expect(selected()?.style.left).toBe('150px');expect(selected()?.style.width).toBe('150px');expect(select).toHaveBeenCalledOnce();
});
it('keeps a drag after moving out and back near its start',async()=>{
 await mount();await pointer('pointerdown',150,150);await pointer('pointermove',300,250);await pointer('pointerup',152,152);
 expect(selected()?.style.width).toBe('2px');
});
it('manual selection works without native window data and empty clicks do not lock the screen',async()=>{
 await mount([]);await pointer('pointerdown',150,150);await pointer('pointerup',150,150);expect(selected()).toBeNull();expect(select).not.toHaveBeenCalled();
 await pointer('pointerdown',150,150);await pointer('pointerup',300,250);expect(selected()?.style.width).toBe('150px');expect(select).toHaveBeenCalledOnce();
});
it('reselect restores hover and pointer cancellation does not accept a candidate',async()=>{
 await mount();await pointer('pointerdown',150,150);await pointer('pointercancel',150,150);expect(select).not.toHaveBeenCalled();
 await pointer('pointerdown',150,150);await pointer('pointerup',150,150);
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="重选"]')!.click());
 await pointer('pointermove',150,150);expect(hover()).not.toBeNull();expect(selected()).toBeNull();
});
it('can move the snapped selection using a final pointerup position',async()=>{
 await mount();await pointer('pointerdown',150,150);await pointer('pointerup',150,150);
 await pointer('pointerdown',150,150);await pointer('pointerup',200,170);
 expect(selected()?.style.left).toBe('150px');expect(selected()?.style.top).toBe('120px');expect(select).toHaveBeenCalledOnce();
});

const bar=()=>host.querySelector<HTMLElement>('[role="toolbar"]')!;
const grip=()=>host.querySelector<HTMLButtonElement>('[aria-label="拖动截图工具栏"]')!;
async function gripPointer(type:string,x:number,y:number,id=9){await act(async()=>{
 const e=new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});Object.defineProperty(e,'pointerId',{value:id});
 grip().dispatchEvent(e);
});}
async function selectWindow(){await mount();await pointer('pointerdown',150,150);await pointer('pointerup',150,150);}
it('drags the whole toolbar with its handle without moving or exporting the selection',async()=>{
 await selectWindow();expect(grip()).not.toBeNull();
 const before=selected()!.style.cssText;
 const left=parseFloat(bar().style.left),top=parseFloat(bar().style.top);
 await gripPointer('pointerdown',120,280);await gripPointer('pointermove',180,320);await gripPointer('pointerup',200,330);
 expect(parseFloat(bar().style.left)).toBe(left+80);expect(parseFloat(bar().style.top)).toBe(top+50);
 expect(selected()!.style.cssText).toBe(before);expect(exportImage).not.toHaveBeenCalled();
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="矩形"]')!.click());
 expect(host.querySelector('[aria-label="矩形"]')!.getAttribute('aria-pressed')).toBe('true');
 expect(parseFloat(bar().style.left)).toBe(left+80);expect(parseFloat(bar().style.top)).toBe(top+50);
});
it('keeps the toolbar on screen and releases dragging after cancellation',async()=>{
 await selectWindow();expect(grip()).not.toBeNull();
 await gripPointer('pointerdown',120,280);await gripPointer('pointermove',-2000,-2000);
 expect(bar().style.left).toBe('8px');expect(bar().style.top).toBe('8px');
 await gripPointer('pointercancel',-2000,-2000);await gripPointer('pointermove',200,200);
 expect(bar().style.left).toBe('8px');expect(bar().style.top).toBe('8px');
 await gripPointer('pointerdown',12,12);await gripPointer('pointerup',3000,3000);
 expect(parseFloat(bar().style.left)).toBeLessThan(window.innerWidth-8);
 expect(parseFloat(bar().style.top)).toBeLessThan(window.innerHeight-8);
});
it('ignores other pointers and resets toolbar placement when reselecting',async()=>{
 await selectWindow();expect(grip()).not.toBeNull();
 const left=bar().style.left,top=bar().style.top;
 await gripPointer('pointerdown',120,280);await gripPointer('pointermove',180,320,10);
 expect(bar().style.left).toBe(left);expect(bar().style.top).toBe(top);
 await gripPointer('pointerup',200,330);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="重选"]')!.click());
 await pointer('pointerdown',150,150);await pointer('pointerup',150,150);
 expect(bar().style.left).toBe(left);expect(bar().style.top).toBe(top);
});
it('exports the edited selection to Ask DSH without invoking completion or save',async()=>{
 const ask=vi.fn(async()=>{}),complete=vi.fn(),save=vi.fn();
 await act(async()=>root.render(<ArkmeScreenshotEditor frame={frame} desktop windows={windows} onClose={()=>{}} onComplete={complete} onSave={save} onAskDsh={ask}/>));
 await pointer('pointerdown',150,150);await pointer('pointerup',150,150);
 const button=host.querySelector<HTMLButtonElement>('[aria-label="问dsh"]');expect(button).not.toBeNull();
 await act(async()=>button!.click());
 expect(ask).toHaveBeenCalledWith(expect.any(Blob));expect(complete).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
 expect(exportImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement),windows[0]);
});
it('retains the selection and reports Ask DSH errors for retry',async()=>{
 const ask=vi.fn(async()=>{throw new Error('DSH 尚未就绪')});
 await act(async()=>root.render(<ArkmeScreenshotEditor frame={frame} desktop windows={windows} onClose={()=>{}} onComplete={()=>{}} onAskDsh={ask}/>));
 await pointer('pointerdown',150,150);await pointer('pointerup',150,150);
 const button=host.querySelector<HTMLButtonElement>('[aria-label="问dsh"]');expect(button).not.toBeNull();await act(async()=>button!.click());
 expect(host.querySelector('[role="alert"]')?.textContent).toBe('DSH 尚未就绪');expect(selected()).not.toBeNull();expect(button!.disabled).toBe(false);
});
