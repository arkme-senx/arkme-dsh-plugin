/** The record service returns the whole tree, which may be rooted above the opened note. */
export interface OwnedRecordExtensionNode {
  recordUid: string
  parentRecordUid: string
  level: number
  record: Record<string, unknown>
  createdAtMillis: number
  protectedContent: boolean
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function integer(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

interface TreeNode { recordUid: string; children: TreeNode[] }

function parseNode(value: unknown, visiting: Set<string>, budget: { remaining: number }): TreeNode | undefined {
  const raw = object(value)
  const recordUid = text(raw.record_uid)
  if (recordUid === '' || visiting.has(recordUid) || --budget.remaining < 0) return undefined
  visiting.add(recordUid)
  const children = (Array.isArray(raw.children) ? raw.children : [])
    .flatMap(child => {
      const parsed = parseNode(child, visiting, budget)
      return parsed === undefined ? [] : [parsed]
    })
  visiting.delete(recordUid)
  return { recordUid, children }
}

function findNode(node: TreeNode, recordUid: string): TreeNode | undefined {
  if (node.recordUid === recordUid) return node
  for (const child of node.children) {
    const found = findNode(child, recordUid)
    if (found !== undefined) return found
  }
  return undefined
}

/** Project only descendants of the opened record; never confuse its siblings with replies. */
export function projectOwnedRecordExtensions(response: unknown, openedRecordUid: string): OwnedRecordExtensionNode[] {
  const data = object(response)
  const requestedUid = openedRecordUid.trim()
  if (requestedUid === '' || text(data.record_uid) !== requestedUid || text(data.root_record_uid) === '') {
    throw new Error('记录延展树与当前快记不匹配')
  }
  const records = new Map<string, Record<string, unknown>>()
  for (const value of Array.isArray(data.records) ? data.records : []) {
    const record = object(value)
    const uid = text(record.record_uid)
    if (uid !== '') records.set(uid, record)
  }
  const edgeDates = new Map<string, number>()
  const childrenByParent = new Map<string, string[]>()
  for (const value of Array.isArray(data.edges) ? data.edges : []) {
    const edge = object(value)
    const parentUid = text(edge.parent_record_uid)
    const childUid = text(edge.child_record_uid)
    if (parentUid === '' || childUid === '' || (edge.status !== undefined && integer(edge.status) !== 1)) continue
    edgeDates.set(childUid, integer(edge.create_at))
    childrenByParent.set(parentUid, [...(childrenByParent.get(parentUid) ?? []), childUid])
  }
  const budget = { remaining: 2000 }
  const suppliedTree = parseNode(data.tree, new Set(), budget)
  const centered = suppliedTree === undefined ? undefined : findNode(suppliedTree, requestedUid)
  const buildFromEdges = (recordUid: string, visiting: Set<string>): TreeNode => {
    if (visiting.has(recordUid) || visiting.size >= 2000) return { recordUid, children: [] }
    visiting.add(recordUid)
    const children = (childrenByParent.get(recordUid) ?? []).map(uid => buildFromEdges(uid, visiting))
    visiting.delete(recordUid)
    return { recordUid, children }
  }
  const root = centered ?? buildFromEdges(requestedUid, new Set())
  const result: OwnedRecordExtensionNode[] = []
  const seen = new Set<string>([requestedUid])
  const visit = (node: TreeNode, parentRecordUid: string, level: number) => {
    if (seen.has(node.recordUid)) return
    seen.add(node.recordUid)
    const record = records.get(node.recordUid)
    const status = record?.status
    const visible = record !== undefined && (status === undefined || integer(status) === 1)
    if (visible) result.push({
      recordUid: node.recordUid,
      parentRecordUid,
      level,
      record,
      createdAtMillis: edgeDates.get(node.recordUid) ?? 0,
      protectedContent: integer(record.content_access_state) !== 1,
    })
    for (const child of node.children) visit(child, node.recordUid, level + 1)
  }
  for (const child of root.children) visit(child, requestedUid, 2)
  return result
}
