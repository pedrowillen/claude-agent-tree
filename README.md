# agent-tree

A Claude Code mod that opens an **Agents** pane beside the chat with a live tree of the main session (the orchestrator) and every subagent it spawns: model, effort, tokens (input, cache, output), tool calls, duration and the first line of each answer.

It costs no model tokens: the hooks run inside the app and the pane is drawn by the interface, so nothing is added to the prompt.

```
Main session · opus-5-5 · high
  48.2k in (41.0k cache) / 1.3k out
├─ [ok] Explore · haiku-5-5 · low
│    Find the auth middleware · 12.4k in (9.8k cache) / 0.6k out · 7 tools · 14.2s
│    The middleware lives in app/middleware/auth.ts and ...
└─ [running] general-purpose · sonnet-5-5 · medium
     Review the migration · 3 tools
Subagents: 12.4k in / 0.6k out
```

## Install and use in Claude Code Desktop

1. Clone the repository:

   ```bash
   git clone https://github.com/pedrowillen/claude-agent-tree.git C:\projects\claude-agent-tree
   ```

2. Point Claude Code at the folder with a **user** environment variable. On Windows (PowerShell):

   ```powershell
   [Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', 'C:\projects\claude-agent-tree', 'User')
   ```

   On macOS/Linux, export `CLAUDE_CODE_PLUGIN_DIRS=/path/to/claude-agent-tree` in your shell profile (and make sure the desktop app inherits it).

3. Quit the Claude desktop app completely and open it again, so new sessions see the variable.

4. Start a session in the **Code** tab. The **Agents** pane opens on its own; if you close it, run `/agent-tree` to bring it back.

From the terminal CLI, you can load it for a single session instead:

```bash
claude --plugin-dir C:\projects\claude-agent-tree
```

### Reading the pane

- **Main session**: model and effort of the last request, plus total tokens (`in` includes cache; the cached part is shown in parentheses).
- **One node per subagent**: `[running]`, `[ok]`, `[error]` or `[aborted]`, the subagent type, model and effort, the task description, tokens, tool calls and duration, then the first line of its answer (up to 200 characters).
- **Subagents** footer: tokens summed over the subagents shown.
- Subagents from the previous prompt are cleared when the next prompt spawns its first subagent; ones still running are kept. At most 20 subagents are shown.
- Below 70 columns each detail goes on its own line, and no line ever wraps: lines longer than the pane are cut with `…`.

### The web page

The same tree is served as a live web page at **http://127.0.0.1:47821**. The mod starts a small Node server when the session starts and stops it with the session. If the port is in use it tries the next one, up to 47830, and the pane's last line says which address it took:

```
Web: http://127.0.0.1:47822 (47821 in use)
```

If every port is taken the line reads `Web: ports 47821-47830 in use`; without Node on the `PATH` it reads `Web: node not found`. The pane works the same either way. Each session gets its own server, so a second session takes the next free port.

The page is plain HTML, CSS and JavaScript, follows the system's light or dark theme and updates through server-sent events. The server listens on `127.0.0.1` only and refuses requests whose `Host` is not `127.0.0.1` or `localhost`.

## How it works

A mod is a Claude Code plugin whose hooks module runs inside the app. `agent-tree` listens to the engine's events, keeps the tree in the session state (`$.state`, key `agent-tree.tree`) and redraws the pane whenever that state changes.

| Event | What the mod does |
| --- | --- |
| `session.start` | Starts the page's server (kept up until the session ends), opens the pane and registers `/agent-tree` |
| `command.run` (`agent-tree`) | Opens the pane again |
| `turn.start` | On a new user prompt, marks the tree as stale |
| `agent.spawn` | Adds a subagent node (clearing finished ones if stale) |
| `turn.step` | Records the real model and effort of each request |
| `tool.call` | Counts a subagent's tool calls |
| `turn.complete` | Adds token usage; for a subagent, sets status, duration and answer summary |
| `ui.render` (`Pane`) | Draws the tree with `Box` and `Text` |

Every hook calls `next(e)`, so the mod only observes: it never changes, blocks or delays what the engine does.

The page's server runs through `$.process.spawn` (`node -`, its source on stdin) and lives as long as the module. It prints `BUSY <port>`, `LISTEN <port>` or `FAILED <port> <code>`, which the mod reads into the state (`agent-tree.web`). After each change to the tree the mod sends it to the server with `$.http.fetch` (`POST /state`), and the server streams it to the open pages (`GET /events`).

### Structure

```
.claude-plugin/plugin.json   manifest (name, version, description, types)
hooks/hooks.json             points the engine at the hooks module
hooks/register.tsx           the hooks and the pane drawing
types/index.d.ts             type contract of the state (AgentNode, Tree, Web)
web/page.ts                  the web page (HTML, CSS, JS) as a string
web/server.ts                the Node server's source and its ports
tests/pane.test.tsx          tests with the claude-code/testing kit
tsconfig.json                extends the types the engine generates
```

`.claude-plugin/types/` is generated by the engine when the mod loads and is git-ignored.

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
tsc -p .
```

`tsc` needs `.claude-plugin/types/`, which exists once the mod has been loaded at least once. While the folder is loaded through `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir`, edits reload the mod at the end of the turn.
