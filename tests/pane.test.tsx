import type { Engine } from 'claude-code'
import { webLines } from '../hooks/register'
import { optionsFor, parseChoice } from '../src/choice'
import { contextText, costText, callLabel, usd } from '../src/format'
import { costOf, rate, windowOf } from '../src/pricing'
import { node } from '../src/state'
import { expect, test } from 'claude-code/testing'

const pane = (bodyColumns: number) => ({
  plugin: 'agent-tree',
  component: 'Pane',
  requestId: 'agent-tree',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const)

test('the pane shows a subagent running, then done with its tokens', async ($, on) => {
  // the hooks below stand for the engine
  on('command.register', () => ({ value: { command: 'agent-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('process.spawn', async function* () { return { value: { code: 1, signal: null } } })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 't1', prompt: 'find X', description: 'Find X',
    subagentType: 'reader-low', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5',
  })
  await $.tool.call({ tool: 'Grep', pattern: 'X', agentId: 'a1' })
  // the handback tool is how a subagent reports: it counts as no work
  await $.tool.call({ tool: 'SubagentHandback', agentId: 'a1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(100), surface })
    expect((await ui.find({ type: 'Text', text: /running/ }))?.text).toBe('└─ [running] reader-low · haiku-5-5')
    await ui.unmount()
  }

  await $.turn.complete({
    answer: '3 uses found\nrest', durationMs: 3900, isAborted: false, turnId: 'x', reason: 'answer', agentId: 'a1',
    usage: { model: 'claude-haiku-5-5', input_tokens: 300, output_tokens: 250, cache_read_input_tokens: 6000, cache_creation_input_tokens: 1000 },
  })

  const wide = await $.ui.mount({ ...pane(100), surface: 'desktop' })
  expect((await wide.find({ type: 'Text', text: /Find X/ }))?.text).toBe('     Find X · 7.3k in (6.0k cache) / 250 out · 1 tool · 3.9s')
  expect((await wide.find({ type: 'Text', text: /uses/ }))?.text).toBe('     3 uses found')
  await wide.unmount()

  // narrow pane: one detail per line, none longer than the width
  const narrow = await $.ui.mount({ ...pane(30), surface: 'desktop' })
  expect((await narrow.find({ type: 'Text', text: /\[ok\]/ }))?.text).toBe('└─ [ok] reader-low')
  expect((await narrow.find({ type: 'Text', text: /tool/ }))?.text).toBe('     1 tool · 3.9s')
  expect((await narrow.find({ type: 'Text', text: /6.0k cache/ }))?.text).toBe("     7.3k in (6.0k cache) / 2…")
  await narrow.unmount()
})

const webLine = async ($: Engine, cols: number, text = /Web/) => {
  const ui = await $.ui.mount({ ...pane(cols), surface: 'desktop' })
  const line = (await ui.find({ type: 'Text', text }))?.text
  await ui.unmount()
  return line
}

test('the server reports a busy port, then the tree reaches the next one', async ($, on) => {
  const posts: string[] = []
  on('command.register', () => ({ value: { command: 'agent-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('http.fetch', (_, e) => {
    posts.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: '' } }
  })
  // the first port in use, the next one listening (a line split in two pieces), then it exits
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'BUSY 47821\nLIS' }
    yield { stream: 'stdout' as const, text: 'TEN 47822 k3y\n' }
    return { value: { code: 0, signal: null } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(await webLine($, 100)).toBe('Web: server stopped')
  expect(posts).toEqual(['http://127.0.0.1:47822/state?t=k3y'])
})

test('the page line names the ports in use, joined on a wide pane, apart on a narrow one', () => {
  const web = { status: 'listening' as const, port: 47822, token: 'k3y', error: '' }
  expect(webLines({ ...web, busy: [] }, false)).toEqual(['Web: http://127.0.0.1:47822/?t=k3y'])
  expect(webLines({ ...web, busy: [47821] }, false)).toEqual(['Web: http://127.0.0.1:47822/?t=k3y (47821 in use)'])
  expect(webLines({ ...web, busy: [47821] }, true)).toEqual(['Web: http://127.0.0.1:47822/?t=k3y', '  47821 in use'])
})

test('the pane says when every port is in use, or node is missing', async ($, on) => {
  let isNodeMissing = false
  on('command.register', () => ({ value: { command: 'agent-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.spawn', async function* () {
    if (isNodeMissing) throw new Error('ENOENT')
    yield { stream: 'stdout' as const, text: 'BUSY 47829\nBUSY 47830\nFAILED 47830 EADDRINUSE\n' }
    return { value: { code: 1, signal: null } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(await webLine($, 100)).toBe('Web: ports 47821-47830 in use')

  isNodeMissing = true
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(await webLine($, 100)).toBe('Web: node not found')
})

test('the answer picks the views; anything unknown falls back to the pane', () => {
  const only = (view: { pane?: boolean; web?: boolean; window?: boolean }) => ({ pane: false, web: false, window: false, ...view })
  expect(parseChoice('Web page')).toEqual(only({ web: true }))
  expect(parseChoice('Agents pane, Edge window')).toEqual(only({ pane: true, window: true }))
  expect(parseChoice('something typed under Other')).toEqual(only({ pane: true }))
  expect(parseChoice('')).toEqual(only({ pane: true }))
  expect(optionsFor(false)).toEqual(['Agents pane', 'Web page'])
  expect(optionsFor(true)).toEqual(['Agents pane', 'Web page', 'Edge window'])
})

test('a tool call becomes one line: the tool and the first thing it was given', () => {
  expect(callLabel({ tool: 'Grep', pattern: 'useState', path: 'src' })).toBe('Grep: useState')
  expect(callLabel({ tool: 'Bash', command: 'git status\n  --short' })).toBe('Bash: git status --short')
  expect(callLabel({ tool: 'Read', file_path: 'a'.repeat(200) })).toBe(`Read: ${'a'.repeat(80)}`)
  expect(callLabel({ tool: 'TodoWrite', todos: [] })).toBe('TodoWrite')
})

test('a subagent keeps its calls and answer, and its end is announced', async ($, on) => {
  const bodies: string[] = []
  const toasts: string[] = []
  const notes: string[] = []
  let spawned = 0
  let stop = () => {}
  on('command.register', () => ({ value: { command: 'agent-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${++spawned}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('http.fetch', (_, e) => {
    bodies.push(String(e.init?.body))
    return { value: { status: 200, ok: true, headers: {}, text: '' } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: false, reason: 'disabled' } }
  })
  // the server listens and stays up until the test ends
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'LISTEN 47821 k3y\n' }
    await new Promise<void>(resolve => { stop = resolve })
    return { value: { code: 0, signal: null } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const description of ['Read many', 'Fail', 'Stop']) {
    await $.agent.spawn({
      tool_use_id: description, prompt: 'p', description,
      subagentType: 'reader-low', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5',
    })
  }
  for (let i = 0; i < 60; i++) await $.tool.call({ tool: 'Read', file_path: `f${i}`, agentId: 'a1' })
  await $.tool.call({ tool: 'SubagentHandback', agentId: 'a1' })

  const end = (agentId: string, reason: 'answer' | 'error' | 'aborted', answer: string) =>
    $.turn.complete({ answer, durationMs: 1000, isAborted: reason === 'aborted', turnId: agentId, reason, agentId })
  await end('a1', 'answer', 'done\nmore')
  await end('a2', 'error', 'boom')
  await end('a3', 'aborted', '')
  await new Promise(resolve => setTimeout(resolve, 400)) // the last send waits its gap

  const [a1] = JSON.parse(bodies.at(-1) ?? 'null').agents
  expect(a1.tools).toBe(60) // the handback is no work
  expect(a1.calls).toHaveLength(50) // the last 50, in order
  expect([a1.calls[0], a1.calls[49]]).toEqual(['Read: f10', 'Read: f59'])
  expect(a1.answer).toBe('done\nmore')
  expect(toasts).toEqual([
    'Agent finished · reader-low: Read many',
    'Agent failed · reader-low: Fail',
    'Agent aborted · reader-low: Stop',
  ])
  expect(notes).toEqual(['reader-low: Fail']) // an abort is the user's own doing: no system notification
  stop()
})

test('what a request costs is estimated from list prices, and judged against fixed ceilings', () => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const per = (model: string, part: Partial<typeof usage>) => costOf(model, { ...usage, ...part })
  const near = (cost: number | undefined) => (cost === undefined ? cost : Math.round(cost * 1e6) / 1e6) // float noise
  expect(near(per('claude-sonnet-5-5', { input_tokens: 1e6 }))).toBe(2)
  expect(near(per('claude-sonnet-5-5', { cache_read_input_tokens: 1e6 }))).toBe(0.2)
  expect(near(per('claude-sonnet-5-5', { cache_creation_input_tokens: 1e6 }))).toBe(2.5)
  expect(near(per('claude-opus-5-5', { output_tokens: 1e6 }))).toBe(20) // 5.5 is $4/$20, dearer Opus 5 is $5/$25
  expect(near(per('claude-opus-5', { output_tokens: 1e6 }))).toBe(25)
  expect(near(per('claude-opus-4-8', { output_tokens: 1e6 }))).toBe(25)
  expect(per('claude-opus-4-1', { output_tokens: 1e6 })).toBeUndefined() // an older 4.x: no cost rather than a wrong one
  // Haiku 5.5 costs more per token once the prompt passes 100K
  expect(near(per('claude-haiku-5-5', { input_tokens: 50_000 }))).toBe(0.005)
  expect(near(per('claude-haiku-5-5', { input_tokens: 200_000 }))).toBe(0.1)
  expect(near(per('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 1e6 }))).toBe(2.6)
  expect(per('some-other-model', { input_tokens: 1e6 })).toBeUndefined()
  expect(windowOf('claude-opus-5-5')).toBe(1_000_000)
  expect(windowOf('claude-haiku-4-5')).toBe(200_000)

  expect([0.03, 0.031, 0.15, 0.5, 2, 2.01].map(rate)).toEqual(['perfect', 'ok', 'ok', 'fair', 'poor', 'awful'])
})

test('cost and context read as short text', () => {
  const agent = { ...node('a', 'Explore', 'd', 'claude-haiku-5-5'), contextTokens: 126_000, contextWindow: 1_000_000 }
  expect([usd(0.0043), usd(0.0123), usd(0.123), usd(1.234)]).toEqual(['$0.0043', '$0.012', '$0.123', '$1.23'])
  expect([usd(0.00996), usd(0.9996)]).toEqual(['$0.010', '$1.00']) // no `$0.0100` or `$1.000`
  expect(costText(agent)).toBe('')
  expect(costText({ ...agent, costUsd: 0.0043 })).toBe('~$0.0043')
  expect(costText({ ...agent, costUsd: 0.0043, rating: 'ok' })).toBe('~$0.0043 · ok')
  expect(costText({ ...agent, costUsd: 0.0043, isCostPartial: true })).toBe('~$0.0043+') // short: an unpriced request
  expect(contextText(agent)).toBe('ctx 126.0k / 1.0M (13%)')
  expect(contextText({ ...agent, contextWindow: 0 })).toBe('ctx 126.0k')
  expect(contextText({ ...agent, contextTokens: 0 })).toBe('')
})

test('each request adds its cost and fills the context; the end of a subagent rates the cost', async ($, on) => {
  const bodies: string[] = []
  let stop = () => {}
  const usage = (input: number, output: number) => ({
    model: 'claude-haiku-5-5', input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
  })
  on('command.register', () => ({ value: { command: 'agent-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  on('http.fetch', (_, e) => {
    bodies.push(String(e.init?.body))
    return { value: { status: 200, ok: true, headers: {}, text: '' } }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'LISTEN 47821 k3y\n' }
    await new Promise<void>(resolve => { stop = resolve })
    return { value: { code: 0, signal: null } }
  })
  // two requests of the subagent's turn, each ending in a stop chunk that carries its usage
  let index = 0
  on('turn.step', async function* (_, e) {
    const request = index++
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: usage(request === 0 ? 1000 : 3000, request === 0 ? 500 : 100) }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 't', prompt: 'p', description: 'Cheap one',
    subagentType: 'reader-low', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5',
  })
  for (const i of [0, 1]) {
    for await (const _ of $.turn.step({ turnId: 'x', index: i, model: 'claude-haiku-5-5', agentId: 'a1' } as never)) void _
  }
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 'x', reason: 'answer', agentId: 'a1' })
  await new Promise(resolve => setTimeout(resolve, 400))

  const [a1] = JSON.parse(bodies.at(-1) ?? 'null').agents
  // (1000 + 3000) input at $0.10 and (500 + 100) output at $0.50, per million
  expect(Math.round(a1.costUsd * 1e7) / 1e7).toBe(0.0007)
  expect(a1.contextTokens).toBe(3000) // the last request's prompt, not a sum
  expect(a1.contextWindow).toBe(1_000_000)
  expect(a1.rating).toBe('perfect')
  stop()
})

test('a stopped or partly priced run is not rated, and an interrupted step closes the stream beneath', async ($, on) => {
  const bodies: string[] = []
  const models = ['claude-haiku-5-5', 'some-unpriced-model', 'claude-haiku-5-5'] // agent a1: priced, unpriced, priced
  let stop = () => {}
  let isClosed = false
  let spawned = 0
  let request = 0
  on('command.register', () => ({ value: { command: 'agent-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${++spawned}` }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: false, reason: 'disabled' } }))
  on('http.fetch', (_, e) => {
    bodies.push(String(e.init?.body))
    return { value: { status: 200, ok: true, headers: {}, text: '' } }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'LISTEN 47821 k3y\n' }
    await new Promise<void>(resolve => { stop = resolve })
    return { value: { code: 0, signal: null } }
  })
  on('turn.step', async function* (_, e) {
    try {
      const model = models[request++ % models.length] ?? 'claude-haiku-5-5'
      yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: { model, input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
      yield { kind: 'text' as const, index: 0, text: 'more' }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
    } finally {
      isClosed = true
    }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const description of ['Mixed', 'Stopped']) {
    await $.agent.spawn({
      tool_use_id: description, prompt: 'p', description,
      subagentType: 'reader-low', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5',
    })
  }
  for (const i of [0, 1, 2]) {
    for await (const _ of $.turn.step({ turnId: 'x', index: i, model: 'claude-haiku-5-5', agentId: 'a1' } as never)) void _
  }
  // a2 stops after one chunk, as an interrupted request does: the consumer leaves the loop early
  for await (const _ of $.turn.step({ turnId: 'y', index: 0, model: 'claude-haiku-5-5', agentId: 'a2' } as never)) break
  expect(isClosed).toBe(true)

  const end = (agentId: string, reason: 'answer' | 'aborted') =>
    $.turn.complete({ answer: 'x', durationMs: 1000, isAborted: reason === 'aborted', turnId: agentId, reason, agentId })
  await end('a1', 'answer')
  await end('a2', 'aborted')
  await new Promise(resolve => setTimeout(resolve, 400))

  const [a1, a2] = JSON.parse(bodies.at(-1) ?? 'null').agents
  expect(a1.isCostPartial).toBe(true) // the unpriced request is missing from its total
  expect(a1.rating).toBeUndefined() // ...so no verdict
  expect(a2.rating).toBeUndefined() // a stopped run is not praised
  stop()
})
