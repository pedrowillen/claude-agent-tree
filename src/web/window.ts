import type { EngineInterface } from 'claude-code'

// Opens the page as its own window (Edge's app mode: no tabs, no address bar).
// A function declaration: the engine follows `$` across files only into those.
export async function openWindow($: EngineInterface, port: number) {
  if (port === 0) return
  // `start` finds Edge through Windows' app paths, so no install path is needed
  await $.process.run(['cmd', '/c', 'start', '', 'msedge', `--app=http://127.0.0.1:${port}`]).catch(() => undefined)
}
