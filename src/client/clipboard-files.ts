export function arkmeClipboardFiles(clipboardData: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const itemFiles = Array.from(clipboardData.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  return itemFiles.length > 0 ? itemFiles : Array.from(clipboardData.files)
}
export function arkmeClipboardImageFiles(clipboardData: Pick<DataTransfer, 'files' | 'items'>): File[] {
  return arkmeClipboardFiles(clipboardData).filter(file => file.type.toLowerCase().startsWith('image/'))
}
