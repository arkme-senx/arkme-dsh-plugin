import {join} from 'node:path'
const fixtureDir=process.env.ARKME_T22_FIXTURE_DIR
if(!fixtureDir)throw new Error('ARKME_T22_FIXTURE_DIR is required')
import {createServer} from 'node:https'
import {readFile,writeFile} from 'node:fs/promises'
const ready=JSON.parse(await readFile(join(fixtureDir,'ready.json'),'utf8'))
const contacts=[99001002,99001003,99001004]
const api=createServer({key:await readFile(join(fixtureDir,'tls.key')),cert:await readFile(join(fixtureDir,'tls.crt'))},async(req,res)=>{
 try{
 const chunks=[];for await(const c of req)chunks.push(c)
 const input=JSON.parse(Buffer.concat(chunks).toString()||'{}'),path=new URL(req.url,'https://localhost').pathname
 if(path.startsWith('/api/v1/team/')){const response=await fetch(ready.url+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ready.owner_token},body:JSON.stringify(input)});res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());return}
 let data={items:[],users:[],sources:[],has_more:false}
 if(path.endsWith('/the-best-api-for-testing'))data={access_token:ready.owner_token,refresh_token:'t22-isolated'}
 else if(path.endsWith('/get-user-info'))data={user_id:99001001,nick_name:'批量验收',jotmo_id:'t22_owner',phone:'13800000000'}
 else if(path.endsWith('/contacts/list'))data={items:contacts.map(user_id=>({user_id,remark:`同事${user_id}`,chat_session_uid:`private-${user_id}`})),has_more:false}
 else if(path.endsWith('/get-public-users-by-ids'))data={items:(input.user_ids??[]).map(user_id=>({user_id,nick_name:`同事${user_id}`,jotmo_id:`user_${user_id}`}))}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:200,data}))
 }catch(error){res.writeHead(500);res.end(JSON.stringify({message:error.message}))}
})
const overlay=JSON.parse(await readFile(join(fixtureDir,'overlay.json'),'utf8'));
api.listen(Number(new URL(overlay[0].config.authBaseUrl).port),'127.0.0.1',async()=>{await writeFile(join(fixtureDir,'api-ready.json'),JSON.stringify({url:`https://127.0.0.1:${api.address().port}`}))})
