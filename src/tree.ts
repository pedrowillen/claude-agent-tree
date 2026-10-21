import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { AgentNode, AgentStatus, Tree } from '../types'
import { callLabel, costText } from './format'
import { costOf, rate, windowOf } from './pricing'
import { INITIAL_TREE, MAX_AGENTS, MAX_ANSWER, MAX_CALLS, node } from './state'
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

// one request: how much its prompt filled the context, and what it cost (nothing, if the model has no price)
const addRequest = (n: AgentNode, u: TurnUsage): AgentNode => {
  const cost = costOf(u.model, u)

  return {
    ...n,
    contextTokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
    contextWindow: windowOf(u.model) ?? n.contextWindow,
    costUsd: cost === undefined ? n.costUsd : (n.costUsd ?? 0) + cost,
    // a request on a model with no price leaves the total short: it is shown as such, and not rated
    isCostPartial: n.isCostPartial === true || cost === undefined || undefined,
  }
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

  // the real model and effort of each request, and what each request cost and filled
  on('turn.step', async function* ($, e, next) {
    await save($, t => patch(t, e.agentId, n => ({ ...n, model: e.model, effort: e.effort?.toString() })))

    // the chunks pass through unchanged; the one that stops the request carries its usage
    const stream = next(e)
    try {
      for (;;) {
        const step = await stream.next()
        if (step.done) return step.value

        const chunk = step.value
        if (chunk.kind === 'stop' && chunk.usage) {
          const usage = chunk.usage
          await save($, t => patch(t, e.agentId, n => addRequest(n, usage)))
        }
        yield chunk
      }
    } finally {
      // what `yield*` did on its own: an interrupted request closes the stream beneath
      await stream.return(undefined as never)
    }
  })

  on('tool.call', async ($, e, next) => {
    // SubagentHandback is how a subagent hands its report back: not work worth listing
    if (e.agentId !== undefined && e.tool !== 'SubagentHandback') {
      const call = callLabel({ ...e })
      await save($, t => patch(t, e.agentId, n => ({ ...n, tools: n.tools + 1, calls: [...n.calls, call].slice(-MAX_CALLS) })))
    }

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
        answer: e.answer.trim().slice(0, MAX_ANSWER),
        // a verdict on a run that ended with its answer and whose whole cost is known: a run that was
        // stopped or failed would read as praise for doing nothing
        rating: used.costUsd === undefined || used.isCostPartial || STATUS[e.reason] !== 'done' ? undefined : rate(used.costUsd),
      }
    }))

    // a subagent finished: say so, and a failed or aborted one louder
    if (e.agentId !== undefined) {
      const agent = (await read($, tree)).agents.find(a => a.id === e.agentId)
      if (agent !== undefined) {
        const cost = costText(agent)
        const what = `${agent.type}: ${agent.description}${cost === '' ? '' : ` · ${cost}`}`
        if (agent.status === 'done') $.ui.toast(`Agent finished · ${what}`)
        else {
          $.ui.toast(`Agent ${agent.status === 'aborted' ? 'aborted' : 'failed'} · ${what}`)
          // an abort is usually the user's own doing (Esc stops every agent): only a failure notifies
          if (agent.status === 'error') void $.ui.notify(what, { title: 'Agent failed' }).catch(() => undefined)
        }
      }
    }

    return done
  })
}
