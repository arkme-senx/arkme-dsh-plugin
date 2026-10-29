// Run only from an isolated official DSH Profile with the immutable plugin installed.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createArkmeSdk } from '@senguoyun/dsh-arkme/sdk'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'speaker-evidence-acceptance'
export const inject = ['agents', 'tools', 'arkmeData', 'webServer', 'llm']
export function apply(ctx) {
  void (async () => {
    await ctx.get('loader').await()
    assert.equal(process.env.ARKME_EVIDENCE_TEST_ACCOUNT, '3016')
    const root = process.env.ARKME_EVIDENCE_FIXTURES
    assert(root && process.env.ARKME_EVIDENCE_REPORT)
    const report = { account: 3016, checks: [], requests: [], createdFiles: [], createdPeople: [], cleanup: false }
    const fileNames = new Set(), staged = [], undo = []
    let agentHandle, sdk, restore, imported = false, fixtureSetupComplete = false
    const check = (name, detail = {}) => { report.checks.push({ name, ...detail }); console.log(JSON.stringify({ evidence_acceptance: name, ...detail })) }
    const journalPath = join(root, 'fixture-journal.json')
    const cleanupFixtures = async names => {
      const targets = new Set(names), found = new Map()
      assert([...targets].every(name => /^speaker-evidence-[0-9a-f-]{36}\.wav$/.test(name)))
      const toMillis = Date.now() + 1
      for (let offset = 0; offset < 1000 && found.size < targets.size; offset += 50) {
        const [active, history] = await Promise.all([
          ctx.arkmeData.recordingImportList(undefined, { toMillis, limit: 50, offset }),
          ctx.arkmeData.recordingImportHistory({ toMillis, limit: 50, offset }),
        ])
        assert.equal(active.owner.state, 'available')
        for (const item of [...active.items, ...history.items]) {
          if (targets.has(item.fileName) && item.sessionRef) found.set(item.fileName, item.sessionRef)
        }
        if (!active.owner.hasMore && !history.hasMore) break
      }
      for (const sessionRef of found.values()) await ctx.arkmeData.deleteRecordingImportSession(sessionRef)
      for (const file of await sdk.localFiles()) if (targets.has(file.fileName)) await sdk.removeLocalFile(file.fileRef)
      return found.size
    }
    const origin = `http://127.0.0.1:${ctx.webServer.port}`
    let stamp = new Date(2026, 2, 7).getTime(), start = stamp + 36_000_000
    const fresh = () => sdk.recordingTranscriptPage(stamp, { source: 'system' })
    const waitFor = async (read, ready, label, timeout = 180_000) => {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const value = await read()
        if (ready(value)) return value
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      throw new Error(`Timed out: ${label}`)
    }
    try {
      assert.equal((await ctx.arkmeData.testLogin(3016)).userId, 3016)
      sdk = createArkmeSdk({ fetchImpl: async (path, init) => {
        const before = performance.now()
        const response = await fetch(new URL(path, origin), { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000), headers: { ...init?.headers, Origin: origin } })
        let operation = String(path)
        if (typeof init?.body === 'string') { try { operation = JSON.parse(init.body).operation ?? operation } catch {} }
        report.requests.push({ operation, status: response.status, elapsedMillis: Math.round(performance.now() - before) })
        return response
      } })
      const capabilities = await sdk.recordingSpeakerEvidenceQuery({ action: 'capabilities' })
      assert(capabilities.supported)
      for (const action of ['consistency', 'compare', 'members', 'candidates', 'build', 'correction-target', 'correction-subrange', 'correction-preview']) assert(capabilities.actions.includes(action))
      check('real-test-capabilities')
      let previous = []
      try { previous = JSON.parse(await readFile(journalPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
      assert(Array.isArray(previous))
      if (previous.length) check('previous-owned-fixtures-cleaned', { count: await cleanupFixtures(previous) })
      await writeFile(journalPath, '[]\n', { mode: 0o600 })
      fixtureSetupComplete = true
      // Refuse to mutate an occupied day. Every import and cleanup is bound to this run's filenames.
      for (let day = 0; day < 8; day++) {
        stamp = new Date(2026, 2, 7 + day).getTime()
        if ((await fresh()).items.length === 0) break
        assert(day < 7, 'no empty fixture day found')
      }
      start = stamp + 36_000_000
      check('empty-fixture-day', { dateStamp: stamp })
      for (let i = 0; i < 3; i++) {
        const fileName = `speaker-evidence-${randomUUID()}.wav`
        fileNames.add(fileName)
        report.createdFiles.push(fileName)
        await writeFile(journalPath, JSON.stringify([...fileNames]) + '\n', { mode: 0o600 })
        const bytes = await readFile(join(root, `public-clip-${i}.wav`))
        const file = await sdk.stageFile(new File([bytes], fileName, { type: 'audio/wav' }))
        staged.push(file.fileRef)
        const task = await sdk.importRecordingFile({ fileRef: file.fileRef, startAtMillis: start + i * 60_000, ownership: 'self' })
        imported = true
        const accepted = await waitFor(() => sdk.recordingImportStatus(task.importRef), job => ['accepted', 'failed', 'cancelled'].includes(job.phase), 'upload admission')
        assert.equal(accepted.phase, 'accepted', accepted.errorCode)
        check('owned-fixture-admitted', { index: i })
      }
      const choose = rows => [0, 1, 2].map(i => rows.find(item => item.startAtMillis >= start + i * 60_000 && item.startAtMillis < start + (i + 1) * 60_000 && item.endAtMillis - item.startAtMillis >= 2000))
      let page = await waitFor(fresh, value => choose(value.items).every(Boolean), 'speech intervals of at least two seconds in all three public recordings', 300_000)
      assert(page.items.every(item => item.startAtMillis >= start && item.endAtMillis < start + 180_000))
      const chosen = choose(page.items)
      const anchors = chosen.map(item => item.startAtMillis)
      const at = (rows, index) => { const row = rows.find(item => item.startAtMillis === anchors[index]); assert(row); return row }
      check('real-refactored-transcript-import', { intervals: page.items.length })

      // Use the official Agent and registered Tool owner; a deterministic model avoids paid inference.
      let plannedCall
      ctx.llm.registerAdapter(['speaker-evidence-acceptance'], {
        providerInfo: id => ({ id, name: id }), providerRetryPolicy: () => undefined,
        listModels: async () => [{ id: 'local', name: 'local' }], resolveModel: async (provider, id) => ({ provider, id, name: id }),
        async prepareCall(provider, model) { return { model: await this.resolveModel(provider, model), stream: options => this.stream(options) } },
        async *stream() {
          if (plannedCall) {
            const block = plannedCall
            plannedCall = undefined
            yield { type: 'block-start', index: 0, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
            yield { type: 'block-end', index: 0, block }
            yield { type: 'finish', reason: { kind: 'tool-calls' } }
            return
          }
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: '测试会话' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: '测试会话' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      })
      agentHandle = await ctx.agents.create({ sessionId: `evidence-${randomUUID()}`, meta: { cwd: process.cwd() }, agentOptions: { provider: 'speaker-evidence-acceptance', model: 'local' } })
      const agent = agentHandle.agent
      await agent.whenIdle()
      for (const tool of ['arkme_recording_speaker_evidence', 'arkme_recording_speaker_evidence_build', 'arkme_recording_speaker_correction_context', 'arkme_recording_speaker_correct']) assert(ctx.tools.get(tool, agent))
      const tool = async (name, args, message) => {
        const id = randomUUID()
        plannedCall = { type: 'tool-call', id, name, arguments: JSON.stringify(args) }
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: message }] }))
        await agent.whenIdle()
        const result = agent.session.snapshotEvents().find(event => event.type === 'tool/result' && event.data.message.source.callId === id)?.data.message
        assert(result, 'official Agent did not publish the tool result')
        return { isError: result.isError, text: JSON.stringify(result.content) }
      }
      const read = await tool('arkme_recording_speaker_evidence', { request_json: JSON.stringify({ action: 'capabilities' }) }, '读取测试服的声音证据能力')
      assert(!read.isError)
      const buildArgs = { request_json: JSON.stringify({ action: 'build', itemRefs: chosen.map(item => item.itemRef) }) }
      assert((await tool('arkme_recording_speaker_evidence', buildArgs, '验证只读入口拒绝计算')).isError)
      const pending = await tool('arkme_recording_speaker_evidence_build', buildArgs, '为本次新导入的三个公开测试片段计算声音证据')
      assert(!pending.isError && pending.text.includes('confirmation_required'))
      const built = await tool('arkme_recording_speaker_evidence_build', buildArgs, '确认计算刚才这三个测试片段')
      assert(!built.isError && !built.text.includes('confirmation_required'), built.text)
      check('real-agent-discovery-read-confirmation-build')

      const compare = await waitFor(() => sdk.recordingSpeakerEvidenceQuery({ action: 'compare', itemRefs: chosen.map(item => item.itemRef), referenceA: [chosen[0].itemRef], referenceB: [chosen[1].itemRef] }), value => value.supported && value.state === 'ready', 'acoustic comparison completion')
      assert.equal(compare.items[0].distance_a, null)
      assert.equal(compare.items[1].distance_b, null)
      check('real-a-b-and-self-reference', { compared: compare.items.length, readyCount: compare.items.filter(item => item.status === 'ready').length, insufficientReasons: compare.items.filter(item => item.status === 'insufficient').map(item => item.reason) })
      const candidates = await sdk.recordingSpeakerEvidenceQuery({ action: 'candidates', referenceA: [chosen[0].itemRef], limit: 2 })
      assert('totalCount' in candidates)
      check('same-day-candidates')

      const apply = async (index, target, selections, facts = {}) => {
        page = await fresh()
        const indices = Array.isArray(index) ? index : [index]
        const row = at(page.items, indices[0]), selectedRefs = indices.map(i => at(page.items, i).itemRef), context = await sdk.recordingSpeakerCorrectionContext(row.itemRef)
        assert(context.supported)
        const input = { itemRef: row.itemRef, itemRefs: selectedRefs, target, detach: target.kind === 'unknown', soundSource: 'in_person', ...facts, expectedVersion: context.version, idempotencyKey: randomUUID(), ...(selections ? { selections: [{ itemRef: row.itemRef, ...selections }] } : {}) }
        const preview = await sdk.previewRecordingSpeakerCorrection(input)
        assert.equal(preview.affectedCount, selectedRefs.length)
        assert.equal(await sdk.recordingSpeakerCorrectionResult({ itemRef: row.itemRef, action: 'apply', idempotencyKey: input.idempotencyKey }), null)
        const result = await sdk.applyRecordingSpeakerCorrection({ ...input, intentToken: preview.intentToken })
        assert.equal(result.affectedCount, selectedRefs.length)
        assert(result.undoRef)
        undo.push({ index: indices[0], undoRef: result.undoRef })
        const recovered = await sdk.recordingSpeakerCorrectionResult({ itemRef: row.itemRef, action: 'apply', idempotencyKey: input.idempotencyKey })
        assert.equal(recovered.version, result.version)
        assert.equal((await sdk.applyRecordingSpeakerCorrection({ ...input, intentToken: preview.intentToken })).version, result.version)
        return result
      }
      restore = async () => {
        const last = undo.at(-1)
        const rows = (await fresh()).items, row = at(rows, last.index), context = await sdk.recordingSpeakerCorrectionContext(row.itemRef)
        assert(context.supported)
        const result = await sdk.undoRecordingSpeakerCorrection({ itemRef: row.itemRef, undoRef: last.undoRef, expectedVersion: context.version, idempotencyKey: randomUUID() })
        assert.equal(result.learningStateAtCommit, 'reconciled')
        undo.pop()
      }
      const duration = chosen[2].endAtMillis - chosen[2].startAtMillis
      assert(duration > 1000)
      await apply(2, { kind: 'unknown' }, { startOffsetMillis: 100, endOffsetMillis: duration - 100 })
      await restore()
      check('unknown-subrange-preview-apply-result-replay-undo')
      const person = (await sdk.recordingSpeakerCandidates()).find(item => item.kind === 'speaker' && !item.label.startsWith('证据验收-'))
      assert(person, 'test account needs an existing speaker for the existing-target contract')
      const name = `证据验收-${randomUUID().slice(0, 8)}`
      report.createdPeople.push(name)
      await apply(0, { kind: 'new', name })
      assert((await sdk.recordingSpeakerCandidates()).some(item => item.label === name))
      await restore()
      assert(!(await sdk.recordingSpeakerCandidates()).some(item => item.label === name))
      check('new-person-created-and-withdrawn')
      await apply([0, 1], { kind: 'existing', speakerRef: person.speakerRef })
      page = await fresh()
      const group = at(page.items, 0).itemRef
      const summary = await sdk.recordingSpeakerEvidenceQuery({ action: 'consistency', groupRefs: [group] })
      assert(summary.supported && summary.groups[0].total_count >= 2)
      const members = await sdk.recordingSpeakerEvidenceQuery({ action: 'members', groupRefs: [group], sort: 'time', limit: 1 })
      assert(members.hasMore)
      const next = await sdk.recordingSpeakerEvidenceQuery({ action: 'members', groupRefs: [group], sort: 'time', limit: 1, version: members.version, cursor: members.nextCursor })
      assert.equal(next.items.length, 1)
      assert.notEqual(next.items[0].startAtMillis, members.items[0].startAtMillis)
      assert((await sdk.recordingSpeakerCorrectionContext(next.items[0].itemRef)).supported)
      const playback = await sdk.recordingPlayback(next.items[0].itemRef)
      assert(playback.playbackRef)
      const stream = await fetch(new URL(sdk.mediaUrl(playback.playbackRef), origin), { headers: { Range: 'bytes=0-1023', Origin: origin } })
      assert([200, 206].includes(stream.status))
      assert((await stream.arrayBuffer()).byteLength > 0)
      check('new-existing-complete-group-members-and-playback', { total: summary.groups[0].total_count })
      const queries = [
        { action: 'consistency', groupRefs: [group] },
        { action: 'members', groupRefs: [group], limit: 50 },
        { action: 'candidates', referenceA: [group], limit: 50 },
        { action: 'compare', itemRefs: [group], referenceA: [at(page.items, 2).itemRef] },
      ]
      const timings = []
      await Promise.all(queries.map(async query => {
        for (let i = 0; i < 20; i++) {
          const before = performance.now()
          await sdk.recordingSpeakerEvidenceQuery(query)
          timings.push(Math.round(performance.now() - before))
        }
      }))
      timings.sort((a, b) => a - b)
      check('bounded-real-read-load', { requests: timings.length, concurrency: 4, p50Millis: timings[39], p95Millis: timings[75], maxMillis: timings.at(-1) })
      await restore()
      check('existing-person-batch-undone')
      await apply(2, { kind: 'unknown' }, undefined, { rejectedSpeakerRef: person.speakerRef, soundSource: 'playback' })
      page = await fresh()
      const excludedRow = at(page.items, 2), excluded = await sdk.recordingSpeakerCorrectionContext(excludedRow.itemRef)
      assert(excluded.supported && excluded.soundSource === 'playback' && excluded.excludedSpeakers.some(item => item.optionKey === person.optionKey))
      await assert.rejects(sdk.previewRecordingSpeakerCorrection({ itemRef: excludedRow.itemRef, itemRefs: [excludedRow.itemRef], target: { kind: 'existing', speakerRef: person.speakerRef }, detach: false, expectedVersion: excluded.version, idempotencyKey: randomUUID() }))
      await restore()
      check('negative-evidence-playback-and-target-exclusion')
      check('owned-person-and-learning-withdrawn')
      const controller = new AbortController(); controller.abort()
      await assert.rejects(sdk.recordingSpeakerEvidenceQuery({ action: 'capabilities' }, controller.signal))
      check('sdk-cancellation')
    } catch (error) {
      report.error = { name: error.name, message: error.message }
      console.error(JSON.stringify({ evidence_acceptance_error: report.error }))
    } finally {
      try {
        while (undo.length && restore) {
          try { await restore() } catch (error) { report.undoCleanupError = error.message; break }
        }
        // Only exact files created by this run may be removed. Keep failed cleanup visible.
        if (imported) {
          const count = await cleanupFixtures([...fileNames])
          assert.equal((await fresh()).items.length, 0)
          check('owned-recordings-deleted', { count })
        } else {
          for (const ref of staged) await sdk.removeLocalFile(ref)
        }
        if (fixtureSetupComplete) await writeFile(journalPath, '[]\n', { mode: 0o600 })
        report.cleanup = fixtureSetupComplete && undo.length === 0
      } catch (error) { report.cleanupError = error.message }
      await agentHandle?.dispose()
      await ctx.arkmeData.logout()
      await writeFile(process.env.ARKME_EVIDENCE_REPORT, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
      console.log(JSON.stringify({ evidence_acceptance_complete: !report.error && report.cleanup, cleanup: report.cleanup }))
    }
  })().catch(error => console.error(JSON.stringify({ evidence_acceptance_boot_error: error.message })))
}
