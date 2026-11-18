import type {TeamGroupCommandInput} from '../team-group-contract.js'

/** Persist the exact human command before IO; an unknown ACK is retried under
 * the same permanent server receipt, including across drawer remounts. */
export function retainTeamGroupCommand(storage:Pick<Storage,'getItem'|'setItem'>,account:string,sourceKey:string,targetKey:string,input:Omit<TeamGroupCommandInput,'requestUid'>):{key:string;command:TeamGroupCommandInput;recovered:boolean} {
  const key=`arkme.team-group-command:${JSON.stringify([account,sourceKey,targetKey,input.action,input.expectedRevision])}`
  const raw=storage.getItem(key)
  if(raw!==null) {
    const command=JSON.parse(raw) as TeamGroupCommandInput
    if(!command||typeof command.requestUid!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(command.requestUid)||command.action!==input.action
      ||command.expectedRevision!==input.expectedRevision||!command.sourceRef||!command.teamRef||!!command.admissionRef!==!!input.admissionRef)throw new Error('此前操作尚未核对，请先查询原操作结果')
    return {key,command,recovered:true}
  }
  const command={...input,requestUid:crypto.randomUUID()}
  storage.setItem(key,JSON.stringify(command))
  return {key,command,recovered:false}
}
