import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentNode, AgentStatus, Web } from '../types'
import { contextText, costText, head, k, pageUrl, secs, tokens, usd } from './format'
import { INITIAL_TREE, INITIAL_WEB } from './state'
import { FIRST_PORT, PORT_TRIES } from './web/server'

const PANE = 'agent-tree' // a literal here, for the scan; the same id as state's PANE

const tree = atom({ plugin: 'agent-tree', key: 'tree' } as const, INITIAL_TREE)
const web = atom({ plugin: 'agent-tree', key: 'web' } as const, INITIAL_WEB)

const NARROW = 70 // below this many columns each detail gets its own line
const LAST_PORT = FIRST_PORT + PORT_TRIES - 1
const LABEL: Record<AgentStatus, string> = { running: 'running', done: 'ok', error: 'error', aborted: 'aborted' }

// the pane's lines about the page: its address, or why there is none
export const webLines = (w: Web, isNarrow: boolean): string[] => {
  if (w.status === 'starting') return ['Web: starting…']
  if (w.status === 'failed') {
    return [w.error === 'EADDRINUSE' ? `Web: ports ${FIRST_PORT}-${LAST_PORT} in use` : `Web: ${w.error}`]
  }
  const url = `Web: ${pageUrl(w.port, w.token)}`
  if (w.busy.length === 0) return [url]
  const note = `${w.busy.join(', ')} in use`

  return isNarrow ? [url, `  ${note}`] : [`${url} (${note})`]
}

// the lines of a node: joined on a wide pane, one detail per line on a narrow one
const detailLines = (a: AgentNode, isNarrow: boolean): string[] => {
  const toolCount = `${a.tools} tool${a.tools === 1 ? '' : 's'}`
  const usage = a.status === 'running' ? [toolCount] : [tokens(a), `${toolCount} · ${secs(a.durationMs)}`]
  const spend = [costText(a), contextText(a)].filter(s => s !== '')
  const lines = isNarrow
    ? [`[${LABEL[a.status]}] ${a.type}`, head(a), a.description, ...usage, ...spend]
    : [`[${LABEL[a.status]}] ${a.type} · ${head(a)}`, [a.description, ...usage].join(' · '), ...(spend.length > 0 ? [spend.join(' · ')] : [])]

  return a.summary === '' ? lines : [...lines, a.summary]
}

// draws the pane: the orchestrator, its subagents and the page's address
export const registerPane: Register = on => {
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
    const sumCost = agents.reduce((s, a) => s + (a.costUsd ?? 0), 0)
    const mainSpend = [costText(main), contextText(main)].filter(s => s !== '').join(' · ')

    return (
      <Box flexDirection="column">
        <Text mono weight="bold">{fit(isNarrow ? 'Main session' : `Main session · ${head(main)}`)}</Text>
        {isNarrow && <Text mono dimColor>{fit(`  ${head(main)}`)}</Text>}
        <Text mono dimColor>{fit(`  ${tokens(main)}`)}</Text>
        {mainSpend !== '' && <Text mono dimColor>{fit(`  ${mainSpend}`)}</Text>}
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
        {agents.length > 0 && <Text mono dimColor>{fit(`Subagents: ${k(sumIn)} in / ${k(sumOut)} out${sumCost > 0 ? ` · ~${usd(sumCost)}` : ''}`)}</Text>}
        {webLines(w, isNarrow).map(line => (
          <Text mono dimColor={w.status !== 'failed'} color={w.status === 'failed' ? 'warning' : undefined}>{fit(line)}</Text>
        ))}
      </Box>
    )
  })
}
