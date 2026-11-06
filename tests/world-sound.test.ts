import {describe,it,expect,vi} from 'vitest'
import {WorldSoundPlayback} from '../src/client/world-sound-playback.js'
import {ArkmePluginError} from '../src/services/service.js'
import {worldSoundProjection,WorldSoundService} from '../src/services/world-sound-service.js'
import type {WorldSoundExcerpt} from '../src/world-sound-contract.js'
const excerpt:WorldSoundExcerpt={source:'recording',revision:'a'.repeat(64),durationMillis:3000,segments:[{text:'第一段',speaker:'说话人 1',offsetMillis:0,durationMillis:1000,omittedBefore:false,audioUrl:'/media/a'},{text:'另一段',speaker:'说话人 2',offsetMillis:1000,durationMillis:2000,omittedBefore:true,audioUrl:'/media/b'}]}
function audio(url:string){return {url,currentTime:0,preload:'',onended:null,onerror:null,onplaying:null,onwaiting:null,ontimeupdate:null,onloadedmetadata:null,play:vi.fn().mockResolvedValue(undefined),pause:vi.fn(),removeAttribute:vi.fn(),load:vi.fn()} as unknown as HTMLAudioElement}
describe('continuous original sound playback',()=>{
 it('plays all clips with one click, preloads only the next, and releases at the end',()=>{
  const clips:HTMLAudioElement[]=[],store=new WorldSoundPlayback(url=>{const v=audio(url);clips.push(v);return v})
  store.toggle('one',excerpt);expect(clips).toHaveLength(2);expect(clips[0]!.play).toHaveBeenCalledOnce();expect(clips[1]!.play).not.toHaveBeenCalled()
  clips[0]!.onended?.call(clips[0]!,new Event('ended'));expect(clips).toHaveLength(2);expect(clips[1]!.play).toHaveBeenCalledOnce();expect(store.snapshot('one').index).toBe(1)
  clips[1]!.onended?.call(clips[1]!,new Event('ended'));expect(store.snapshot('one').position).toBe(0);expect(clips[1]!.removeAttribute).toHaveBeenCalledWith('src')
 })
 it('seeks on the concatenated timeline, stops the previous card, and ignores stale events',()=>{
  const clips:HTMLAudioElement[]=[],store=new WorldSoundPlayback(url=>{const v=audio(url);clips.push(v);return v})
  store.toggle('one',excerpt);const old=clips[0]!.onended!
  store.seek('two',excerpt,1500);expect(store.snapshot('one').status).toBe('idle');expect(store.snapshot('two').index).toBe(1);expect(clips.at(-1)!.currentTime).toBe(.5)
  old.call(clips[0]!,new Event('ended'));expect(store.snapshot('two').position).toBe(1500);expect(clips[0]!.pause).toHaveBeenCalled();store.stop()
 })
 it('releases buffers after unmount, while keeping playback across feed/detail consumers',async()=>{
  const store=new WorldSoundPlayback(audio),a=store.subscribe('one',()=>{}),b=store.subscribe('one',()=>{})
  store.toggle('one',excerpt);a();await Promise.resolve();expect(store.snapshot('one').status).toBe('loading');b();await Promise.resolve();expect(store.snapshot('one').status).toBe('idle')
 })
 it('surfaces unavailable or revoked media instead of silently skipping a selected clip',()=>{
  const clips:HTMLAudioElement[]=[],store=new WorldSoundPlayback(url=>{const v=audio(url);clips.push(v);return v})
  store.toggle('one',excerpt);clips[0]!.onerror?.call(clips[0]!,new Event('error'));expect(store.snapshot('one').status).toBe('failed');expect(clips[1]!.play).not.toHaveBeenCalled();store.stop()
 })
})
describe('sound contracts and account isolation',()=>{
 const wire={source:'call',revision:'b'.repeat(64),duration_ms:10,segments:[{text:'原话',speaker:'说话人 1',offset_ms:0,duration_ms:10,omitted_before:false,asset_key:'PRIVATE',audio_url:'PRIVATE'}]}
 it('returns only safe public metadata and rejects malformed or oversized timelines',()=>{
  expect(JSON.stringify(worldSoundProjection(wire))).not.toContain('PRIVATE')
  for(const data of [{...wire,duration_ms:11},{...wire,source:'video'},{...wire,segments:[{...wire.segments[0],offset_ms:1}]},{...wire,segments:[{...wire.segments[0],duration_ms:0}]},{...wire,revision:'not-versioned'}])expect(()=>worldSoundProjection(data)).toThrow()
 })
 it('rejects a cross-account request before source resolution or remote IO',async()=>{
  const runtime={config:{environment:'test'},stateStore:{uniqueCode:async()=> 'secret'},requireSession:async()=>({userId:1})} as never
  const source=vi.fn();const service=new WorldSoundService(runtime,{recording:source,call:source,team:source,recordUID:source,recordRef:source})
  await expect(service.execute({accountKey:'test:2',action:'capabilities'})).rejects.toThrow();expect(source).not.toHaveBeenCalled()
 })
 it('does not dispatch an old-account withdrawal after slow reference resolution switches accounts',async()=>{
  let actor=1
  const post=vi.fn().mockResolvedValue({record_uid:'world-sound-'+'a'.repeat(64),check_status:2,public_requested:false,can_manage:true})
  const runtime={config:{environment:'test'},stateStore:{uniqueCode:async()=> 'secret'},requireSession:async()=>({userId:actor,refreshToken:String(actor)}),authenticatedWorldPost:post} as never
  const source=vi.fn();const recordUID=vi.fn(async()=>{actor=2;return 'world-sound-'+'a'.repeat(64)})
  const service=new WorldSoundService(runtime,{recording:source,call:source,team:source,recordUID,recordRef:async()=> 'safe-ref'})
  await expect(service.execute({accountKey:'test:1',action:'management',recordRef:'old-ref',withdraw:true})).rejects.toThrow()
  expect(post).not.toHaveBeenCalled()
 })
})

