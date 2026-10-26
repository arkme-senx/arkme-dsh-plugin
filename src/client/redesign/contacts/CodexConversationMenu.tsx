import { useEffect, useId, useRef, useState } from 'react'
import { Info } from '@phosphor-icons/react/dist/csr/Info'
import { X } from '@phosphor-icons/react/dist/csr/X'
import { ConversationActionsMenu } from '../../PrivateChatActions.js'
import { ArkmeConfirmDialog } from '../../ArkmeConfirmDialog.js'
import { ArkmeConversationHeaderIconButton } from '../../ArkmeGroupChatControls.js'
import { tr } from '../../locale.js'
import type { CodexViewTask } from './personal-codex-state.js'

/** The conversation uses the same menu as private chat; sync management stays outside the reader. */
export function CodexConversationMenu({ task, active, open, onOpenChange }: {
  task: CodexViewTask | undefined; active: boolean; open: boolean; onOpenChange(open: boolean): void
}) {
  const anchor = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const [informationOpen, setInformationOpen] = useState(false)
  useEffect(() => { if (!active) setInformationOpen(false) }, [active])
  const rows = task ? [
    ['对话', task.title], ['项目', task.projectName], ['目录', task.cwd], ['分支', task.branch],
    ['来源电脑', task.cloud?.sourceName], ['所属用户', task.member.displayName],
    ['团队', task.viewTeam ? `${task.viewTeam.name} · @${task.viewTeam.jotmoId}` : undefined],
  ].filter((row): row is [string,string] => !!row[1]) : []
  return <>
    <ConversationActionsMenu anchor={anchor} label={tr('更多 Codex 对话操作')}
      onClose={() => onOpenChange(false)}
      trigger={{open:active && open,onOpenChange}}
      items={[{id:'information',label:tr('对话信息'),icon:<Info size={20} aria-hidden/>,disabled:!task,
        invoke:() => setInformationOpen(true)}]}/>
    {active && informationOpen && task && <ArkmeConfirmDialog layout="picker" titleId={titleId}
      title={tr('对话信息')} busy={false} onClose={() => setInformationOpen(false)}>
      <div className="arkme-codex-information-dialog">
        <header><h2>{tr('对话信息')}</h2>
          <ArkmeConversationHeaderIconButton label={tr('关闭对话信息')} onClick={() => setInformationOpen(false)}><X size={20}/></ArkmeConversationHeaderIconButton>
        </header>
        <dl>{rows.map(([label,value]) => <div key={label}><dt>{tr(label)}</dt><dd>{value}</dd></div>)}</dl>
      </div>
    </ArkmeConfirmDialog>}
  </>
}
