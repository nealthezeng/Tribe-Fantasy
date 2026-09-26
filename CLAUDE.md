# Tribe Fantasy

A fantasy league for our college ultimate team. Vite + React 19 + TypeScript single-page app with hash routing,
on GitHub Pages, with Supabase as the backend. Live at https://nealthezeng.github.io/Tribe-Fantasy/. Pushing to
`main` deploys.

## Front-end work

Read `docs/frontend-principles.md` and `DESIGN.md` (team colours, tokens, components) before any UI change, and run its checklist before calling a page done.
Keep the look clean and simple. Colours, fonts and sizes live in `src/app/tokens.css`; reuse the classes in `src/app/styles.css`. Add no UI libraries.

## Where things are

- Rules and product spec: `docs/superpowers/specs/` (start with `2026-09-25-tribe-fantasy-design.md`, then the
  revisions dated after it). Milestone plans: `docs/superpowers/plans/`.
- `src/core/`: pure game logic with no dependencies. `src/app/`: the UI. `supabase/migrations/`: the database.
  Every write goes through a security-definer RPC.
- Supabase setup and go-live steps: `docs/setup-supabase.md`. Never edit an applied migration. Add a new one.

## Commands

Node isn't on the Bash PATH on this machine, so prefix with `export PATH="/c/Program Files/nodejs:$PATH";`.

- `npm run dev`: local app. It needs `.env.development.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`,
  the same public values as the GitHub repo variables (`gh variable list`). Not `.env.local`: vitest reads that one
  and the "not configured" test fails. Without them the app shows the "not configured" page.
- `npm test` (about 45 s; the DB tests run on PGlite), `npm run typecheck`, `npm run lint`, `npm run build`.
  CI runs all four.

The last stable point is tag `m4`. Branch off `main` for new work.
