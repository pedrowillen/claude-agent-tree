# Contributing to agent-tree

Thanks for wanting to help. Bug reports, ideas, docs and code are all welcome.

## The short way

1. **Open an issue first** for a bug or a new idea, so we agree on it before you spend time. Small fixes and typos can go straight to a pull request. For a question or an open-ended idea, use [Discussions](https://github.com/pedrowillen/claude-agent-tree/discussions).
2. **Fork** the repository and make a branch.
3. **Run it** from your clone (below) and make your change.
4. **Check it**: `claude plugin validate .` and `claude plugin test .` must pass. New behavior comes with a test.
5. **Open a pull request** against `main` and say what changed and why.

## Running your clone

Clone your fork and point Claude Code at the folder, as the README's install section describes:

```powershell
[Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', 'C:\path\to\your\clone', 'User')
```

Restart the Claude desktop app, then start a session. While the folder is loaded, edits reload the mod at the end of the turn. For a single terminal session, `claude --plugin-dir <folder>` works too.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

`tsc -p .` also works once the mod has been loaded at least once (it needs `.claude-plugin/types/`, which the engine writes).

## Where things live

The README's Structure section lists every file. In short: `hooks/register.tsx` only composes the features in `src/` (`session.ts`, `tree.ts`, `pane.tsx`, `view.ts`), `src/web/` holds the local server and the page, `src/pricing.ts` the price table, and `tests/` the tests.

Two rules of the engine's scan shape the code, and `claude plugin validate` fails if they are broken:

- A function that receives `$` from another file must be a `function` declaration, not a `const`.
- An atom is declared (`atom({ plugin, key }, initial)`) in each file that reads or writes it; shared initial values live in `src/state.ts`.

The page in `src/web/page.ts` is one template string: keep backticks and `${` out of it, and render data with `textContent`, never `innerHTML`.

## Style

- Read like the code around yours: same naming, same comment density.
- No new dependencies. The mod and its server run on what the engine and Node already have.
- Commits are short, one line, in English, in the Conventional Commits form: `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`. One change per commit.
- Do not bump `version` in `.claude-plugin/plugin.json`; the maintainer does it when releasing.

## Prices and costs

The cost shown is an estimate from list prices in `src/pricing.ts`. If you add or change a model's row, say where the price comes from in the pull request. A model without a row shows no cost on purpose, rather than a wrong one.

## Security

The local server holds commands and answers behind a key. If you find a way around it, do not open a public issue with the details: message the maintainer through their GitHub profile first.

## License

By contributing you agree that your work is released under the [MIT License](LICENSE).
