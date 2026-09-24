import { tr } from './locale.js'

export function ArkmeArrangementRecognition() {
  return <span className="arkme-arrangement-recognition" role="status" aria-label={tr('AI识别中…')}>
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="25 10" /></svg>
  </span>
}
