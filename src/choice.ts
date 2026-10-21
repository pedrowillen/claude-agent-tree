import type { View } from '../types'

export const QUESTION = 'How do you want to see the agent orchestration?'

export const LABEL = { pane: 'Agents pane', web: 'Web page', window: 'Edge window' } as const

// the window needs Edge, so it is offered on Windows only
export const optionsFor = (isWindows: boolean): string[] =>
  isWindows ? [LABEL.pane, LABEL.web, LABEL.window] : [LABEL.pane, LABEL.web]

// the answer is the labels chosen, comma-joined; anything else (free text, a dismissed
// dialog) falls back to the pane, so the user always sees something
export const parseChoice = (answer: string): Pick<View, 'pane' | 'web' | 'window'> => {
  const picked = answer.split(',').map(s => s.trim())
  const view = {
    pane: picked.includes(LABEL.pane),
    web: picked.includes(LABEL.web),
    window: picked.includes(LABEL.window),
  }

  return view.pane || view.web || view.window ? view : { pane: true, web: false, window: false }
}
