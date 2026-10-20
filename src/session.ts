import type { Register } from 'claude-code'

import { PANE } from './state'
import { serve } from './web/serve'

// the session's start (pane, server, command) and the command that reopens the pane
export const registerSession: Register = on => {
  on('session.start', async ($, e, next) => {
    // the server lives as long as the session: its child ends with the module
    void serve($)
    void $.ui.open({ id: PANE, title: 'Agents' })
    await $.command.register({ name: 'agent-tree', description: 'Open the pane with the agent tree' })

    return next(e)
  })

  on('command.run', { command: 'agent-tree' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agents' })

    return { text: 'Agents pane opened.' }
  })
}
