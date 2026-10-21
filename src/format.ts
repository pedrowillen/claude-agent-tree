import type { AgentNode } from '../types'

const DETAIL_KEYS = ['file_path', 'command', 'pattern', 'path', 'url', 'query', 'description', 'prompt']

// a tool call as one line: the tool and the first thing it was given (`Grep: useState`)
export const callLabel = (call: { tool: string; [input: string]: unknown }): string => {
  const key = DETAIL_KEYS.find(name => typeof call[name] === 'string')
  const detail = key === undefined ? '' : String(call[key]).replace(/\s+/g, ' ').trim().slice(0, 80)

  return detail === '' ? call.tool : `${call.tool}: ${detail}`
}

// an estimated cost in USD: more digits for the cents a small agent costs (the limits sit just
// under 0.01 and 1, so a cost that rounds up to them never shows as `$0.0100` or `$1.000`)
export const usd = (cost: number) => `$${cost < 0.00995 ? cost.toFixed(4) : cost < 0.9995 ? cost.toFixed(3) : cost.toFixed(2)}`

// `~$0.0123 · ok`: the estimated cost, and the verdict once a subagent has ended; '' with no price
// (a `+` after the cost: a request on a model with no price is not in it)
export const costText = (n: AgentNode): string =>
  n.costUsd === undefined ? '' : `~${usd(n.costUsd)}${n.isCostPartial ? '+' : ''}${n.rating === undefined ? '' : ` · ${n.rating}`}`

// `ctx 126.0k / 1.0M (13%)`: what the last request's prompt held, against the window the mod assumes
// for the model (shown, so a smaller real window is not hidden); '' before any request
export const contextText = (n: AgentNode): string => {
  if (n.contextTokens === 0) return ''
  const share = n.contextWindow > 0
    ? ` / ${k(n.contextWindow)} (${Math.max(1, Math.round((n.contextTokens / n.contextWindow) * 100))}%)`
    : ''

  return `ctx ${k(n.contextTokens)}${share}`
}

// where the page is, with the key its data needs
export const pageUrl = (port: number, token: string) => `http://127.0.0.1:${port}/?t=${token}`

export const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
export const short = (model: string) => model.replace(/^claude-/, '')
export const tokens = (n: AgentNode) => `${k(n.tokensIn)} in (${k(n.cacheRead)} cache) / ${k(n.tokensOut)} out`
export const head = (n: AgentNode) => [short(n.model) || '?', n.effort].filter(Boolean).join(' · ')
