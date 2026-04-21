# Fantasy Futbol — Agent Instructions

See `CLAUDE.md` for the full project context, scoring engine details, database schema, and coding standards.

## Cursor Cloud specific instructions

### Services

| Service | How to run | Notes |
|---|---|---|
| Next.js dev server | `npm run dev` (port 3000) | Auth-protected routes redirect to `/login` |
| Supabase | Hosted (remote) | Requires env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |

### Environment variables

All required secrets (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_KEY`, `CRON_SECRET`) are injected as environment variables. A `.env.local` file must be created from these env vars before running the dev server — the update script handles this automatically.

### Common commands

Refer to `CLAUDE.md` and `package.json` scripts:
- `npm run dev` — local dev server (port 3000)
- `npm run build` — production build (must pass before pushing)
- `npm run lint` — ESLint (pre-existing lint errors in root-level `.js` utility scripts are expected)

### Gotchas

- The root page (`/`) redirects (307) to `/login` when not authenticated — this is expected behavior, not an error.
- `.env.local` is git-ignored. Secrets must be written to `.env.local` from environment variables before starting the dev server.
- The lint command (`npm run lint`) has pre-existing errors in root-level JS utility/debug scripts (e.g., `compute_fpl_reference_stats.js`, `debug_client_error.js`, `playwright-*.js`). These are not regressions.
- No Docker, no local database — all data is in hosted Supabase.
