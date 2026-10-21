import type { CostRating } from '../types'

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// A price row: USD per million tokens, and the model's context window in tokens. `cacheRead` is
// stated where it is not the usual tenth of the input price; `over` is a dearer tier for a
// prompt longer than `tokens`.
type Price = { in: number; out: number; window: number; cacheRead?: number; over?: { tokens: number; in: number; out: number } }

const M = 1_000_000

// List prices of Anthropic's own API (the claude-api reference, cached 2026-10-06). They change:
// the cost the mod shows is an estimate, and a model missing here shows no cost at all.
// A model id matches the longest key it contains, so `claude-opus-5-5` wins over `claude-opus-5`.
const PRICES: Record<string, Price> = {
  'claude-fable-5': { in: 10, out: 50, window: M, cacheRead: 0.25 },
  'claude-mythos-5': { in: 10, out: 50, window: M, cacheRead: 0.25 },
  'claude-opus-5': { in: 5, out: 25, window: M },
  'claude-opus-5-5': { in: 4, out: 20, window: M, cacheRead: 0.2 },
  // only the 4.x models whose price is confirmed: an older one (4, 4.1, 4.5) shows no cost rather than a wrong one
  'claude-opus-4-6': { in: 5, out: 25, window: M },
  'claude-opus-4-7': { in: 5, out: 25, window: M },
  'claude-opus-4-8': { in: 5, out: 25, window: M },
  'claude-sonnet-5': { in: 2, out: 10, window: M },
  'claude-sonnet-5-5': { in: 2, out: 10, window: M, cacheRead: 0.2 },
  'claude-sonnet-4-6': { in: 3, out: 15, window: M },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, window: M, over: { tokens: 100_000, in: 0.5, out: 2.5 } },
  'claude-haiku-4-5': { in: 1, out: 5, window: 200_000 },
}

const WRITE_FACTOR = 1.25 // writing the prompt cache (5-minute) costs this much times the input price
const READ_FACTOR = 0.1 // reading it costs this much, unless the row says otherwise

const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length) // longest first, once

const priceOf = (model: string): Price | undefined => {
  const key = KEYS.find(name => model.includes(name))

  return key === undefined ? undefined : PRICES[key]
}

export const windowOf = (model: string): number | undefined => priceOf(model)?.window

// what one request cost, in USD; undefined for a model with no price row
export const costOf = (model: string, usage: Usage): number | undefined => {
  const price = priceOf(model)
  if (price === undefined) return undefined

  const prompt = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  const tier = price.over !== undefined && prompt > price.over.tokens ? price.over : price
  const read = (price.cacheRead ?? price.in * READ_FACTOR) * (tier.in / price.in)

  return (
    usage.input_tokens * tier.in +
    usage.cache_creation_input_tokens * tier.in * WRITE_FACTOR +
    usage.cache_read_input_tokens * read +
    usage.output_tokens * tier.out
  ) / M
}

// A verdict on what a subagent spent, not on how well it worked: the estimated cost of its whole
// run against these ceilings, in USD. Change them here to suit the budget.
const CEILINGS: readonly [CostRating, number][] = [
  ['perfect', 0.03],
  ['ok', 0.15],
  ['fair', 0.6],
  ['poor', 2],
]

export const rate = (costUsd: number): CostRating => CEILINGS.find(([, ceiling]) => costUsd <= ceiling)?.[0] ?? 'awful'
