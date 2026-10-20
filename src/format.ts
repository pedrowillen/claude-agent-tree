import type { AgentNode } from '../types'

export const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
export const short = (model: string) => model.replace(/^claude-/, '')
export const tokens = (n: AgentNode) => `${k(n.tokensIn)} in (${k(n.cacheRead)} cache) / ${k(n.tokensOut)} out`
export const head = (n: AgentNode) => [short(n.model) || '?', n.effort].filter(Boolean).join(' · ')
