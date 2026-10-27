import {act,create} from 'react-test-renderer'
import {describe,expect,it} from 'vitest'
import {ArkmeMessageContent} from '../src/client/ArkmeRichContent.js'
import {ArkmeMediaAccessContext} from '../src/client/media-access.js'
import {galleryImageDimensions,rememberGalleryImageDimensions,singleGalleryImageSize} from '../src/client/media-gallery-layout.js'

const photo=(ref:string)=>({kind:'image' as const,mediaRef:ref,fileName:ref+'.png',mimeType:'image/png',size:1,sortOrder:0})
const item=(refs:string[])=>({itemUid:refs.join(','),senderName:'我',isMe:true,sendAtMillis:1,status:1,title:'',textContent:'',contentBlocks:refs.map(photo)})

describe('message image proportions',()=>{
 it('preserves a landscape screenshot and its cached size when reopening, without changing video layout',async()=>{
  let view:ReturnType<typeof create>|undefined
  try{
   await act(async()=>{view=create(<ArkmeMessageContent item={item(['wide-size-test'])}/> )})
   const grid=()=>view!.root.findByProps({'data-arkme-media-count':1})
   await act(async()=>view!.root.findByType('img').props.onLoad({currentTarget:{naturalWidth:1341,naturalHeight:233}}))
   expect(grid().props.style.width).toBe(360)
   const button=grid().findByType('button')
   const [width,height]=button.props.style.aspectRatio.split(' / ').map(Number)
   expect(width/height).toBeCloseTo(1341/233)
   expect(view!.root.findByType('img').props.style.objectFit).toBe('contain')
   await act(async()=>view!.unmount())
   await act(async()=>{view=create(<ArkmeMessageContent item={item(['wide-size-test'])}/> )})
   expect(grid().props.style.width).toBe(360)
   await act(async()=>view!.update(<ArkmeMessageContent item={{...item(['movie-size-test']),contentBlocks:[{...photo('movie-size-test'),kind:'video',durationSec:18}]}}/>))
   expect(grid().props.style.width).toBe(150)
   expect(grid().findByType('button').props.style.aspectRatio).toBe('1')
  }finally{if(view)await act(async()=>view!.unmount())}
 })

 it('keeps a mixed gallery uniform while containing long images and cropping ordinary photos',async()=>{
  let view:ReturnType<typeof create>|undefined
  try{
   await act(async()=>{view=create(<ArkmeMessageContent item={item(['grid-wide-test','grid-photo-test'])}/> )})
   await act(async()=>{
    const images=view!.root.findAllByType('img')
    images[0]!.props.onLoad({currentTarget:{naturalWidth:1800,naturalHeight:300}})
    images[1]!.props.onLoad({currentTarget:{naturalWidth:1200,naturalHeight:900}})
   })
   const grid=view!.root.findByProps({'data-arkme-media-count':2})
   expect(grid.props.style.width).toBe(155)
   expect(grid.props.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
   expect(grid.findAllByType('button').map(b=>b.props.style.aspectRatio)).toEqual(['1','1'])
   expect(grid.findAllByType('img').map(img=>img.props.style.objectFit)).toEqual(['contain','cover'])
   expect(grid.findAllByProps({'data-arkme-long-image':true})).toHaveLength(1)
  }finally{if(view)await act(async()=>view!.unmount())}
 })

 it('retains the single image frame on failure and retry',async()=>{
  let view:ReturnType<typeof create>|undefined
  try{
   await act(async()=>{view=create(<ArkmeMessageContent item={item(['retry-wide-size-test'])}/> )})
   await act(async()=>view!.root.findByType('img').props.onLoad({currentTarget:{naturalWidth:900,naturalHeight:150}}))
   const ratio=view!.root.findByProps({'data-arkme-media-count':1}).findByType('button').props.style.aspectRatio
   await act(async()=>view!.root.findByType('img').props.onError())
   const fallback=view!.root.findByProps({'data-arkme-media-fallback':'image'})
   expect(fallback.props.style.aspectRatio).toBe(ratio)
   await act(async()=>fallback.props.onClick())
   expect(view!.root.findByProps({'data-arkme-media-count':1}).findByType('button').props.style.aspectRatio).toBe(ratio)
  }finally{if(view)await act(async()=>view!.unmount())}
 })

 it('does not reuse image sizes across different owners media URLs',async()=>{
  let view:ReturnType<typeof create>|undefined
  const render=(owner:string)=><ArkmeMediaAccessContext.Provider value={{url:block=>`/${owner}/${block.mediaRef}`}}><ArkmeMessageContent item={item(['same-ref-size-test'])}/></ArkmeMediaAccessContext.Provider>
  try{
   await act(async()=>{view=create(render('owner-a'))})
   await act(async()=>view!.root.findByType('img').props.onLoad({currentTarget:{naturalWidth:1200,naturalHeight:200}}))
   expect(view!.root.findByProps({'data-arkme-media-count':1}).props.style.width).toBe(360)
   await act(async()=>view!.update(render('owner-b')))
   expect(view!.root.findByProps({'data-arkme-media-count':1}).props.style.width).toBe(150)
  }finally{if(view)await act(async()=>view!.unmount())}
 })

 it('bounds extreme previews, rejects missing dimensions and caps the size cache',()=>{
  for(const dimensions of [{width:100,height:10000},{width:10000,height:100},{width:1200,height:900}]){
   const size=singleGalleryImageSize(dimensions)
   expect(size.width).toBeGreaterThanOrEqual(48);expect(size.width).toBeLessThanOrEqual(360)
   expect(size.height).toBeGreaterThanOrEqual(48);expect(size.height).toBeLessThanOrEqual(280)
  }
  expect(rememberGalleryImageDimensions('invalid-size',0,900)).toBeUndefined()
  expect(rememberGalleryImageDimensions('invalid-size',NaN,900)).toBeUndefined()
  for(let index=0;index<257;index++)rememberGalleryImageDimensions(`bounded-size-${index}`,100,100)
  expect(galleryImageDimensions('bounded-size-0')).toBeUndefined()
  expect(galleryImageDimensions('bounded-size-256')).toEqual({width:100,height:100})
 })
})
