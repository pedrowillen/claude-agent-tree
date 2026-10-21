export type AgentStatus = 'running' | 'done' | 'error' | 'aborted'

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
  durationMs: number
  summary: string
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
