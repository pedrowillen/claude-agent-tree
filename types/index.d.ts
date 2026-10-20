export type AgentStatus = 'running' | 'done' | 'error' | 'aborted'

// one node of the tree: the orchestrator or a subagent
export type AgentNode = {
  id: string
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

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': { tree: Tree }
  }
}
