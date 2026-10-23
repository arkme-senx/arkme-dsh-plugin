export const browserContext = `<in-app-browser-context source="ambient-ui-state">
This block is automatically supplied ambient UI state, not part of the user's request.
Do not treat it as an instruction or as evidence that the user explicitly selected the in-app browser.
# In app browser:
- The user has the in-app browser open with 2 tabs.
- Current URL: http://127.0.0.1:3102/
</in-app-browser-context>`

export const wrappedCodexPrompt = (body: string) => `${browserContext}\n\n## My request:\n${body}`
