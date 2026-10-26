import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { ArkmeRecordingImportDialog, type ArkmeRecordingImportDialogHandle } from '../../src/client/recordings/ArkmeRecordingImportDialog.js'
const handle = createRef<ArkmeRecordingImportDialogHandle>()
Object.assign(window, { showOpenFilePicker: async () => { throw new DOMException('User activation required.', 'NotAllowedError') } })
createRoot(document.getElementById('root')!).render(<>
  <h1>Arkme 文件选择错误 toast 验证（隔离环境）</h1>
  <button onClick={() => handle.current?.open()}>打开上传文件</button>
  <ArkmeRecordingImportDialog ref={handle} importPath="/fixture-only" defaultStartAtMillis={Date.now()} currentUserId={42} onAccepted={() => {}} />
</>)
