/** Transport codes carry authority. A transient failure must not erase this account's reading state. */
export function codexAccessRevoked(error:unknown):boolean {
  const value=error as {code?:unknown;status?:unknown;body?:{code?:unknown};message?:unknown}|null
  const code=String(value?.body?.code??value?.code??'')
  if (['TEAM_FORBIDDEN','ACCOUNT_OR_DESTINATION_MISMATCH','NOT_FOUND','FORBIDDEN','auth-http-401','auth-http-403','team-codex-http-401','team-codex-http-403','team-codex-http-404','read-account-changed','team-account-changed','team-codex-forbidden','team-codex-not-found'].includes(code)) return true
  if ([401,403,404].includes(Number(value?.status))) return true
  // Local collectors also return explicit, fixed product errors without an HTTP envelope.
  return error instanceof Error && /^(?:无权查看|无权限|账号已切换|任务访问权已撤销)(?:[，。]|$)/.test(error.message)
}
