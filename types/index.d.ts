export type AgentStatus = 'running' | 'done' | 'error' | 'aborted'

// what a subagent's estimated cost is judged to be, from best to worst
export type CostRating = 'perfect' | 'ok' | 'fair' | 'poor' | 'awful'

// one node of the tree: the orchestrator or a subagent
export type AgentNode = {
  id: string
  parentId?: string // the agent that spawned it; absent for the orchestrator's own
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  tokensIn: number // input, cache included
  cacheRead: number // part of the input read from the cache
  tokensOut: number
  tools: number
  costUsd?: number // estimated cost so far, from list prices; absent for a model without a price
  isCostPartial?: boolean // a request on a model with no price is not in costUsd
  contextTokens: number // the prompt of the last request: what the context holds
  contextWindow: number // the model's context window; 0 when unknown
  rating?: CostRating // set when a subagent ends and its cost is known
  calls: string[] // the last tool calls, each as `Tool: what it was given`
  durationMs: number
  summary: string // the first line of the answer
  answer: string // the whole answer, cut at a limit
}

export type Tree = {
  main: AgentNode
  agents: AgentNode[]
  isStale: boolean // a new user prompt: the next spawn clears the finished agents
}

// the local page's server: where it listens, and the ports it found in use
export type Web = {
  status: 'starting' | 'listening' | 'failed'
  port: number
  token: string // the key the page and the pushes carry (`?t=`), made by the server
  busy: number[]
  error: string
}

// how the user wants to see the agents, as chosen when the session starts
export type View = {
  chosen: boolean // the question was answered
  pane: boolean // the Agents pane
  web: boolean // the local web page
  window: boolean // the page as an Edge app window (Windows only)
  isShown: boolean // the web page and window were already announced or opened
}

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': { tree: Tree; web: Web; view: View }
  }
}
