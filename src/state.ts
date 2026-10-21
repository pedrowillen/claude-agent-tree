import type { AgentNode, Tree, View, Web } from '../types'

// The engine's scan reads an atom's reference only where `read`/`update` use it, so each file
// declares its own `atom({ plugin: 'agent-tree', key }, ...)`; what they share lives here.

export const PANE = 'agent-tree'
export const MAX_AGENTS = 20

export const node = (id: string, type: string, description: string, model: string): AgentNode => ({
  id, type, description, model,
  status: 'running', tokensIn: 0, cacheRead: 0, tokensOut: 0, tools: 0, durationMs: 0, summary: '',
})

export const INITIAL_TREE: Tree = { main: node('main', 'Main session', '', ''), agents: [], isStale: false }
export const INITIAL_WEB: Web = { status: 'starting', port: 0, busy: [], error: '' }
export const INITIAL_VIEW: View = { chosen: false, pane: false, web: false, window: false, isShown: false }
