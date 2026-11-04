import type { ArkoReplyPromptBook, ArkoReplyPromptResult, ArkoReplyPromptWrite } from '../arko-reply-contract.js'
import { callArkme } from './api.js'
export async function readCloudReplyPrompts(scope: string, signal: AbortSignal): Promise<ArkoReplyPromptBook> {
  const book = await callArkme<ArkoReplyPromptBook>('arko.reply-prompts.get', { expectedAccountScope: scope }, signal)
  signal.throwIfAborted(); if (book.accountScope !== scope) throw new Error('账号已切换，请重新读取')
  return book
}
export async function writeCloudReplyPrompt(scope: string, input: ArkoReplyPromptWrite, reset: boolean, signal: AbortSignal): Promise<ArkoReplyPromptResult> {
  const result = await callArkme<ArkoReplyPromptResult>(reset ? 'arko.reply-prompts.reset' : 'arko.reply-prompts.save', { expectedAccountScope: scope, input }, signal)
  signal.throwIfAborted(); if (result.accountScope !== scope) throw new Error('账号已切换，请重新读取')
  return result
}
