import {createRoot} from 'react-dom/client'
import {ArkmeScreenshotEditor} from '../../src/client/ArkmeScreenshotEditor.js'
import {paintScreenshot,exportScreenshot} from '../../src/client/screenshot-editor-render.js'
import type {Annotation} from '../../src/client/screenshot-editor-model.js'
const qa=window as typeof window & {qa:any};qa.qa={asked:0,saved:0,completed:0,ready:false,errors:[]}
window.addEventListener('error',e=>qa.qa.errors.push(e.message))
const base=document.createElement('canvas');base.width=1200;base.height=800
const c=base.getContext('2d')!;c.fillStyle='#eef1f7';c.fillRect(0,0,1200,800)
c.fillStyle='#fff';c.fillRect(80,80,1040,640);c.fillStyle='#283b56';c.font='32px sans-serif';c.fillText('Arkme · 截图编辑',120,140)
c.font='20px sans-serif';c.fillStyle='#6b778b';c.fillText('框选后可添加标注，完成后加入草稿',120,190)
for(let y=260;y<580;y+=8)for(let x=130;x<620;x+=8){c.fillStyle=(Math.floor((x-130)/8)+Math.floor((y-260)/8))%2===0?'#ccd9ee':'#829bbb';c.fillRect(x,y,8,8)}
c.fillStyle='#deebfd';c.fillRect(700,260,340,120);c.fillStyle='#4d6c99';c.font='20px sans-serif';c.fillText('需要说明的位置',740,330)
qa.qa.pixelTest=async()=>{
 const canvas=document.createElement('canvas');canvas.width=base.width;canvas.height=base.height
 const mark=(tool:Annotation['tool'],points:{x:number;y:number}[],extra={})=>({tool,points,color:'#ff0000',size:8,text:'Text',...extra})
 const marks=[mark('rectangle',[{x:690,y:250},{x:1050,y:390}]),mark('ellipse',[{x:740,y:440},{x:970,y:560}]),mark('arrow',[{x:670,y:600},{x:970,y:600}]),mark('pen',[{x:720,y:660},{x:920,y:660}]),mark('text',[{x:700,y:410}],{size:24}),mark('mosaic',[{x:300,y:400},{x:450,y:400}],{size:20})]
 paintScreenshot(canvas,base,marks,{x:100,y:200,width:980,height:500})
 const ctx=canvas.getContext('2d')!,red=(x:number,y:number)=>{const p=ctx.getImageData(x,y,1,1).data;return p[0]!>200&&p[1]!<60}
 if(!red(690,280)||!red(855,440)||!red(800,600)||!red(800,660))throw new Error('shape/arrow/pen pixels missing')
 const original=c.getImageData(280,380,200,40).data,pixel=ctx.getImageData(280,380,200,40).data
 if(original.every((v,i)=>v===pixel[i]))throw new Error('mosaic unchanged')
 const blob=await exportScreenshot(canvas,{x:100,y:200,width:980,height:500});const bitmap=await createImageBitmap(blob)
 if(bitmap.width!==980||bitmap.height!==500)throw new Error('incorrect export dimensions')
 qa.qa.pixelExport=await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(blob)})
 bitmap.close();return {width:980,height:500,mosaic:true,shapes:true}
}
base.toBlob(blob=>{
 createRoot(document.getElementById('root')!).render(<ArkmeScreenshotEditor frame={{blob:blob!,width:1200,height:800}} desktop windows={[{x:700,y:260,width:340,height:120},{x:80,y:80,width:1040,height:640}]}
 onClose={()=>{qa.qa.closed=true}} onReady={()=>{qa.qa.ready=true}} onSelect={async()=>true}
 onAskDsh={async blob=>{qa.qa.asked++;qa.qa.askSize=blob.size}}
 onSave={async()=>{qa.qa.saved++;return true}} onComplete={async blob=>{qa.qa.completed++;qa.qa.outputSize=blob.size}}/>)
},'image/png')

qa.qa.arrowPixelTest=()=>{
 const background=document.createElement('canvas');background.width=360;background.height=360
 const bg=background.getContext('2d')!;bg.fillStyle='#fff';bg.fillRect(0,0,360,360)
 const canvas=document.createElement('canvas');canvas.width=360;canvas.height=360
 let cases=0
 for(const size of [8,2,16])for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2,-Math.PI/3,Math.PI/4])for(const length of [120,8]){
  const direction={x:Math.cos(angle),y:Math.sin(angle)},start={x:180,y:180},end={x:start.x+direction.x*length,y:start.y+direction.y*length}
  paintScreenshot(canvas,background,[{tool:'arrow',points:[start,end],color:'#ff0000',size,text:''}])
  const pixels=canvas.getContext('2d')!.getImageData(0,0,360,360).data
  let count=0
  for(let y=0;y<360;y++)for(let x=0;x<360;x++){
   const index=(y*360+x)*4
   if(pixels[index]!>200&&pixels[index+1]!<80&&pixels[index+2]!<80){
    count++
    if((x+.5-end.x)*direction.x+(y+.5-end.y)*direction.y>1)throw new Error(`Arrow extends beyond tip: size=${size}, angle=${angle}, length=${length}`)
    if((x+.5-start.x)*direction.x+(y+.5-start.y)*direction.y < -size/2-1)throw new Error('Short arrow extends backwards')
   }
  }
  if(!count)throw new Error('Arrow missing')
  cases++
 }
 paintScreenshot(canvas,background,[{tool:'arrow',points:[{x:180,y:180},{x:180,y:180}],color:'#ff0000',size:16,text:''}])
 const empty=canvas.getContext('2d')!.getImageData(0,0,360,360).data
 if(empty.some((value,index)=>index%4!==3&&value!==255))throw new Error('Zero-length arrow must not leave a malformed head')
 paintScreenshot(canvas,background,[
  {tool:'arrow',points:[{x:40,y:220},{x:170,y:30}],color:'#f83e46',size:8,text:''},
  {tool:'arrow',points:[{x:120,y:330},{x:290,y:110}],color:'#f83e46',size:12,text:''},
 ])
 qa.qa.arrowPreview=canvas.toDataURL('image/png')
 return {cases,sharpTips:true,shortArrows:true,zeroLength:true}
}