describe('frontend-first deployment readiness',()=>{
 it.each([404,501,503])('missing service %i stops before reading private source and can recover on retry',async status=>{
  const post=vi.fn().mockRejectedValueOnce(new ArkmePluginError('upstream','unavailable',false,status)).mockResolvedValueOnce({version:1,recording:true,call:false}).mockResolvedValueOnce({source:'recording',revision:'b'.repeat(64),duration_ms:10,segments:[{text:'original',speaker:'speaker',offset_ms:0,duration_ms:10,omitted_before:false}]});
  const source=vi.fn().mockResolvedValue({source:'recording',session_id:'private',segments:[]});
  const runtime={config:{environment:'test'},stateStore:{uniqueCode:async()=> 'secret'},requireSession:async()=>({userId:1}),authenticatedWorldPost:post} as never;
  const service=new WorldSoundService(runtime,{recording:source,call:source,team:source,recordUID:source,recordRef:source});const request={accountKey:'test:1',action:'prepare' as const,selection:{kind:'recording' as const,itemRefs:['selected']}};
  await expect(service.execute(request)).rejects.toMatchObject({message:expect.stringContaining('内容尚未发布')});expect(source).not.toHaveBeenCalled();
  await expect(service.execute(request)).resolves.toMatchObject({excerpt:{source:'recording'}});expect(source).toHaveBeenCalledTimes(1);
 });
 it('keeps authentication failures distinct from missing capabilities',async()=>{
  const error=new ArkmePluginError('unauthorized','请重新登录',false,401);const source=vi.fn();const runtime={config:{environment:'test'},stateStore:{uniqueCode:async()=> 'secret'},requireSession:async()=>({userId:1}),authenticatedWorldPost:vi.fn().mockRejectedValue(error)} as never;
  const service=new WorldSoundService(runtime,{recording:source,call:source,team:source,recordUID:source,recordRef:source});await expect(service.execute({accountKey:'test:1',action:'capabilities'})).rejects.toBe(error);
 });
});
