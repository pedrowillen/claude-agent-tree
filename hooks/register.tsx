import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { AgentNode, AgentStatus, Tree, Web } from '../types'
import { PAGE } from '../web/page'
import { FIRST_PORT, PORT_TRIES, serverSource } from '../web/server'

const PANE = 'agent-tree'
const MAX_AGENTS = 20
const NARROW = 70 // below this many columns each detail gets its own line

const node = (id: string, type: string, description: string, model: string): AgentNode => ({
  id, type, description, model,
  status: 'running', tokensIn: 0, cacheRead: 0, tokensOut: 0, tools: 0, durationMs: 0, summary: '',
})

const tree = atom({ plugin: 'agent-tree', key: 'tree' } as const, {
  main: node('main', 'Main session', '', ''),
  agents: [],
  isStale: false,
} as Tree)

const web = atom({ plugin: 'agent-tree', key: 'web' } as const, {
  status: 'starting', port: 0, busy: [], error: '',
} as Web)

// sends the tree to the local page, when its server listens
const push = async ($: EngineInterface) => {
  const w = await read($, web)
  if (w.status !== 'listening') return
  const body = JSON.stringify(await read($, tree))
  await $.http.fetch(`http://127.0.0.1:${w.port}/state`, { method: 'POST', body }).catch(() => undefined)
}

const save = async ($: EngineInterface, fn: (t: Tree) => Tree) => {
  await update($, tree, fn)
  void push($)
}

// runs the page's server for the module's life, reading the lines it prints
const serve = async ($: EngineInterface) => {
  await update($, web, () => ({ status: 'starting', port: 0, busy: [], error: '' }))
  try {
    let rest = ''
    for await (const { stream, text } of $.process.spawn({ argv: ['node', '-'], input: serverSource(PAGE) })) {
      if (stream !== 'stdout') continue
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const [word = '', port = '', code = ''] = line.trim().split(' ')
        if (word === 'BUSY') await update($, web, w => ({ ...w, busy: [...w.busy, Number(port)] }))
        if (word === 'FAILED') await update($, web, w => ({ ...w, status: 'failed', error: code }))
        if (word === 'LISTEN') {
          await update($, web, w => ({ ...w, status: 'listening', port: Number(port) }))
          await push($)
        }
      }
    }
    await update($, web, w => (w.status === 'failed' ? w : { ...w, status: 'failed', error: 'server stopped' }))
  } catch {
    await update($, web, w => ({ ...w, status: 'failed', error: 'node not found' })).catch(() => undefined)
  }
}

const LAST_PORT = FIRST_PORT + PORT_TRIES - 1

// the pane's lines about the page: its address, or why there is none
export const webLines = (w: Web, isNarrow: boolean): string[] => {
  if (w.status === 'starting') return ['Web: starting…']
  if (w.status === 'failed') {
    return [w.error === 'EADDRINUSE' ? `Web: ports ${FIRST_PORT}-${LAST_PORT} in use` : `Web: ${w.error}`]
  }
  const url = `Web: http://127.0.0.1:${w.port}`
  if (w.busy.length === 0) return [url]
  const note = `${w.busy.join(', ')} in use`

  return isNarrow ? [url, `  ${note}`] : [`${url} (${note})`]
}

// applies fn to the node of the loop (a subagent by id, or the main one)
const patch = (t: Tree, agentId: string | undefined, fn: (n: AgentNode) => AgentNode): Tree =>
  agentId === undefined
    ? { ...t, main: fn(t.main) }
    : { ...t, agents: t.agents.map(a => (a.id === agentId ? fn(a) : a)) }

const addUsage = (n: AgentNode, u?: TurnUsage): AgentNode => !u ? n : {
  ...n,
  tokensIn: n.tokensIn + u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
  cacheRead: n.cacheRead + u.cache_read_input_tokens,
  tokensOut: n.tokensOut + u.output_tokens,
}

const STATUS: Record<string, AgentStatus> = { answer: 'done', aborted: 'aborted', error: 'error', refusal: 'error' }
const LABEL: Record<AgentStatus, string> = { running: 'running', done: 'ok', error: 'error', aborted: 'aborted' }

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const short = (model: string) => model.replace(/^claude-/, '')
const tokens = (n: AgentNode) => `${k(n.tokensIn)} in (${k(n.cacheRead)} cache) / ${k(n.tokensOut)} out`
const head = (n: AgentNode) => [short(n.model) || '?', n.effort].filter(Boolean).join(' · ')

