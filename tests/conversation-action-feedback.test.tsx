// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversationActionFeedbackContext, useConversationActionFeedback } from '../src/client/use-conversation-action-feedback.js'
let root: Root, host: HTMLDivElement
let scope = 'account-a', active = true, late: ((message: string) => void) | undefined
function Team() {
  const feedback = useConversationActionFeedback(scope)
  late = feedback.notify
  return <><button onClick={() => feedback.notify('团队操作完成')}>team</button>{feedback.feedback}</>
}
function Directory() {
  const feedback = useConversationActionFeedback(scope, active)
  return <ConversationActionFeedbackContext.Provider value={feedback.notify}>
    <button onClick={() => feedback.notify('普通会话操作完成')}>ordinary</button><Team />{feedback.feedback}
  </ConversationActionFeedbackContext.Provider>
}
const render = async () => { await act(async () => root.render(<Directory />)) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers()
  scope = 'account-a'; active = true; late = undefined
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('ordinary and Team actions share one notice and replace its timeout', async () => {
  await render()
  await act(async () => host.querySelectorAll('button')[0]!.click())
  await act(async () => { vi.advanceTimersByTime(2000) })
  await act(async () => host.querySelectorAll('button')[1]!.click())
  expect(document.querySelectorAll('[role="status"]')).toHaveLength(1)
  expect(document.querySelector('[role="status"]')?.textContent).toBe('团队操作完成')
  expect(host.querySelector('[role="status"]')).toBeNull()
  await act(async () => { vi.advanceTimersByTime(2199) })
  expect(document.querySelector('[role="status"]')).not.toBeNull()
  await act(async () => { vi.advanceTimersByTime(1) })
  expect(document.querySelector('[role="status"]')).toBeNull()
})
it('account and inactive boundaries discard notices and late completions', async () => {
  await render(); const old = late!
  await act(async () => old('旧账号操作'))
  scope = 'account-b'; await render()
  await act(async () => old('迟到结果'))
  expect(document.querySelector('[role="status"]')).toBeNull()
  scope = 'account-a'; await render()
  expect(document.querySelector('[role="status"]')).toBeNull()
  const pending = late!; active = false; await render()
  await act(async () => pending('后台迟到结果'))
  active = true; await render()
  expect(document.querySelector('[role="status"]')).toBeNull()
})
