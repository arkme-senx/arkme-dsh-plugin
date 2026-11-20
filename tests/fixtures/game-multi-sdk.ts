// Isolated multi-window smoke transport. Every window runs the real game runtime and WebCrypto.
const EVENT = { MESSAGE_RECEIVED:'message', SDK_READY:'ready', SDK_NOT_READY:'notready', KICKED_OUT:'kicked' }
class SDK {
  private listeners = new Map<string,Set<(event:any)=>void>>()
  private channel = (window as any).__gameTestSend ? undefined : new BroadcastChannel('arkme-isolated-game-smoke')
  private ready=false
  private user=''
  private history:any[]=[]
  private disconnect=()=>{this.ready=false;this.emit('kicked',{})}
  constructor(){
    const deliver=(data:any)=>{if(this.ready&&data.from!==this.user){if(data.type==='TIMTextElem')this.history.push(data);this.emit('message',[data])}}
    ;(window as any).__gameTestDeliver=deliver
    if(this.channel)this.channel.onmessage=({data})=>deliver(data)
    window.addEventListener('game-test-disconnect',this.disconnect)
  }
  private emit(name:string,data:any){for(const fn of this.listeners.get(name)??[])fn({data})}
  on(name:string,fn:(event:any)=>void){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name)!.add(fn)}
  off(name:string,fn:(event:any)=>void){this.listeners.get(name)?.delete(fn)}
  setLogLevel(){}
  isReady(){return this.ready}
  async login({userID}:{userID:string}){this.user=userID;this.ready=true;this.emit('ready',{})}
  createTextMessage(value:any){return {...value,ID:crypto.randomUUID(),from:this.user,type:'TIMTextElem'}}
  createCustomMessage(value:any){return {...value,ID:crypto.randomUUID(),from:this.user,type:'TIMCustomElem'}}
  async sendMessage(message:any){
    if(!this.ready)throw Error('test transport offline')
    if(message.type==='TIMTextElem')this.history.push(message)
    // Retain packet metadata for assertions without logging private payloads.
    const w=window as any;w.__sentGamePackets??=[];w.__sentGamePackets.push(message)
    if((window as any).__gameTestSend)await (window as any).__gameTestSend(message);else this.channel?.postMessage(message)
    return {data:{message}}
  }
  async getMessageList(){return {data:{messageList:this.history.slice(-50),isCompleted:true}}}
  async destroy(){window.removeEventListener('game-test-disconnect',this.disconnect);this.channel?.close();delete (window as any).__gameTestDeliver;this.listeners.clear();this.ready=false}
}
export default {create:()=>new SDK(),EVENT,TYPES:{CONV_GROUP:'GROUP'}}
