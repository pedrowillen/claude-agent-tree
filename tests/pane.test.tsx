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
  on('command.register', () => ({ value: { command: 'agents' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

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
