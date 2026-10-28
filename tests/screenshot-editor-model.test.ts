import { expect, it } from 'vitest';
import { rectBetween, moveSelection, resizeSelection, imagePoint, historyStep, type Annotation } from '../src/client/screenshot-editor-model.js';
it('maps CSS coordinates to actual image pixels including unequal scale', () => {
 expect(imagePoint(75, 50, {left:25,top:10,width:100,height:80}, 200, 240)).toEqual({x:100,y:120});
 expect(imagePoint(-1, 500, {left:0,top:0,width:100,height:100}, 200, 200)).toEqual({x:0,y:200});
});
it('normalizes reverse selections, clamps movement and permits edge resizing', () => {
 expect(rectBetween({x:80,y:70},{x:10,y:20})).toEqual({x:10,y:20,width:70,height:50});
 const rect={x:10,y:20,width:70,height:50};
 expect(moveSelection(rect,100,-100,100,100)).toEqual({x:30,y:0,width:70,height:50});
 expect(resizeSelection(rect,'se',{x:95,y:95},100,100)).toEqual({x:10,y:20,width:85,height:75});
});
it('undo/redo is per annotation and a new stroke discards redo', () => {
 const mark: Annotation={tool:'pen',points:[{x:1,y:2}],color:'#ff0000',size:3,text:''};
 let h=historyStep({done:[],undone:[]},{type:'add',mark});
 h=historyStep(h,{type:'undo'}); expect(h.done).toHaveLength(0);
 h=historyStep(h,{type:'redo'}); expect(h.done).toEqual([mark]);
 h=historyStep(h,{type:'undo'}); h=historyStep(h,{type:'add',mark:{...mark,color:'#000000'}});
 expect(h.undone).toHaveLength(0); expect(historyStep(h,{type:'reset'})).toEqual({done:[],undone:[]});
});
