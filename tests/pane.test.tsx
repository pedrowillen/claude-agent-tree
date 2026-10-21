import type { Engine } from 'claude-code'
import { webLines } from '../hooks/register'
import { optionsFor, parseChoice } from '../src/choice'
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
    yield { stream: 'stdout' as const, text: 'TEN 47822\n' }
    return { value: { code: 0, signal: null } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(await webLine($, 100)).toBe('Web: server stopped')
  expect(posts).toEqual(['http://127.0.0.1:47822/state'])
})

test('the page line names the ports in use, joined on a wide pane, apart on a narrow one', () => {
  const web = { status: 'listening' as const, port: 47822, error: '' }
  expect(webLines({ ...web, busy: [] }, false)).toEqual(['Web: http://127.0.0.1:47822'])
  expect(webLines({ ...web, busy: [47821] }, false)).toEqual(['Web: http://127.0.0.1:47822 (47821 in use)'])
  expect(webLines({ ...web, busy: [47821] }, true)).toEqual(['Web: http://127.0.0.1:47822', '  47821 in use'])
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
