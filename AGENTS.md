# Repository Guidelines

## Project Structure & Module Organization

This repository is a local QDII fund analysis web app with a plain Node.js server and static browser UI.

- `server.mjs` contains the HTTP server and API routes.
- `lib/` holds core server modules: Supabase access, auth, Eastmoney scraping/parsing, AI calls, embeddings, and agent orchestration.
- `public/` contains the browser app (`index.html`, `app.js`, `auth.js`, `chart.js`, `styles.css`).
- `scripts/` contains operational jobs for backfills, refreshes, summary generation, embeddings, and agent case checks.
- `rules/` stores strategy and prompt rule cards consumed by the agent.
- `docs/` stores architecture and planning notes.
- `outputs/` contains generated report artifacts; treat it as derived output.

## Build, Test, and Development Commands

- `npm install` installs dependencies.
- `npm start` runs the local server with `node --env-file=.env server.mjs`; open `http://localhost:5173`.
- `npm run data:refresh` refreshes scheduled fund data.
- `npm run data:f10`, `data:metrics`, `data:holdings`, `data:managers`, and `data:fees` run targeted backfills.
- `npm run ai:generate` generates cached AI summaries. Use `-- --limit 10` for a small batch or `-- --force` to overwrite.
- `npm run agent:test` runs scripted agent cases from `scripts/test-agent-cases.mjs`.

There is no build step or bundler. Restart `npm start` after changing `.env`; otherwise refresh the browser after frontend edits.

## Coding Style & Naming Conventions

Use ES modules (`.mjs` and `type: module`) and plain JavaScript. Follow the existing style: two-space indentation, semicolons, `camelCase` for JavaScript identifiers, and `snake_case` for database fields. Keep DB-to-JS mapping in `lib/store.mjs` (`fundToRow`, `rowToFund`).

Frontend code is framework-free. Prefer small functions, direct DOM updates, and existing helpers.

## Testing Guidelines

This project has no formal unit test framework or coverage gate. For backend or agent changes, run `npm run agent:test` when relevant. For parsing changes, run the smallest matching backfill or refresh command and verify records. For UI changes, run `npm start` and check `http://localhost:5173`.

## Commit & Pull Request Guidelines

This checkout has no Git history, so no repository-specific convention can be inferred. Use short, imperative commit messages such as `Add fund fee backfill` or `Fix agent rule loading`.

Pull requests should include a summary, affected areas (`server`, `lib/store`, `public`, `scripts`), commands run, and screenshots for UI changes. Link issues or task docs when available.

## Security & Configuration Tips

Copy `.env.example` to `.env`. Do not commit `.env` or secrets. Required Supabase variables are `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_PUBLISHABLE_KEY`; DashScope variables are only needed for AI summary or agent paths.
