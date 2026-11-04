import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const checkout=process.env.ARKME_DSH_CHECKOUT
if(!checkout)throw new Error('ARKME_DSH_CHECKOUT required')
const {default:official}=await import(pathToFileURL(resolve(checkout,'vitest.web.config.ts')).href)
export default {...official,test:{...official.test,include:[resolve(import.meta.dirname,'tests/e2e/recording-voice.e2e.mjs')],fileParallelism:false}}
