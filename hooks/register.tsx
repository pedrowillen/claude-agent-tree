import type { Register } from 'claude-code'

import { registerPane } from '../src/pane'
import { registerSession } from '../src/session'
import { registerTree } from '../src/tree'

export { webLines } from '../src/pane'

export const register: Register = (on, options) => {
  registerSession(on, options)
  registerTree(on, options)
  registerPane(on, options)
}
