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
