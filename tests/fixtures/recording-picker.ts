import { RecordingFilePicker } from '../../src/client/recordings/recording-file-picker.js'
const dialog = document.querySelector<HTMLDialogElement>('#upload')!
const picker = new RecordingFilePicker(() => ({ dialogOpen: dialog.open, focused: document.hasFocus(), activation: navigator.userActivation.isActive }))
const originalLog = console.info
console.info = (...args) => { originalLog(...args); document.querySelector('#log')!.textContent += args.join(' ') + '\n' }
const original = async () => {
  console.info('[LegacyPicker]', 'requested')
  try {
    const choose = window.showOpenFilePicker
    await choose({ multiple: true, types: [{ description: '录音', accept: { 'audio/*': ['.wav', '.mp3', '.m4a'] } }] })
    console.info('[LegacyPicker]', 'selected')
  } catch (e) {
    const error = e as Error
    console.info('[LegacyPicker]', JSON.stringify({ name: error.name, message: error.message, dialogOpen: dialog.open }))
    document.querySelector('#notice')!.textContent = `${error.name}: ${error.message}`
  }
}
const fixed = async () => {
  const result = await picker.run('browser', async () => await window.showOpenFilePicker({ multiple: true, types: [{ description: '录音', accept: { 'audio/*': ['.wav', '.mp3', '.m4a'] } }] }))
  if (result.status === 'error') document.querySelector('#notice')!.textContent = result.message
}
document.querySelector('#open')!.addEventListener('click', () => dialog.showModal())
document.querySelector('#legacy')!.addEventListener('click', () => { void original() })
document.querySelector('#double')!.addEventListener('click', () => { void original(); void original() })
document.querySelector('#fixed')!.addEventListener('click', () => { void fixed(); void fixed() })
dialog.addEventListener('close', () => picker.event('dialog-closed'))
dialog.addEventListener('cancel', () => picker.event('dialog-cancel'))
Object.assign(window, { fixtureOriginal: original, fixtureFixed: fixed })
dialog.showModal()
