import type { EngineInterface } from 'claude-code'

// Opens the page as its own window (Edge's app mode: no tabs, no address bar).
// A function declaration: the engine follows `$` across files only into those.
export async function openWindow($: EngineInterface, url: string) {
  // `start` finds Edge through Windows' app paths, so no install path is needed
  await $.process.run(['cmd', '/c', 'start', '', 'msedge', `--app=${url}`]).catch(() => undefined)
}