// the lines of a node: joined on a wide pane, one detail per line on a narrow one
const detailLines = (a: AgentNode, isNarrow: boolean): string[] => {
  const toolCount = `${a.tools} tool${a.tools === 1 ? '' : 's'}`
  const usage = a.status === 'running' ? [toolCount] : [tokens(a), `${toolCount} · ${secs(a.durationMs)}`]
  const lines = isNarrow
    ? [`[${LABEL[a.status]}] ${a.type}`, head(a), a.description, ...usage]
    : [`[${LABEL[a.status]}] ${a.type} · ${head(a)}`, [a.description, ...usage].join(' · ')]

  return a.summary === '' ? lines : [...lines, a.summary]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agents', description: 'Open the pane with the agent tree' })
    void $.ui.open({ id: PANE, title: 'Agents' })
    void serve($)

    return next(e)
  })

  on('command.run', { command: 'agents' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agents' })

    return { text: 'Agents pane opened.' }
  })

  // a new user prompt: mark the tree to be cleared on the next spawn
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text !== '') await update($, tree, t => ({ ...t, isStale: true }))

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId === undefined) return spawned

    const added = node(spawned.agentId, e.subagentType, e.description, spawned.model)
    await save($, t => {
      const kept = t.isStale ? t.agents.filter(a => a.status === 'running') : t.agents

      return { ...t, isStale: false, agents: [...kept, added].slice(-MAX_AGENTS) }
    })

    return spawned
  })

  // the real model and effort of each request
  on('turn.step', async function* ($, e, next) {
    await save($, t => patch(t, e.agentId, n => ({ ...n, model: e.model, effort: e.effort?.toString() })))

    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) await save($, t => patch(t, e.agentId, n => ({ ...n, tools: n.tools + 1 })))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await save($, t => patch(t, e.agentId, n => {
      const used = addUsage(n, e.usage)
      if (e.agentId === undefined) return used

      return {
        ...used,
        status: STATUS[e.reason] ?? 'done',
        durationMs: n.durationMs + e.durationMs,
        summary: (e.answer.trim().split('\n')[0] ?? '').slice(0, 200),
      }
    }))

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { main, agents } = await read($, tree)
    const w = await read($, web)
    const cols = e.props.bodyColumns
    const isNarrow = cols < NARROW
    // cuts a line to the pane width, so it never wraps
    const fit = (s: string) => (s.length > cols ? `${s.slice(0, Math.max(1, cols - 1))}…` : s)
    const sumIn = agents.reduce((s, a) => s + a.tokensIn, 0)
    const sumOut = agents.reduce((s, a) => s + a.tokensOut, 0)

    return (
      <Box flexDirection="column">
        <Text mono weight="bold">{fit(isNarrow ? 'Main session' : `Main session · ${head(main)}`)}</Text>
        {isNarrow && <Text mono dimColor>{fit(`  ${head(main)}`)}</Text>}
        <Text mono dimColor>{fit(`  ${tokens(main)}`)}</Text>
        {agents.length === 0 && <Text mono dimColor>{fit('└─ no subagents this round')}</Text>}
        {agents.map((a, i) => {
          const isLast = i === agents.length - 1
          const [first = '', ...rest] = detailLines(a, isNarrow)

          return (
            <Box flexDirection="column">
              <Text mono color={a.status === 'error' ? 'error' : undefined} dimColor={a.status === 'done'}>
                {fit(`${isLast ? '└─' : '├─'} ${first}`)}
              </Text>
              {rest.map(line => <Text mono dimColor>{fit(`${isLast ? '   ' : '│  '}  ${line}`)}</Text>)}
            </Box>
          )
        })}
        {agents.length > 0 && <Text mono dimColor>{fit(`Subagents: ${k(sumIn)} in / ${k(sumOut)} out`)}</Text>}
        {webLines(w, isNarrow).map(line => (
          <Text mono dimColor={w.status !== 'failed'} color={w.status === 'failed' ? 'warning' : undefined}>{fit(line)}</Text>
        ))}
      </Box>
    )
  })
}
