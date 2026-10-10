import {createPortal} from 'react-dom'
import type {RefObject} from 'react'
import type {ScreenshotFrame} from './browser-screenshot.js'
import {ArkmeScreenshotEditor} from './ArkmeScreenshotEditor.js'
export function ArkmeScreenshotCropDialog({frame,rootRef,onClose,onComplete}:{frame:ScreenshotFrame;rootRef:RefObject<HTMLDivElement>;onClose():void;onComplete(blob:Blob):void}) {
 return createPortal(<div ref={rootRef} data-arkme-screenshot-dialog="true" data-arkme-notification-blocking-overlay="true"><ArkmeScreenshotEditor frame={frame} onClose={onClose} onComplete={onComplete}/></div>,document.body)
}
