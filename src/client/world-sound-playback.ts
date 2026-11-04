import type {WorldSoundExcerpt} from '../world-sound-contract.js'
export interface SoundPlaybackState {key:string;status:'idle'|'loading'|'playing'|'paused'|'failed';position:number;index:number;error?:string}
const idle:SoundPlaybackState={key:'',status:'idle',position:0,index:0}
/** A single sound owner, with one current and at most one prefetched utterance. */
export class WorldSoundPlayback {
  private state=idle
  private active:HTMLAudioElement|undefined
  private next:HTMLAudioElement|undefined
  private generation=0
  private listeners=new Map<string,Set<()=>void>>()
  constructor(private createAudio:(url:string)=>HTMLAudioElement=url=>new Audio(url),private onStart:()=>void=()=>{}){}
  snapshot=(key:string)=>this.state.key===key?this.state:idle
  subscribe=(key:string,listener:()=>void)=>{
    const listeners=this.listeners.get(key)??new Set();listeners.add(listener);this.listeners.set(key,listeners)
    return ()=>{listeners.delete(listener);if(!listeners.size)this.listeners.delete(key);queueMicrotask(()=>{if(this.state.key===key&&!this.listeners.has(key))this.stop()})}
  }
  private emit(next:SoundPlaybackState){const previous=this.state.key;this.state=next;for(const key of new Set([previous,next.key]))for(const listener of this.listeners.get(key)??[])listener()}
  private release(audio:HTMLAudioElement|undefined){if(!audio)return;audio.onended=null;audio.onerror=null;audio.onplaying=null;audio.onwaiting=null;audio.ontimeupdate=null;audio.onloadedmetadata=null;audio.pause();audio.removeAttribute('src');audio.load()}
  stop=()=>{this.generation++;this.release(this.active);this.release(this.next);this.active=undefined;this.next=undefined;this.emit(idle)}
  toggle(key:string,excerpt:WorldSoundExcerpt){
    if(this.state.key===key&&this.state.status==='loading'){this.stop();return}
    if(this.state.key===key&&this.state.status==='playing'){this.active?.pause();this.emit({...this.state,status:'paused'});return}
    this.start(key,excerpt,this.state.key===key?this.state.position:0)
  }
  seek(key:string,excerpt:WorldSoundExcerpt,position:number){this.start(key,excerpt,Math.max(0,Math.min(excerpt.durationMillis-1,position)))}
  private start(key:string,excerpt:WorldSoundExcerpt,position:number){
    if(excerpt.segments.some(s=>!s.audioUrl)){this.stop();this.emit({key,status:'failed',position:0,index:0,error:'声音暂不可用，请刷新后重试'});return}
    this.onStart()
    const index=Math.max(0,excerpt.segments.findIndex(s=>position>=s.offsetMillis&&position<s.offsetMillis+s.durationMillis))
    const prepared=this.state.key===key&&index===this.state.index+1?this.next:undefined
    if(prepared)this.next=undefined
    this.stop();this.emit({key,status:'loading',position,index})
    const generation=this.generation,valid=()=>this.generation===generation
    const segment=excerpt.segments[index]!,audio=prepared??this.createAudio(segment.audioUrl!);this.active=audio
    const at=Math.max(0,(position-segment.offsetMillis)/1000)
    audio.onloadedmetadata=()=>{if(valid())audio.currentTime=at}
    audio.onplaying=()=>{if(valid())this.emit({...this.state,status:'playing'})}
    audio.onwaiting=()=>{if(valid())this.emit({...this.state,status:'loading'})}
    audio.ontimeupdate=()=>{if(valid())this.emit({...this.state,position:Math.min(excerpt.durationMillis,segment.offsetMillis+Math.round(audio.currentTime*1000))})}
    audio.onerror=()=>{if(!valid())return;const failed={...this.state,status:'failed' as const,error:'播放失败，请重试'};this.stop();this.emit(failed)}
    audio.onended=()=>{if(!valid())return;const following=excerpt.segments[index+1];if(following)this.start(key,excerpt,following.offsetMillis);else{this.release(this.active);this.release(this.next);this.active=undefined;this.next=undefined;this.emit({key,status:'paused',position:0,index:0})}}
    const following=excerpt.segments[index+1];if(following){this.next=this.createAudio(following.audioUrl!);this.next.preload='auto';this.next.load()}
    try{audio.currentTime=at;void audio.play().catch(()=>{if(valid())audio.onerror?.(new Event('error'))})}catch{audio.onerror?.(new Event('error'))}
  }
}
export const worldSoundPlayback=new WorldSoundPlayback(undefined,()=>{
  if(typeof window!=='undefined')window.dispatchEvent(new Event('arkme-world-sound-started'))
})
