import { ArkmeTextTooltip } from './ArkmeTextTooltip.js'

/** Render outside the attachment strip so horizontal overflow cannot clip filenames. */
export function ArkmeAttachmentTooltip({ anchor, id, name, onClose }: {
  anchor: HTMLElement
  id: string
  name: string
  onClose(): void
}) {
  return <ArkmeTextTooltip anchor={anchor} id={id} text={name} onClose={onClose} kind="attachment" />
}
