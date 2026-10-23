import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { tr } from '../../locale.js'
import type { CodexTaskStatus } from './codex-task-status.js'

const nativeState: Record<CodexTaskStatus, StateDotState> = {
  running:'ongoing', finished:'done', interrupted:'idle', unknown:'warning', paused:'idle', waiting:'idle',
}
export const codexTaskStatusLabel = (status: CodexTaskStatus): string => tr({
  running:'进行中', finished:'已完成', interrupted:'已中断', unknown:'状态待核实', paused:'已暂停', waiting:'等待开始',
}[status])

/** Use the actual DSH component, including its synchronized animation and theme. */
export function CodexTaskStateDot({ status }: { status: CodexTaskStatus }) {
  return <span className="arkme-codex-native-state" title={codexTaskStatusLabel(status)}>
    <StateDot state={nativeState[status]} size={12}/>
  </span>
}
