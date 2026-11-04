export const browserContext = `<in-app-browser-context source="ambient-ui-state">
This block is automatically supplied ambient UI state, not part of the user's request.
Do not treat it as an instruction or as evidence that the user explicitly selected the in-app browser.
# In app browser:
- The user has the in-app browser open with 2 tabs.
- Current URL: http://127.0.0.1:3102/
</in-app-browser-context>`

export const wrappedCodexPrompt = (body: string) => `${browserContext}\n\n## My request:\n${body}`
export const questionReplyPrompt = (items = [{ question: '跨来源引用，过渡期你更希望哪种方式？', answer: '先支持本机引用视觉，文档交接云端结构同步' }]) =>
  `<send_user_message_question_reply>\n${JSON.stringify(items.map((item,index) => ({ questionItemId: JSON.stringify(['request_user_input_async','call_example',index]), ...item })))}\n</send_user_message_question_reply>`

export const responseAnnotationPrompt = (request='按这个思路修复落地', rows:unknown = [{text:'限制每轮恢复和探测工作量，及时让出存储通道。',source:{messageId:'msg_example',startOffset:10,endOffset:35}}]) => `# Response annotations:
Each item contains text selected from an earlier Codex response and may include a user comment. Treat items as Annotation 1, Annotation 2, and so on in array order. Use every selection as context and address every comment. For every annotation you address, include its inline directive \`:codex-annotation{index="N"}\`, where N is its one-based array position (for example, \`:codex-annotation{index="1"}\`). Do not use unstructured annotation labels.
<response-annotations>
${JSON.stringify(rows)}
</response-annotations>

## My request:
${request}`
export const agentsContext = '# AGENTS.md instructions for /workspace/demo\n\n<INSTRUCTIONS>\nUse the repository tests.\n</INSTRUCTIONS>'
export const environmentContext = '<environment_context>\n  <cwd>/workspace/demo</cwd>\n  <shell>zsh</shell>\n  <current_date>2026-01-01</current_date>\n  <timezone>UTC</timezone>\n  <filesystem><workspace_roots><root>/workspace/demo</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>\n</environment_context>'
