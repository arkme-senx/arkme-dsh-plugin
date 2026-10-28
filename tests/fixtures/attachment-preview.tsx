import { createRoot } from 'react-dom/client'
import { ArkmeMessageContent, openSessionAttachmentPreview } from '../../src/client/ArkmeRichContent.js'
import { arkmeAuthStore } from '../../src/client/auth-store.js'
import { bindAttachmentPreviewAccount } from '../../src/client/attachment-preview-auth-binding.js'
const file = {kind:'file' as const, mediaRef:'file', fileName:'方案.pdf', mimeType:'application/pdf',size:3600,sortOrder:0,localFileRef:'arkme-file-v1.00000000-0000-4000-8000-000000000001'}
const image = {kind:'image' as const, mediaRef:'photo', fileName:'图片.png', mimeType:'image/png',size:300,sortOrder:1}
const video = {kind:'video' as const, mediaRef:'video', fileName:'视频.mp4', mimeType:'video/mp4',size:300,sortOrder:2}
const blocks=[file,image,video]
arkmeAuthStore.setAuth({status:'authenticated',userId:7,environment:'prod'})
bindAttachmentPreviewAccount()
Object.assign(window, {
 smokeOpen: (index=0) => openSessionAttachmentPreview(blocks, blocks[index]!, 'chat-A'),
 smokeSingle: () => openSessionAttachmentPreview([file], file, 'single'),
 smokeLogout: () => arkmeAuthStore.setAuth({status:'logged-out',environment:'prod'}),
})
createRoot(document.getElementById('root')!).render(<main><h1>Arkme 会话 A</h1><input aria-label="聊天输入" placeholder="预览时仍可聊天" /><ArkmeMessageContent sessionAttachmentPreview sourceRef="source-A" item={{itemUid:'record',status:1,isMe:true,senderName:'我',sendAtMillis:1,title:'',textContent:'附件',contentBlocks:blocks}} /></main>)
