// Isolated UI fixture: no authenticated host, network requests, file reads or uploads.
export async function callArkme() { return { items: [], owner: { state: 'available' } } }
export async function lookupArkmeRecordingImport() { return null }
export async function uploadArkmeRecording() { throw new Error('Uploads are disabled in the picker fixture') }
