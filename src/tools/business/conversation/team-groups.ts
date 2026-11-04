import {defineTool} from '@deepseek-ai/dsh-tools'
import {defineArkmeCoreToolModule} from '../../contract/module.js'
import {taggedJSON,TEXT_OUTPUT} from '../../shared/output.js'
import type {TeamGroupRequest,TeamGroupCommandInput,TeamWorkspaceRequest} from '../../../team-group-contract.js'

export const teamGroupsReadTool=defineArkmeCoreToolModule({meta:{id:'business.conversation.team-groups-read.v1',toolName:'arkme_team_groups_read',kind:'business',phase:'core',effect:'read',profiles:['business','hybrid']},create(ports){return defineTool({
  name:'arkme_team_groups_read',description:'Read team-group admission candidates, status, participants, approvals or the team group directory. Uses account-bound opaque references. This never joins a group or grants access.',
  parameters:{request:{type:'json',required:true,description:'One request: operation join-context/participants/approvals with sourceRef; directory with teamRef; status with requestUid. Optional cursor and limit for pages.'}},output:TEXT_OUTPUT,
  async execute(args,exec){const r=args.request as TeamGroupRequest;if(!r||!['join-context','status','participants','approvals','directory'].includes(r.operation))throw new Error('无效的团队群查询');return taggedJSON('团队群',await ports.teamGroups(r,exec.signal))},
})}})

export const teamGroupsChangeTool=defineArkmeCoreToolModule({meta:{id:'business.conversation.team-groups-change.v1',toolName:'arkme_team_groups_change',kind:'business',phase:'core',effect:'write',grant:'explicit-user-write',profiles:['business','hybrid']},create(ports){return defineTool({
  name:'arkme_team_groups_change',description:'After an explicit human choice, join, leave, remove, approve or reject a team group admission. Keep the same requestUid and complete command when retrying an unknown result. Historical success does not mean current access.',
  parameters:{command:{type:'json',required:true,description:'sourceRef, teamRef, action(join/leave/remove/approve/reject), requestUid, expectedRevision. approve/reject also need the unchanged admissionRef from approvals.'}},output:TEXT_OUTPUT,
  async execute(args,exec){const command=args.command as unknown as TeamGroupCommandInput;if(!command||!['join','leave','remove','approve','reject'].includes(command.action))throw new Error('无效的团队群操作');return taggedJSON('团队群操作结果',await ports.teamGroups({operation:'command',command},exec.signal))},
})}})

export const teamWorkspaceTool=defineArkmeCoreToolModule({meta:{id:'business.conversation.team-workspace.v1',toolName:'arkme_team_workspace',kind:'business',phase:'core',effect:'read',profiles:['business','hybrid']},create(ports){return defineTool({
  name:'arkme_team_workspace',description:'Read the current team workspace, customer source-group cards and exact source occurrences. A source card is a reference to the original group, never a private message or a permission grant. To reply use the returned group sourceRef and its message actionRef. Explicit private messaging keeps its own admission.',
  parameters:{request:{type:'json',required:true,description:'operation folders for current group-bearing team folders; page with teamRef; cards with conversationRef; occurrences with conversationRef and cardRef; locate with anchorRef. resolve-entries takes teamRef and exact group/customer preference entries; preferences takes action query/list and params. Pages accept cursor and limit. Reuse opaque refs unchanged.'}},output:TEXT_OUTPUT,
  async execute(args,exec){const request=args.request as unknown as TeamWorkspaceRequest;if(!request||!['folders','page','cards','occurrences','locate','resolve-entries','preferences'].includes(request.operation)||request.operation==='preferences'&&request.action==='change')throw new Error('无效的团队工作区查询');return taggedJSON('团队工作区',await ports.teamWorkspace(request,exec.signal))},
})}})
