import { HARNESS_DOCUMENT_STARTED } from './harness-embed-contract.js'

/** Runs before deferred/native modules. The parent must validate source and origin. */
export const HARNESS_DOCUMENT_BOOTSTRAP = `if(window.parent!==window)window.parent.postMessage({type:${JSON.stringify(HARNESS_DOCUMENT_STARTED)}},location.origin);`
