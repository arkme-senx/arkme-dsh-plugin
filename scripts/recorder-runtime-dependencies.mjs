import { createRequire } from 'node:module'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'

function within(directory, file) {
  const name = relative(directory, file)
  if (name.startsWith('..') || isAbsolute(name)) throw new Error('recorder dependency resolved outside the packed plugin')
  return file
}

async function dependencyManifest(directory, from, name) {
  try { return within(directory, from.resolve(`${name}/package.json`)) }
  catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
    // Some packages export their JS entry but deliberately hide package.json.
    let current = dirname(within(directory, from.resolve(name)))
    while (true) {
      const file = join(current, 'package.json')
      try {
        if (JSON.parse(await readFile(file, 'utf8')).name === name) return file
      } catch (failure) { if (failure.code !== 'ENOENT') throw failure }
      if (current === directory) throw new Error(`packed dependency manifest is missing: ${name}`)
      current = within(directory, dirname(current))
    }
  }
}

// Release Set installation extracts the plugin; it does not install npm deps.
// Validate the packed payload, where a workspace/old Harness cannot mask gaps.
export async function assertRecorderRuntimeDependencies(directory, manifest) {
  if (!manifest.dependencies?.serialport) return
  directory = await realpath(directory)
  const bundled = manifest.bundledDependencies ?? manifest.bundleDependencies
  if (!Array.isArray(bundled) || !bundled.includes('serialport')) {
    throw new Error('recorder runtime must bundle serialport and its dependency closure')
  }
  const require = createRequire(join(directory, 'package.json'))
  const serialManifest = within(directory, require.resolve('serialport/package.json'))
  const serial = JSON.parse(await readFile(serialManifest, 'utf8'))
  if (serial.version !== manifest.dependencies.serialport) throw new Error('packed serialport version differs from the locked plugin dependency')
  const visited = new Set()
  async function visit(file) {
    if (visited.has(file)) return
    visited.add(file)
    const dependency = JSON.parse(await readFile(file, 'utf8'))
    const from = createRequire(file)
    for (const name of Object.keys(dependency.dependencies ?? {})) {
      await visit(await dependencyManifest(directory, from, name))
    }
  }
  await visit(serialManifest)
  const serialRequire = createRequire(serialManifest)
  const bindingManifest = within(directory, serialRequire.resolve('@serialport/bindings-cpp/package.json'))
  const binding = JSON.parse(await readFile(bindingManifest, 'utf8'))
  if (binding.version !== serial.dependencies['@serialport/bindings-cpp']) throw new Error('packed recorder binding version mismatch')
  const root = dirname(bindingManifest)
  const nativeFiles = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.node'))
  if (nativeFiles.some(file => !file.replaceAll('\\', '/').startsWith('prebuilds/'))) {
    throw new Error('portable recorder runtime must not contain host-specific compiled bindings')
  }
  const mac = await readFile(join(root, 'prebuilds/darwin-x64+arm64/@serialport+bindings-cpp.node'))
  if (mac.length < 8 || mac.readUInt32BE(0) !== 0xcafebabe) throw new Error('recorder macOS prebuild is not a Universal Mach-O binary')
  const count = mac.readUInt32BE(4)
  if (count > 16 || mac.length < 8 + count * 20) throw new Error('invalid recorder Universal Mach-O header')
  const archs = new Set(Array.from({ length: count }, (_, index) => mac.readUInt32BE(8 + index * 20)))
  if (!archs.has(0x01000007) || !archs.has(0x0100000c)) throw new Error('recorder macOS prebuild must support Intel and Apple Silicon')
  const windows = await readFile(join(root, 'prebuilds/win32-x64/@serialport+bindings-cpp.node'))
  const pe = windows.length >= 64 ? windows.readUInt32LE(60) : -1
  if (windows.length < 64 || windows.readUInt16LE(0) !== 0x5a4d || pe < 0 || pe > windows.length - 6
    || windows.readUInt32LE(pe) !== 0x00004550 || windows.readUInt16LE(pe + 4) !== 0x8664) {
    throw new Error('recorder Windows prebuild must be a Windows x64 PE binary')
  }
  const { SerialPort } = require('serialport')
  if (typeof SerialPort !== 'function' || typeof SerialPort.list !== 'function') {
    throw new Error('packed recorder serial provider could not be loaded')
  }
}
