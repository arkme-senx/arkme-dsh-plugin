export interface TeamGroupJoinAttempt {requestUid:string;expectedRevision:number}
export function teamGroupJoinAttemptKey(account:string,sourceKey:string) {
  return `arkme.team-group-join:${JSON.stringify([account,sourceKey])}`
}
export function readTeamGroupJoinAttempts(storage:Pick<Storage,'getItem'>,key:string):Record<string,TeamGroupJoinAttempt> {
  const raw:unknown=JSON.parse(storage.getItem(key)??'{}')
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('此前入群申请的本机记录无法读取，请先核对结果')
  for(const [team,value] of Object.entries(raw)) {
    const row=value as TeamGroupJoinAttempt
    if(!team||!row||typeof row.requestUid!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(row.requestUid)||!Number.isSafeInteger(row.expectedRevision)||row.expectedRevision<0)throw new Error('此前入群申请的本机记录无法读取，请先核对结果')
  }
  return raw as Record<string,TeamGroupJoinAttempt>
}
export function retainTeamGroupJoinAttempt(storage:Pick<Storage,'getItem'|'setItem'>,key:string,team:string,attempt:TeamGroupJoinAttempt|undefined) {
  const rows=readTeamGroupJoinAttempts(storage,key)
  if(attempt)rows[team]=attempt
  else delete rows[team]
  storage.setItem(key,JSON.stringify(rows))
}
