import { it, expect, vi } from 'vitest'
import { MediaService } from '../src/services/media-service.js'
import { projectRecordRecordingForward } from '../src/recording-forward-presentation.js'
it('retains audio availability without exposing clip identity or delivery URL', () => {
 const raw={forward_records:{render_kind:'forward_records',forward_id:'f',source_type:'long_recording_segments',items:[{recording_audio:{clip_id:'a'.repeat(64),revision:'b'.repeat(64),duration_millis:1000,size:100},long_recording_segments:[{start_millis:1000,end_millis:2000,text:'selected'}]}]}}
 const out=projectRecordRecordingForward(raw)!
 expect(out.forwardId).toBe('f'); expect(out.items[0]?.recordingAudioAvailable).toBe(true)
 expect(JSON.stringify(out)).not.toContain('clip_id'); expect(JSON.stringify(out)).not.toContain('revision')
 raw.forward_records.items[0]!.recording_audio.duration_millis=999
 expect(projectRecordRecordingForward(raw)?.items[0]?.recordingAudioAvailable).toBeUndefined()
})
it('permits only frozen audio on the current environment host and isolates the grant by account', async () => {
 let userId=7
 const fetchImpl=vi.fn(async () => new Response('clip',{status:206,headers:{'content-type':'audio/flac'}}))
 const runtime={config:{environment:'prod'},requireSession:async()=>({userId}),fetchImpl}
 const media=new MediaService(runtime as never,{} as never,{} as never,{} as never)
 const url=`https://jotmo-useraudio.oss-cn-hangzhou.aliyuncs.com/world-excerpts/7/${'a'.repeat(64)}.flac?Signature=opaque`
 const ref=media.issueForwardRecordingMediaRef(7,url,100)
 const signal=new AbortController().signal
 expect((await media.fetchMedia(ref,'bytes=0-9',signal)).response.status).toBe(206)
 expect(fetchImpl).toHaveBeenCalledWith(new URL(url),{headers:{Range:'bytes=0-9'},redirect:'error',signal})
 for (const bad of [url.replace('https:','http:'),url.replace('jotmo-useraudio.','jotmo-useraudio-test.'),url.replace('/world-excerpts/','/other/'),url.replace('.flac','.mp3'),url.replace('https://','https://user@'),url.replace('/7/','/%zz/')]) expect(()=>media.issueForwardRecordingMediaRef(7,bad,100)).toThrow()
 expect(()=>media.issueForwardRecordingMediaRef(7,url,21*1024*1024)).toThrow()
 userId=8;await expect(media.fetchMedia(ref)).rejects.toMatchObject({code:'media-ref-invalid'})
 expect(fetchImpl).toHaveBeenCalledOnce();media.dispose()
})
