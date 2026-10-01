import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamCodexState } from '../src/team-codex-contract.js'
const mocks=vi.hoisted(()=>({callArkme:vi.fn(),writeText:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.callArkme}))
vi.mock('../src/client/ArkmeAvatar.js',()=>({ArkmeUserAvatar:()=>null}))
import { TeamCodexActivity } from '../src/client/redesign/contacts/TeamCodexActivity.js'

const teamRef=`team_v1_${'a'.repeat(32)}`
const self={userRef:`usr_v1_${'b'.repeat(32)}`,displayName:'我的昵称',jotmoId:'my_user',role:'member' as const,identityState:'ready' as const,joinedAtMillis:1}
const base: TeamCodexState={localOnly:true,self,installations:[],tasks:[{id:'connection-one',title:'改进测试',member:self,status:'active',state:'working',updatedAt:Date.now(),eventCount:1}]}
const text=(node:ReactTestInstance):string=>node.children.map(child=>typeof child==='string'?child:text(child)).join('')
const tick=async()=>{await Promise.resolve();await Promise.resolve()}
describe('Team Codex activity UI',()=>{
  let renderer:ReactTestRenderer|undefined
  beforeEach(()=>{
    mocks.callArkme.mockReset();mocks.writeText.mockReset()
    vi.stubGlobal('navigator',{clipboard:{writeText:mocks.writeText}})
    mocks.callArkme.mockImplementation(async (op:string)=>{
      if(op==='team.codex.state')return base
      if(op==='team.codex.invite')return {id:'invitation-one',instructions:'local instructions',expiresAt:Date.now()+10000}
      if(op==='team.codex.events')return {items:[{sequence:1,turnId:'turn',kind:'UserPromptSubmit',text:'我的请求',at:Date.now(),truncated:false}]}
      return {ok:true}
    })
  })
  afterEach(async()=>{await act(async()=>{renderer?.unmount();await tick()});vi.useRealTimers();vi.unstubAllGlobals()})
  const click=async(label:string)=>{await act(async()=>{const b=renderer!.root.findAllByType('button').find(b=>text(b)===label);expect(b).toBeDefined();b!.props.onClick();await tick()})}
  const selectTask=async()=>{await act(async()=>{renderer!.root.findByProps({className:'arkme-team-codex-task-toggle'}).props.onClick();await tick()})}
  const taskMenu=async()=>{await act(async()=>{renderer!.root.findByProps({'aria-label':'任务信息与操作'}).props.onClick();await tick()})}
  it('renders only sync controls in management mode even with existing tasks',async()=>{
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef} managementOnly/>);await tick()})
    expect(text(renderer!.root)).toContain('接入本机 Codex')
    expect(text(renderer!.root)).not.toContain('改进测试')
    expect(renderer!.root.findAllByProps({className:'arkme-codex-task-sidebar'})).toHaveLength(0)
    expect(renderer!.root.findAllByProps({className:'arkme-codex-conversation'})).toHaveLength(0)
    expect(mocks.callArkme.mock.calls.every(c=>c[0]==='team.codex.state')).toBe(true)
  })
  it('opens a member-scoped reader and preserves selection on a repeat navigation intent',async()=>{
    const props={teamRef,conversation:true,selfMember:'11',target:{accountKey:'prod:11',team:{teamRef,name:'团队',jotmoId:'team'},member:self.userRef,memberName:self.displayName}}
    await act(async()=>{renderer=create(<TeamCodexActivity {...props}/>);await tick()})
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.state',expect.objectContaining({memberRef:self.userRef}),expect.anything())
    expect(text(renderer!.root.findByProps({className:'arkme-codex-task-trigger'}))).toContain('改进测试')
    const transcript=renderer!.root.findByProps({className:'arkme-codex-transcript'})
    await act(async()=>{renderer!.update(<TeamCodexActivity {...props} target={{...props.target}}/>);await tick()})
    expect(renderer!.root.findByProps({className:'arkme-codex-transcript'})).toBe(transcript)
  })
  it('moves task management into the personal reader and writes only to the selected task team',async()=>{
    const task={...base.tasks[0]!,installationId:'device',projectKey:'project'}
    mocks.callArkme.mockImplementation(async op=>op==='team.codex.state'?{...base,tasks:[task]}:{items:[]})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef="" conversation personalTeams={[{teamRef,name:'Team A',jotmoId:'a'}]} selfMember="11"/>);await tick()})
    await taskMenu();await click('排除此任务')
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.change',{teamRef,id:task.id,action:'exclude'},expect.anything())
    await click('排除此项目')
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.change',{teamRef,id:'device',action:'exclude',projectKey:'project'},expect.anything())
    mocks.callArkme.mockClear()
    await click('删除本地记录')
    expect(mocks.callArkme).not.toHaveBeenCalled()
    await click('确认')
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.change',{teamRef,id:task.id,action:'delete'},expect.anything())
  })
  it('reapplies a member shortcut if that cached reader was subsequently switched to all members',async()=>{
    const props={teamRef,conversation:true,selfMember:'11',target:{accountKey:'prod:11',team:{teamRef,name:'团队',jotmoId:'team'},member:self.userRef,memberName:self.displayName}}
    mocks.callArkme.mockImplementation(async op=>op==='team.codex.state'?{...base,localOnly:false,cloud:{status:'ready',pending:0,blocked:0,page:1}}:{items:[]})
    await act(async()=>{renderer=create(<TeamCodexActivity {...props}/>);await tick()})
    await act(async()=>{renderer!.root.findByProps({'aria-label':'切换 Codex 任务',type:'button'}).props.onClick();await tick()})
    await act(async()=>{renderer!.root.findByProps({'aria-label':'筛选成员'}).props.onChange({target:{value:''}});await tick()})
    mocks.callArkme.mockClear()
    await act(async()=>{renderer!.update(<TeamCodexActivity {...props} target={{...props.target}}/>);await tick()})
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.state',expect.objectContaining({memberRef:self.userRef}),expect.anything())
  })
  it('hides a previously selected transcript when a refreshed member identity can no longer be verified',async()=>{
    vi.useFakeTimers()
    const target={accountKey:'prod:11',team:{teamRef,name:'团队',jotmoId:'team'},member:self.userRef}
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef} conversation target={target}/>);await tick()})
    expect(renderer!.root.findAllByProps({className:'arkme-codex-transcript'})).toHaveLength(1)
    mocks.callArkme.mockRejectedValue(new Error('无法核对身份'))
    await act(async()=>{await vi.advanceTimersByTimeAsync(3000);await tick()})
    expect(renderer!.root.findAllByProps({className:'arkme-codex-transcript'})).toHaveLength(0)
    expect(text(renderer!.root)).toContain('无法核对身份')
  })
  it('does not expose mutations for a remote colleague in the shared reader',async()=>{
    const task={...base.tasks[0]!,cloud:{taskId:'remote',sourceId:'device',sourceName:'电脑',ownerRef:'22',remote:true}}
    mocks.callArkme.mockImplementation(async op=>op==='team.codex.state'?{...base,tasks:[task]}:{items:[]})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef} conversation selfMember="11" target={{accountKey:'prod:11',team:{teamRef,name:'团队',jotmoId:'team'},member:'22'}}/>);await tick()})
    await taskMenu()
    expect(text(renderer!.root)).not.toContain('删除本地记录')
    expect(text(renderer!.root)).not.toContain('排除此任务')
  })
  it('mounts the helper entry in an own local conversation, with no write on click',async()=>{
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef="" conversation personalTeams={[{teamRef,name:'Team A',jotmoId:'a'}]} selfMember="11"/>);await tick()})
    expect(renderer!.root.findByType('textarea').props.readOnly).toBe(true)
    await act(async()=>{renderer!.root.findByType('textarea').props.onClick();await tick()})
    expect(text(renderer!.root.findByProps({role:'dialog'}))).toContain('助手派发功能接入中')
    expect(mocks.callArkme.mock.calls.every(call=>['team.codex.state','team.codex.events'].includes(call[0]))).toBe(true)
    await act(async()=>{renderer!.update(<TeamCodexActivity teamRef="" conversation personalTeams={[]} selfMember="11" active={false}/>);await tick()})
    expect(renderer!.root.findAllByProps({role:'dialog'})).toHaveLength(0)
  })
  it('auto-opens own recent task, hides member filters, and routes the transcript to its original team',async()=>{
    const teams=[{teamRef,name:'Team A',jotmoId:'a'},{teamRef:'team-b',name:'Team B',jotmoId:'b'}]
    const ownRemote={...base.tasks[0]!,id:'on-other-device',updatedAt:Date.now()+100,cloud:{taskId:'remote',sourceId:'device-b',sourceName:'Laptop B',ownerRef:'11',remote:true}}
    const other={...ownRemote,id:'colleague',cloud:{...ownRemote.cloud,ownerRef:'22'},member:{...self,userRef:'other',displayName:'同事'}}
    mocks.callArkme.mockImplementation(async(op:string,params:{teamRef:string})=>op==='team.codex.state' ? params.teamRef===teamRef ? base :
      {...base,localOnly:false,cloud:{status:'ready',pending:0,blocked:0,page:1},tasks:[ownRemote,other]} : {items:[]})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef="" conversation personalTeams={teams} selfMember="11"/>);await tick()})
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.state',{teamRef:'team-b',memberRef:'11',page:1},expect.anything())
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.events',expect.objectContaining({teamRef:'team-b',id:'on-other-device',sourceId:'device-b'}),expect.anything())
    await act(async()=>{renderer!.root.findByProps({'aria-label':'切换 Codex 任务',type:'button'}).props.onClick();await tick()})
    expect(renderer!.root.findAllByProps({'aria-label':'筛选成员'})).toHaveLength(0)
    expect(renderer!.root.findAllByProps({className:'arkme-team-codex-task-toggle'})).toHaveLength(2)
    expect(text(renderer!.root)).not.toContain('同事')
    expect(mocks.callArkme.mock.calls.some(call=>['team.codex.change','team.codex.invite'].includes(call[0]))).toBe(false)
  })
  it('keeps a chosen personal task and reading state across inactive team inspection',async()=>{
    const teams=[{teamRef,name:'Team A',jotmoId:'a'}]
    const second={...base.tasks[0]!,id:'older',title:'此前的任务',updatedAt:1}
    mocks.callArkme.mockImplementation(async(op:string)=>op==='team.codex.state'?{...base,tasks:[...base.tasks,second]}:{items:[]})
    const props={teamRef:'',conversation:true,personalTeams:teams,selfMember:'11'}
    await act(async()=>{renderer=create(<TeamCodexActivity {...props}/>);await tick()})
    await act(async()=>{renderer!.root.findByProps({'aria-label':'切换 Codex 任务',type:'button'}).props.onClick();await tick()})
    await act(async()=>{renderer!.root.findAllByProps({className:'arkme-team-codex-task-toggle'}).find(node=>text(node).includes('此前的任务'))!.props.onClick();await tick()})
    await act(async()=>{renderer!.update(<TeamCodexActivity {...props} active={false}/>);await tick()})
    await act(async()=>{renderer!.update(<TeamCodexActivity {...props} active/>);await tick()})
    expect(text(renderer!.root.findByProps({className:'arkme-codex-task-trigger'}))).toContain('此前的任务')
    await act(async()=>{renderer!.update(<TeamCodexActivity {...props} personalTeams={[]} active={false}/>);await tick()})
    expect(renderer!.root.findAllByProps({className:'arkme-codex-transcript'})).toHaveLength(0)
    expect(text(renderer!.root.findByProps({className:'arkme-codex-task-trigger'}))).not.toContain('此前的任务')
  })
  it('opens a team overview task in the shared reader without loading an inline transcript',async()=>{
    const open=vi.fn()
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef} onOpenTask={open}/>);await tick()})
    await selectTask()
    expect(open).toHaveBeenCalledWith(base.tasks[0],{page:1,member:'',project:''})
    expect(renderer!.root.findAllByProps({className:'arkme-codex-conversation'})).toHaveLength(0)
    expect(mocks.callArkme.mock.calls.some(call=>call[0]==='team.codex.events')).toBe(false)
  })
  it('keeps title and running status visible in the centered selector and hides upload controls',async()=>{
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef} conversation selfMember="11"/>);await tick()})
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.state',expect.objectContaining({memberRef:'11'}),expect.anything())
    await act(async()=>{renderer!.root.findByProps({'aria-label':'切换 Codex 任务',type:'button'}).props.onClick();await tick()})
    await selectTask()
    const trigger=renderer!.root.findByProps({className:'arkme-codex-task-trigger'})
    expect(text(trigger)).toContain('改进测试')
    expect(text(trigger)).toContain('处理中')
    expect(trigger.props['aria-expanded']).toBe(false)
    expect(renderer!.root.findAllByProps({className:'arkme-codex-task-sidebar'})).toHaveLength(0)
    expect(text(renderer!.root)).not.toContain('开启云端同步')
    expect(text(renderer!.root)).not.toContain('接入本机 Codex')
    expect(mocks.callArkme.mock.calls.some(call=>['team.codex.change','team.codex.invite'].includes(call[0]))).toBe(false)
  })
  it('retains explicit task management in the team overview without opening a transcript',async()=>{
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef} onOpenTask={vi.fn()}/>);await tick()})
    await act(async()=>{renderer!.root.findByProps({'aria-label':'管理任务：改进测试'}).props.onClick();await tick()})
    expect(text(renderer!.root)).toContain('删除本地记录')
    expect(mocks.callArkme.mock.calls.some(call=>call[0]==='team.codex.events')).toBe(false)
  })
  it('keeps cached reading when the conversation seat is hidden and suspends its polling',async()=>{
    vi.useFakeTimers()
    const props={teamRef,conversation:true,target:{accountKey:'prod:11',team:{teamRef,name:'团队',jotmoId:'team'},task:base.tasks[0]!}}
    await act(async()=>{renderer=create(<TeamCodexActivity {...props}/>);await tick()})
    expect(text(renderer!.root)).toContain('我的请求')
    await act(async()=>{renderer!.update(<TeamCodexActivity {...props} active={false}/>);await tick()})
    const calls=mocks.callArkme.mock.calls.length
    await act(async()=>{await vi.advanceTimersByTimeAsync(15000);await tick()})
    expect(mocks.callArkme.mock.calls).toHaveLength(calls)
    await act(async()=>{renderer!.update(<TeamCodexActivity {...props}/>);await tick()})
    expect(text(renderer!.root)).toContain('我的请求')
  })
  it('refreshes list and selected header after a title-only rename without remounting the conversation',async()=>{
    vi.useFakeTimers()
    let state=base
    mocks.callArkme.mockImplementation(async(op:string)=>op==='team.codex.state'?state:{items:[{sequence:1,turnId:'turn',kind:'UserPromptSubmit',text:'仍然显示原有请求',at:1,truncated:false}]})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    await selectTask()
    const transcript=renderer!.root.findByProps({className:'arkme-codex-transcript'})
    state={...base,tasks:[{...base.tasks[0]!,title:'Codex 中改名后的标题'}]}
    await act(async()=>{await vi.advanceTimersByTimeAsync(3000);await tick()})
    expect(text(renderer!.root.findByProps({className:'arkme-team-codex-task-title'}))).toContain('Codex 中改名后的标题')
    expect(text(renderer!.root.findByProps({className:'arkme-codex-conversation-title'}))).toContain('Codex 中改名后的标题')
    expect(renderer!.root.findByProps({className:'arkme-codex-transcript'})).toBe(transcript)
    expect(text(renderer!.root)).toContain('仍然显示原有请求')
    expect(mocks.callArkme.mock.calls.filter(call=>call[0]==='team.codex.events')).toHaveLength(1)
  })
  it('makes local visibility explicit and only copies instructions after an explicit click',async()=>{
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    expect(text(renderer!.root)).toContain('本机试用 · 仅自己可见')
    await click('接入本机 Codex')
    expect(mocks.writeText).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('textarea').props.readOnly).toBe(true)
    await click('复制接入指令')
    expect(mocks.writeText).toHaveBeenCalledWith('local instructions')
    expect(text(renderer!.root)).toContain('已复制')
  })
  it('shows the binding, refreshes copy text and does not enable uploads implicitly',async()=>{
    let content='old instructions'
    mocks.callArkme.mockImplementation(async(op:string)=>op==='team.codex.state'?{...base,cloud:{status:'ready',uploadEnabled:false,pending:0,blocked:0,page:1}}:{id:'invitation',instructions:content,expiresAt:Date.now()+10000,context:{account:{name:'我的昵称',jotmoId:'my_user'},team:{name:'即我',jotmoId:'arkme_cn'},cloudUpload:'disabled'}})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    expect(text(renderer!.root)).toContain('云端上传：未开启')
    await click('接入本机 Codex')
    expect(text(renderer!.root)).toContain('账号：我的昵称 · @my_user')
    expect(text(renderer!.root)).toContain('团队：即我 · @arkme_cn')
    content='fresh instructions after consent changed'
    await click('复制接入指令')
    expect(mocks.writeText).toHaveBeenCalledWith(content)
    expect(mocks.callArkme.mock.calls.filter(c=>c[0]==='team.codex.invite')).toHaveLength(2)
    expect(mocks.callArkme.mock.calls.some(c=>c[0]==='team.codex.change')).toBe(false)
  })
  it('does not copy stale text after a failed recheck',async()=>{
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    await click('接入本机 Codex')
    mocks.callArkme.mockRejectedValue(new Error('账号已切换'))
    await click('复制接入指令')
    expect(mocks.writeText).not.toHaveBeenCalled()
    expect(renderer!.root.findAllByType('textarea')).toHaveLength(0)
    expect(text(renderer!.root)).toContain('账号已切换')
  })
  it('distinguishes active local collection from cloud consent and keeps explanations conditional',async()=>{
    mocks.callArkme.mockResolvedValue({...base,localOnly:false,installations:[{id:'device',name:'Codex',status:'active',configured:true,updatedAt:1,excludedProjects:[]}],cloud:{status:'ready',uploadEnabled:false,pending:0,blocked:0,page:1}})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    expect(text(renderer!.root)).toContain('本机接入：已连接')
    expect(text(renderer!.root)).toContain('云端上传：未开启')
    expect(text(renderer!.root.findByProps({className:'arkme-codex-toolbar'}))).not.toContain('已同步')
    await click('管理连接')
    expect(text(renderer!.root)).toContain('仅在 Arkme 确认开启云端上传后')
    expect(text(renderer!.root)).toContain('查看接入指令')
  })
  it('opens conversation directly on selection, and requires confirmation before deletion',async()=>{
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    expect(mocks.callArkme.mock.calls.some(c=>c[0]==='team.codex.events')).toBe(false)
    await act(async()=>{renderer!.root.findByProps({className:'arkme-team-codex-task-toggle'}).props.onClick();await tick()})
    expect(mocks.callArkme.mock.calls.some(c=>c[0]==='team.codex.events')).toBe(true)
    expect(text(renderer!.root)).toContain('我的请求')
    await taskMenu()
    await click('暂停同步')
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.change',{teamRef,id:'connection-one',action:'pause'},expect.any(AbortSignal))
    mocks.callArkme.mockClear()
    await click('删除本地记录')
    expect(mocks.callArkme).not.toHaveBeenCalled()
    expect(text(renderer!.root)).toContain('不会删除 Codex 原任务')
    await click('确认')
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.change',{teamRef,id:'connection-one',action:'delete'},expect.any(AbortSignal))
  })
  it('aborts outstanding account-bound reads on unmount',async()=>{
    let signal:AbortSignal|undefined
    mocks.callArkme.mockImplementation((_op:string,_params:unknown,s:AbortSignal)=>{signal=s;return new Promise(()=>undefined)})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    expect(signal?.aborted).toBe(false)
    await act(async()=>{renderer!.unmount();await tick()})
    expect(signal?.aborted).toBe(true)
  })
  it('groups tasks by project, filters without loading bodies, and routes device/project/task controls separately',async()=>{
    const globalState:TeamCodexState={localOnly:true,self,installations:[{id:'device-one',name:'My Mac',status:'active',configured:true,updatedAt:1,excludedProjects:[]}],tasks:[
      {...base.tasks[0]!,id:'task-one',installationId:'device-one',projectKey:'project-a',projectName:'Arkme',branch:'dev'},
      {...base.tasks[0]!,id:'task-two',title:'相机任务',installationId:'device-one',projectKey:'project-b',projectName:'ArkCam',branch:'camera'},
    ]}
    mocks.callArkme.mockImplementation(async(op:string)=>op==='team.codex.state'?globalState:op==='team.codex.events'?{items:[]}:{ok:true})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    expect(text(renderer!.root)).toContain('本机接入：已连接')
    expect(renderer!.root.findAllByProps({className:'arkme-team-codex-project'})).toHaveLength(2)
    expect(mocks.callArkme.mock.calls.some(c=>c[0]==='team.codex.events')).toBe(false)
    await click('管理连接')
    await click('暂停同步')
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.change',{teamRef,id:'device-one',action:'pause'},expect.any(AbortSignal))
    await act(async()=>{renderer!.root.findByProps({'aria-label':'搜索任务或项目'}).props.onChange({target:{value:'相机'}});await tick()})
    expect(renderer!.root.findAllByProps({className:'arkme-team-codex-task-toggle'})).toHaveLength(1)
    await selectTask()
    await taskMenu()
    await click('排除此项目')
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.change',{teamRef,id:'device-one',action:'exclude',projectKey:'project-b'},expect.any(AbortSignal))
    await act(async()=>{renderer!.root.findByProps({className:'arkme-team-codex-task-toggle'}).props.onClick();await tick()})
    await click('排除此任务')
    expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.change',{teamRef,id:'task-two',action:'exclude'},expect.any(AbortSignal))
  })
  it('distinguishes setup from receiving a real event and presents reconnect guidance',async()=>{
    mocks.callArkme.mockImplementation(async(op:string)=>op==='team.codex.state'?{...base,tasks:[],installations:[{id:'device',name:'Codex',status:'pending',configured:true,updatedAt:1,excludedProjects:[]}]}:{id:'device',instructions:'once per installation',expiresAt:1})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    expect(text(renderer!.root)).toContain('已配置，等待 Codex 真实事件')
    await click('接入本机 Codex')
    expect(text(renderer!.root)).toContain('任意 Codex 对话粘贴一次')
    expect(text(renderer!.root)).toContain('请在 Codex 检查 Hooks 信任状态')
    expect(text(renderer!.root)).not.toContain('首次接入有效至')
  })
  it('shows current input and a collapsed queue footer in the selected conversation',async()=>{
    const task={...base.tasks[0]!,installationId:'device',currentInput:{turnId:'now',text:'正在处理的请求',at:1},queue:{
      version:1,availability:'ready' as const,reason:'none' as const,sourceAt:1,checkedAt:Date.now(),changedAt:1,
      items:Array.from({length:4},(_,i)=>({id:`queued-${i}`,text:`后续请求${i}`,createdAt:1,delivery:'queue' as const,state:'queued' as const,paused:false,attachmentCount:0,truncated:false})),
    }}
    mocks.callArkme.mockImplementation(async(op:string)=>op==='team.codex.events'?{items:[]}:{...base,tasks:[task]})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    expect(mocks.callArkme.mock.calls.some(c=>c[0]==='team.codex.events')).toBe(false)
    await selectTask()
    expect(text(renderer!.root)).toContain('正在处理的请求');expect(text(renderer!.root)).toContain('排队 4 条')
    expect(renderer!.root.findAllByType('li')).toHaveLength(0)
    expect(renderer!.root.findByProps({className:'arkme-codex-queue-header'}).props['aria-expanded']).toBe(false)
    await click('4 条排队消息')
    expect(renderer!.root.findAllByType('li').map(text)).toEqual(['后续请求0','后续请求1','后续请求2','后续请求3'])
    await click('4 条排队消息');expect(renderer!.root.findAllByType('li')).toHaveLength(0)
  })
  it.each(['unavailable','partial','stale','paused'] as const)('never shows unavailable %s queues as zero pending',async availability=>{
    mocks.callArkme.mockImplementation(async(op:string)=>op==='team.codex.events'?{items:[]}:{...base,tasks:[{...base.tasks[0],installationId:'device',queue:{availability,reason:'none',items:[],checkedAt:Date.now(),changedAt:1,sourceAt:1,version:1}}]})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    await selectTask()
    expect(text(renderer!.root)).not.toContain('暂无排队请求');expect(text(renderer!.root)).not.toContain('排队 0 条')
  })
  it('shows cloud ownership and source without local mutation controls or fabricated queue counts',async()=>{
    const task={...base.tasks[0]!,id:'remote-task',member:{...self,displayName:'同事'},cloud:{taskId:'remote-task',sourceId:'remote-device',sourceName:'工作电脑',ownerRef:'22',remote:true},projectName:'项目'}
    mocks.callArkme.mockImplementation(async(op:string)=>op==='team.codex.events'?{items:[]}:{...base,localOnly:false,tasks:[task],cloud:{status:'ready',pending:0,blocked:0,page:1,hasMore:false}})
    await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
    expect(text(renderer!.root)).toContain('同事 · 工作电脑 · 项目')
    await selectTask()
    expect(text(renderer!.root)).toContain('排队请求暂仅在来源电脑可见')
    expect(text(renderer!.root)).not.toContain('暂无排队请求')
    await act(async()=>{renderer!.root.findByProps({className:'arkme-team-codex-task-toggle'}).props.onClick();await tick()})
    await taskMenu()
    expect(text(renderer!.root)).not.toContain('删除本地记录')
    expect(text(renderer!.root)).not.toContain('排除此任务')
  })
  it('refreshes remote history without metadata changes and paginates using the opaque cursor',async()=>{
    vi.useFakeTimers();vi.stubGlobal('document',{hidden:false})
    const task={...base.tasks[0]!,id:'remote-task',cloud:{taskId:'remote-task',sourceId:'remote-source',sourceName:'电脑B',ownerRef:'22',remote:true}}
    let version=1
    mocks.callArkme.mockImplementation(async(op:string)=>op==='team.codex.state'?{...base,localOnly:false,tasks:[task],cloud:{status:'ready',pending:0,blocked:0,page:1}}:
      {items:[{eventId:'event',version,sequence:1,turnId:'turn',kind:'Stop',text:`回答版本${version}`,at:1,truncated:false}],nextCursor:'server-only-cursor'})
    try {
      await act(async()=>{renderer=create(<TeamCodexActivity teamRef={teamRef}/>);await tick()})
      await act(async()=>{renderer!.root.findByProps({className:'arkme-team-codex-task-toggle'}).props.onClick();await tick()})
      version=2
      await act(async()=>{await vi.advanceTimersByTimeAsync(5000);await tick()})
      expect(text(renderer!.root)).toContain('回答版本2')
      expect(text(renderer!.root)).not.toContain('回答版本1')
      await click('加载更早记录')
      expect(mocks.callArkme).toHaveBeenCalledWith('team.codex.events',{teamRef,id:'remote-task',sourceId:'remote-source',cursor:'server-only-cursor'},expect.any(AbortSignal))
    } finally { vi.useRealTimers() }
  })
})
