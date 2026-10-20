import { atom, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { AgentNode, AgentStatus, Tree } from '../types'
import { INITIAL_TREE, MAX_AGENTS, node } from './state'
import { push } from './web/serve'

const tree = atom({ plugin: 'agent-tree', key: 'tree' } as const, INITIAL_TREE)

const STATUS: Record<string, AgentStatus> = { answer: 'done', aborted: 'aborted', error: 'error', refusal: 'error' }

const save = async ($: EngineInterface, fn: (t: Tree) => Tree) => {
  await update($, tree, fn)
  void push($)
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

// keeps the tree of the orchestrator and its subagents up to date from the loop's events
export const registerTree: Register = on => {
  // a new user prompt: mark the tree to be cleared on the next spawn
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text !== '') await update($, tree, t => ({ ...t, isStale: true }))

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId === undefined) return spawned

    const added = { ...node(spawned.agentId, e.subagentType, e.description, spawned.model), parentId: e.parentAgentId }
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
}
