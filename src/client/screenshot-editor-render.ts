import type { Annotation, Rect } from './screenshot-editor-model.js'
import { canvasPng } from './browser-screenshot.js'
export function paintScreenshot(canvas:HTMLCanvasElement,image:CanvasImageSource,marks:Annotation[],selection?:Rect) {
 const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('无法创建截图画布')
 ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0,canvas.width,canvas.height)
 ctx.save()
 if(selection) { ctx.beginPath(); ctx.rect(selection.x,selection.y,selection.width,selection.height); ctx.clip() }
 for(const mark of marks) {
  const first=mark.points[0],last=mark.points.at(-1); if(!first || !last) continue
  ctx.save(); ctx.strokeStyle=mark.color;ctx.fillStyle=mark.color;ctx.lineWidth=mark.size;ctx.lineCap='round';ctx.lineJoin='round'
  const x=Math.min(first.x,last.x),y=Math.min(first.y,last.y),w=Math.abs(last.x-first.x),h=Math.abs(last.y-first.y)
  ctx.beginPath()
  if(mark.tool==='rectangle') { ctx.strokeRect(x,y,w,h) }
  else if(mark.tool==='ellipse') { ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,2*Math.PI);ctx.stroke() }
  else if(mark.tool==='arrow') {
   const dx=last.x-first.x,dy=last.y-first.y,distance=Math.hypot(dx,dy)
   if(distance>0) {
    const ux=dx/distance,uy=dy/distance
    const depth=Math.min(Math.max(12,mark.size*4)*Math.cos(.45),distance),halfWidth=depth*Math.tan(.45)
    const base={x:last.x-ux*depth,y:last.y-uy*depth}
    // End the rounded shaft inside the head's base, never at its sharp tip.
    // Very short gestures draw only the proportionally shortened head.
    if(distance>depth+mark.size/2){ctx.moveTo(first.x,first.y);ctx.lineTo(base.x,base.y);ctx.stroke()}
    ctx.beginPath();ctx.moveTo(last.x,last.y)
    ctx.lineTo(base.x-uy*halfWidth,base.y+ux*halfWidth)
    ctx.lineTo(base.x+uy*halfWidth,base.y-ux*halfWidth);ctx.closePath();ctx.fill()
   }
  } else if(mark.tool==='text') {
   ctx.font=`${mark.size}px sans-serif`;ctx.textBaseline='top'
   mark.text.split('\n').forEach((line,index)=>ctx.fillText(line,first.x,first.y+index*mark.size*1.3))
  } else if(mark.tool==='pen') {
   ctx.moveTo(first.x,first.y); for(const point of mark.points) ctx.lineTo(point.x,point.y)
   if(mark.points.length===1) {ctx.arc(first.x,first.y,mark.size/2,0,Math.PI*2);ctx.fill()} else ctx.stroke()
  } else {
   // Bake coarse pixels into the exported bitmap; no original image or editing metadata is exported.
   const small=document.createElement('canvas');small.width=Math.max(1,Math.ceil(canvas.width/mark.size));small.height=Math.max(1,Math.ceil(canvas.height/mark.size))
   const pixels=small.getContext('2d');if(!pixels) throw new Error('无法生成马赛克')
   pixels.drawImage(canvas,0,0,small.width,small.height)
   // Square brush dabs keep the mosaic opaque along its entire path.
   const radius=mark.size*2
   for(let i=0;i<mark.points.length;i++) {
    const a=mark.points[Math.max(0,i-1)]!,b=mark.points[i]!,steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/radius))
    for(let n=0;n<=steps;n++) ctx.rect(a.x+(b.x-a.x)*n/steps-radius,a.y+(b.y-a.y)*n/steps-radius,radius*2,radius*2)
   }
   ctx.clip();ctx.imageSmoothingEnabled=false;ctx.drawImage(small,0,0,canvas.width,canvas.height)
  }
  ctx.restore()
 }
 ctx.restore()
}
export async function exportScreenshot(canvas:HTMLCanvasElement,selection:Rect):Promise<Blob> {
 const x=Math.max(0,Math.floor(selection.x)),y=Math.max(0,Math.floor(selection.y))
 const output=document.createElement('canvas');output.width=Math.min(canvas.width-x,Math.ceil(selection.x+selection.width)-x);output.height=Math.min(canvas.height-y,Math.ceil(selection.y+selection.height)-y)
 if(output.width<2 || output.height<2) throw new Error('请先框选截图区域')
 const ctx=output.getContext('2d');if(!ctx) throw new Error('无法导出截图')
 ctx.drawImage(canvas,x,y,output.width,output.height,0,0,output.width,output.height)
 return canvasPng(output)
}
