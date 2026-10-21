import type { Register } from 'claude-code'

import { choose } from './view'
import { serve } from './web/serve'

// the session's start (server, question, command) and the command that asks again
export const registerSession: Register = on => {
  on('session.start', async ($, e, next) => {
    // the server lives as long as the session: its child ends with the module
    void serve($)
    void choose($)
    await $.command.register({ name: 'agent-tree', description: 'Choose how to see the agent tree' })

    return next(e)
  })

  on('command.run', { command: 'agent-tree' }, async $ => {
    void choose($)

    return { text: 'Choose how to see the agents.' }
  })
}
