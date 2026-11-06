import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { x as extractTar } from 'tar'

const output = resolve(process.argv[2])
const archives = (await readdir(output)).filter(name => name.endsWith('.tgz'))
if (archives.length !== 1) throw new Error('Expected one packed recorder npm artifact')
const temporary = await mkdtemp(join(tmpdir(), 'arkme-recorder-native-'))
try {
  await extractTar({ file: join(output, archives[0]), cwd: temporary, strict: true,
    filter: name => name === 'package' || name.startsWith('package/') })
  const validator = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'recorder-runtime-dependencies.mjs')).href
  // A child unloads the native DLL before Windows removes the extracted files.
  execFileSync(process.env.ARKME_RECORDER_PROBE_BINARY || process.execPath, ['--input-type=module', '--eval', `
    import {readFile} from 'node:fs/promises';
    import {createRequire} from 'node:module';
    import {join} from 'node:path';
    import {assertRecorderRuntimeDependencies} from ${JSON.stringify(validator)};
    const directory=process.argv[1];
    const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
    await assertRecorderRuntimeDependencies(directory,manifest);
    const require=createRequire(join(directory,'package.json'));
    const {SerialPort}=require('serialport');
    const ports=await SerialPort.list();
    console.log(JSON.stringify({nativeRecorderRuntime:true,plugin:manifest.version,
      platform:process.platform,arch:process.arch,electron:process.versions.electron??null,
      abi:process.versions.modules,enumeratedPorts:ports.length,openedPorts:0}));
  `, join(temporary, 'package')], { env: process.env, stdio: 'inherit' })
} finally {
  await rm(temporary, { recursive: true, force: true })
}
