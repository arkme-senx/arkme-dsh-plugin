import {build} from 'tsdown'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const outDir=process.argv[2]
if(!outDir)throw new Error('Usage: node scripts/qa/quarantine-ask-dsh/build.mjs <output-directory>')
await build({entry:[fileURLToPath(new URL('./entry.tsx',import.meta.url))],outDir:path.resolve(outDir),format:'esm',platform:'browser',config:false,clean:false,dts:false,noExternal:[/.*/],target:'es2022',outputOptions:{entryFileNames:'app.js',codeSplitting:false},define:{'process.env.NODE_ENV':'"production"'}})
