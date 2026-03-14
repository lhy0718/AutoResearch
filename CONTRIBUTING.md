# Contributing to AutoLabOS

Thanks for taking the time to contribute.

## Before you start

- Check existing issues and pull requests before starting large changes.
- Open an issue for feature work that changes workflow behavior, CLI surface, or repository structure.
- Keep pull requests focused. Small, reviewable changes move faster than broad rewrites.

## Local setup

Requirements:

- Node.js 18 or newer
- npm
- Optional for `/doctor` and PDF generation: `pdflatex`
- Runtime keys for end-to-end flows: `SEMANTIC_SCHOLAR_API_KEY`
- Optional runtime key for API-backed modes: `OPENAI_API_KEY`

Install dependencies:

```bash
npm install
```

Build the CLI and bundled web UI:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run harness quality validation (issue log + checked-in run artifact structure):

```bash
npm run validate:harness
```

This script is an internal/CI quality gate. User-facing diagnostics stay on `/doctor` (TUI) and the web Doctor tab.

Start the TUI:

```bash
npm run dev
```

Start the local web UI:

```bash
npm run dev:web
```

## Development notes

- Main CLI entrypoint: `src/cli/main.ts`
- TUI app flow: `src/tui/TerminalApp.ts`
- Interaction/session layer: `src/interaction/InteractionSession.ts`
- Runtime and orchestration: `src/runtime/createRuntime.ts`, `src/core/**`
- Browser UI: `web/src/**`

Please prefer:

- targeted changes with tests
- readable code over clever abstractions
- updating docs when behavior or commands change

## Pull request checklist

Before opening a pull request, please make sure you have:

- run `npm run build`
- run `npm test`
- updated docs or screenshots if UI behavior changed
- described user-facing changes and any follow-up work

## Commit and review expectations

- Use clear commit messages.
- Mention affected commands, workflows, or nodes in the pull request description.
- Call out any environment assumptions, especially around Codex login, OpenAI API usage, or Semantic Scholar access.

## Reporting security issues

Please do not report security issues in public GitHub issues. Follow the guidance in `SECURITY.md`.
