// Supplemental source-level checks; not a substitute for `claude plugin test .`.
// Tested with Node 22.16.0: node --experimental-vm-modules --test tests/tool-call-history.offline.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import { test } from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function fixture() {
  const context = createContext({})
  const cache = new Map()
  const hooks = new Map()
  let pushes = 0
  // Model the atom boundary only. Repository event handlers and formatting stay real.
  const engine = new SyntheticModule(['atom', 'read', 'update'], function () {
    this.setExport('atom', (key, initial) => ({ key: key.plugin + ':' + key.key, initial }))
    this.setExport('read', async ($, a) => $.values.get(a.key) ?? a.initial)
    this.setExport('update', async ($, a, fn) => {
      $.values.set(a.key, fn($.values.get(a.key) ?? a.initial))
    })
  }, { context })
  // No server, process, provider, HTTP, or model is started by these checks.
  const server = new SyntheticModule(['push'], function () {
    this.setExport('push', async () => { pushes++ })
  }, { context })
  async function load(path) {
    if (cache.has(path)) return cache.get(path)
    const source = await readFile(path, 'utf8')
    const module = new SourceTextModule(stripTypeScriptTypes(source), { context, identifier: path })
    cache.set(path, module)
    await module.link(async (specifier, parent) => {
      if (specifier === 'claude-code') return engine
      if (specifier === './web/serve') return server
      assert.ok(specifier.startsWith('./'), 'Unexpected import: ' + specifier)
      return load(resolve(dirname(parent.identifier), specifier + '.ts'))
    })
    return module
  }
  const module = await load(resolve(root, 'src/tree.ts'))
  await module.evaluate()
  module.namespace.registerTree((name, callback) => hooks.set(name, callback))
  const $ = { values: new Map(), ui: { toast() {}, notify: async () => {} } }
  const plain = value => JSON.parse(JSON.stringify(value))
  return {
    call: (event, next = async () => ({ result: {} })) => hooks.get('tool.call')($, event, next),
    spawn: async id => hooks.get('agent.spawn')($,
      { subagentType: 'worker', description: 'test' }, async () => ({ agentId: id, model: 'test-model' })),
    state: () => plain($.values.get('agent-tree:tree')),
    pushes: () => pushes,
  }
}

test('main history records 60 calls but retains exactly the most recent 50', async () => {
  const f = await fixture()
  for (let i = 0; i < 60; i++) await f.call({ tool: 'Read', file_path: 'f' + i })
  assert.equal(f.state()?.main.tools, 60)
  assert.deepEqual(f.state().main.calls, Array.from({ length: 50 }, (_, i) => 'Read: f' + (i + 10)))
  assert.equal(f.pushes(), 60)
})

test('history is bounded across 10,000 main-session calls', async () => {
  const f = await fixture()
  for (let i = 0; i < 10_000; i++) await f.call({ tool: 'Read', file_path: 'f' + i })
  assert.equal(f.state()?.main.tools, 10_000)
  assert.equal(f.state().main.calls.length, 50)
  assert.equal(f.state().main.calls[0], 'Read: f9950')
  assert.equal(f.state().main.calls.at(-1), 'Read: f9999')
})

test('main and two subagents retain independent capped histories', async () => {
  const f = await fixture()
  await f.spawn('a')
  await f.spawn('b')
  for (let i = 0; i < 60; i++) {
    await f.call({ tool: 'Read', file_path: 'main-' + i })
    await f.call({ agentId: 'a', tool: 'Read', file_path: 'a-' + i })
  }
  await f.call({ agentId: 'b', tool: 'Read', file_path: 'b-0' })
  const s = f.state()
  assert.equal(s.main.tools, 60)
  assert.deepEqual(s.main.calls, Array.from({ length: 50 }, (_, i) => 'Read: main-' + (i + 10)))
  assert.equal(s.agents[0].tools, 60)
  assert.deepEqual(s.agents[0].calls, Array.from({ length: 50 }, (_, i) => 'Read: a-' + (i + 10)))
  assert.equal(s.agents[1].tools, 1)
  assert.deepEqual(s.agents[1].calls, ['Read: b-0'])
})

test('SubagentHandback is forwarded but never counted or published in either loop', async () => {
  const f = await fixture()
  await f.spawn('a')
  await f.call({ tool: 'Read', file_path: 'main' })
  await f.call({ agentId: 'a', tool: 'Read', file_path: 'child' })
  const before = f.state(), pushes = f.pushes()
  for (const agentId of [undefined, 'a']) {
    const event = { agentId, tool: 'SubagentHandback', prompt: 'not a normal tool' }
    const result = { sentinel: true }
    let forwards = 0
    assert.equal(await f.call(event, async e => { forwards++; assert.equal(e, event); return result }), result)
    assert.equal(forwards, 1)
  }
  assert.deepEqual(f.state(), before)
  assert.equal(f.pushes(), pushes)
})

test('normal call is forwarded once without changing the event or returned result', async () => {
  const f = await fixture()
  const event = Object.freeze({ tool: 'Read', file_path: 'file.txt' })
  const result = { content: 'test' }
  let forwards = 0
  assert.equal(await f.call(event, async e => { forwards++; assert.equal(e, event); return result }), result)
  assert.equal(forwards, 1)
  assert.deepEqual(f.state()?.main.calls, ['Read: file.txt'])
})

test('downstream rejection is preserved and the attempted call remains recorded', async () => {
  const f = await fixture()
  const error = new Error('expected tool failure')
  await assert.rejects(f.call({ tool: 'Read', file_path: 'missing.txt' }, async () => { throw error }), e => e === error)
  assert.equal(f.state()?.main.tools, 1)
  assert.deepEqual(f.state().main.calls, ['Read: missing.txt'])
})

test('main labels use real normalization, 80-character detail cap and empty-detail behavior', async () => {
  const f = await fixture()
  await f.call({ tool: 'Read', file_path: '  alpha\n beta\t' + 'x'.repeat(100) })
  await f.call({ tool: 'Read', file_path: '  \n\t' })
  await f.call({ tool: 'Read' })
  const expected = ('alpha beta ' + 'x'.repeat(100)).slice(0, 80)
  assert.deepEqual(f.state()?.main.calls, ['Read: ' + expected, 'Read', 'Read'])
})
