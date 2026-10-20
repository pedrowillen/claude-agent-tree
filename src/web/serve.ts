import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { INITIAL_TREE, INITIAL_WEB } from '../state'
import { PAGE } from './page'
import { serverSource } from './server'

const tree = atom({ plugin: 'agent-tree', key: 'tree' } as const, INITIAL_TREE)
const web = atom({ plugin: 'agent-tree', key: 'web' } as const, INITIAL_WEB)

// sends the tree to the local page, when its server listens
// (function declarations: the engine follows `$` across files only into those)
export async function push($: EngineInterface) {
  const w = await read($, web)
  if (w.status !== 'listening') return
  const body = JSON.stringify(await read($, tree))
  await $.http.fetch(`http://127.0.0.1:${w.port}/state`, { method: 'POST', body }).catch(() => undefined)
}

// runs the page's server for the module's life, reading the lines it prints
export async function serve($: EngineInterface) {
  await update($, web, () => ({ status: 'starting', port: 0, busy: [], error: '' }))
  try {
    let rest = ''
    for await (const { stream, text } of $.process.spawn({ argv: ['node', '-'], input: serverSource(PAGE) })) {
      if (stream !== 'stdout') continue
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const [word = '', port = '', code = ''] = line.trim().split(' ')
        if (word === 'BUSY') await update($, web, w => ({ ...w, busy: [...w.busy, Number(port)] }))
        if (word === 'FAILED') await update($, web, w => ({ ...w, status: 'failed', error: code }))
        if (word === 'LISTEN') {
          await update($, web, w => ({ ...w, status: 'listening', port: Number(port) }))
          await push($)
        }
      }
    }
    await update($, web, w => (w.status === 'failed' ? w : { ...w, status: 'failed', error: 'server stopped' }))
  } catch {
    await update($, web, w => ({ ...w, status: 'failed', error: 'node not found' })).catch(() => undefined)
  }
}
