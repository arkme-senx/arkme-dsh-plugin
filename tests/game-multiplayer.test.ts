import {afterEach,expect,it,vi} from 'vitest'
const bus=vi.hoisted(()=>({clients:[] as any[],packets:[] as any[]}))
vi.mock('../src/client/game/im.js',()=>({GameIM:class{
 group:string;user='';receive:any;status:any
 constructor(_app:number,group:string,receive:any,status:any){this.group=group;this.receive=receive;this.status=status;bus.clients.push(this)}
 async login(user:string){this.user=user;this.status(true)}
 async send(packet:any){const message={ID:crypto.randomUUID(),from:this.user,to:this.group,conversationType:'GROUP',type:'TIMCustomElem',payload:{extension:'arkme.game.v1',data:JSON.stringify(packet)}};bus.packets.push(message);for(const c of bus.clients)if(c!==this&&c.group===this.group)c.receive(structuredClone(message))}
 async destroy(){bus.clients=bus.clients.filter(c=>c!==this)}async history(){return []}
}}))
import {GameRuntime} from '../src/client/game/runtime.js'
import type {Room,Reply} from '../src/client/game/contracts.js'
const settle=async()=>{for(let i=0;i<50;i++)await Promise.resolve()}
afterEach(()=>{vi.useRealTimers();bus.clients=[];bus.packets=[]})
it('synchronizes six players and a spectator, rejects observer and duplicate moves',async()=>{
 vi.useFakeTimers();let runtime='';const members=Array.from({length:7},(_,i)=>({membership_id:`m${i}`,user_id:i+1,client_id:1,registration_id:`u${i}`,binding_generation:'b',join_seq:i+1,status:'active' as const,lease_expires_at:Date.now()+60000}))
 const room:Room={room_id:'a'.repeat(32),game_type:'chinese_checkers',status:'open',runtime_id:'',host_membership_id:'m0',im_group_id:'g',members,membership_version:1}
 const clients=members.map((m,i)=>new GameRuntime(async(a,b)=>{if(a==='create'){runtime=String(b.runtime_id);room.runtime_id=runtime};for(const x of members)x.lease_expires_at=Date.now()+60000;return structuredClone({room,membership_id:m.membership_id,server_time:Date.now(),invite_token:'b'.repeat(64),credentials:{sdk_app_id:1,user_id:m.registration_id,user_sig:'fake',expires_at:Date.now()+3600000}} satisfies Reply)},()=>{},()=>{}))
 await clients[0]!.enter({kind:'create'});for(const c of clients.slice(1))await c.enter({kind:'join',roomId:room.room_id,token:'b'.repeat(64)})
 await vi.advanceTimersByTimeAsync(7000);await settle();expect(clients.every(c=>!!c.state)).toBe(true)
 for(const c of clients.slice(0,6)){await c.act('ready');await settle()}
 await clients[0]!.act('start');await settle();expect(clients.every(c=>!!c.state?.board)).toBe(true)
 const before=JSON.stringify(clients[0]!.state?.board);await clients[6]!.act('move',[[5,-4],[4,-4]]);await settle();expect(JSON.stringify(clients[0]!.state?.board)).toBe(before);expect(clients[6]!.error).not.toBe('')
 await clients[0]!.act('move',[[5,-4],[4,-4]]);await settle();expect(clients[0]!.state!.board!.turn).toBe(1)
 await clients[1]!.act('move',[[4,1],[4,0]]);await settle();const version=clients[0]!.state!.version
 const sent=bus.packets.filter(m=>m.from==='u1'&&JSON.parse(m.payload.data).type==='action').at(-1);expect(sent).toBeDefined();bus.clients[0].receive(sent);await settle();expect(clients[0]!.state!.version).toBe(version)
 expect(new Set(clients.map(c=>JSON.stringify(c.state?.board))).size).toBe(1)
 for(const c of clients)await c.leave()
})
