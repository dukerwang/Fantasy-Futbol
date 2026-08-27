# Changelog / "What's New" system

## Problem

Gaffa ships to alpha testers whenever Duke pushes, with no record of what changed and no way for a tester to find out short of asking. There's no cadence — updates land ad hoc, sized however a branch happens to grow. This spec covers the in-app changelog surface and its notification. The cadence discipline (batching work into weekly/semi-weekly/monthly releases rather than pushing continuously) is a workflow change on Duke's side, not something the app enforces — noted here for context, not built.

## Non-goals

- No admin UI for authoring entries. Claude drafts an entry from the commits/branch being shipped, in player-facing language (no internal implementation detail, no naming code/files/tables), Duke approves it in chat, Claude inserts it directly via the Supabase MCP.
- No top-bar nav entry for the changelog. It's reachable from Settings and from the notification itself.
- No per-category opt-out UI beyond what already exists. Product updates ride the existing push/email preference grid via one new `NotificationKind` ("product"), defaulted off for both channels — in-app only unless a tester opts in.
- No edit/unpublish flow. An entry is a row Claude inserts; fixing a typo is a manual `UPDATE`.
- No versioning scheme (v1.2, etc.). Entries are dated, not numbered.
- No digest/summary emails. Out of scope for this pass.

## Data model

New table, migration `142_product_updates.sql`:

```sql
CREATE TABLE public.product_updates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,   -- one-line teaser, shown in the bell row and modal
  body          TEXT NOT NULL,   -- full entry, markdown (rendered with the existing FormattedText/markdown component)
  is_major      BOOLEAN NOT NULL DEFAULT FALSE,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.product_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Product updates: readable by any authenticated user"
  ON public.product_updates FOR SELECT
  USING (auth.role() = 'authenticated');
```

Same migration adds the discriminator column the bell/modal need to tell a product-update row apart from an ordinary one:

```sql
ALTER TABLE public.notifications ADD COLUMN kind TEXT;
```

Existing rows stay `NULL`; nothing currently reads this column, so no backfill.

## Publishing flow

1. Duke tells Claude to cut an update (or Claude proposes one when asked to ship a branch).
2. Claude reviews the commits/diff since the last published entry, drafts `title` / `summary` / `body` in player-facing language, and marks `is_major` based on whether it's the kind of thing worth interrupting someone with a popup (a new feature or visible mechanic change) versus a quieter fix.
3. Duke approves or edits the draft in chat.
4. Claude inserts the row via Supabase MCP (`apply_migration` for schema changes, plain `execute_sql`/insert for the row itself).
5. If `is_major`, Claude fans out one `notifications` row per user (see below) in the same step.

No entry goes out without Duke's explicit approval of the drafted copy.

**Ordering within an entry.** `body` is not a flat chronological list of every commit. Claude drafts it as a lead feature or two — the thing testers will actually notice and care about — up top, then smaller fixes and polish below in a shorter, quieter list. A gameweek's work might be one visible feature plus a dozen invisible fixes; the entry should read that way, not bury the feature alphabetically between them. `summary` (the one-liner shown in the bell/modal) always names the single biggest thing in the entry, never a generic "various updates."

## Changelog page

`src/app/(dashboard)/updates/page.tsx` — server component, same shape as the existing `/guide` page (non-league-scoped, reachable regardless of which league you're in). Fetches all `product_updates` rows newest-first, groups by month, renders `title` + `published_at` + `body` (markdown). No league chrome, matching `/guide`.

Settings gets a new row (next to the existing Help/Guide row in `SettingsClient.tsx`) linking to `/updates`.

## Bell + modal

**Fan-out.** For an `is_major` entry, insert one `notifications` row per user: `league_id = NULL`, `kind = 'product'`, `title`, `content = summary`, `url = '/updates#<slug>'`, `read = false`. This goes through `createNotification` with `kind: 'product'` so it respects the push/email opt-in matrix like every other notification type; `NOTIFICATION_KINDS` in `src/lib/notifications/prefs.ts` gains `'product'` with default `{ push: false, email: false }` (in-app only unless a tester turns it on).

**Bell.** `league_id` is nullable today and RLS only checks `user_id`, so a global row already reads correctly per-user — the only gap is `/api/notifications`'s GET handler, which currently does `.eq('league_id', leagueId)` when a league is given, excluding global rows. Loosen that to `.or(`league_id.eq.${leagueId},league_id.is.null`)` so a product-update row shows in every league's bell for that user. No change needed to the no-league (dashboard) case — it already fetches everything for the user.

**Modal.** New client component mounted once in the dashboard shell (same layer as `TopBar`), not per-page. On mount, it checks the same notifications the bell already fetches for the most recent unread row with `kind = 'product'`. If one exists, show a modal with `title` / `summary` / a link into `/updates#<slug>`, and mark it read (same `POST /api/notifications` call the bell uses) when dismissed or when the link is followed. Because it's the same row, dismissing the modal clears the bell badge too, and vice versa — no separate "seen" tracking to build.

## First entry

Once this ships, Claude drafts one entry covering the last week plus everything on `perf-block-preview`: the performance block / matchup explainer, expanded crest customization, configurable league-size recommendations, the new notification-preferences settings page, and loan/academy support — written for a player reading it, not a developer. Marked `is_major: true`. Duke approves before it goes out.

## Testing / verification

- `npm run build` after the migration and route/component changes.
- Manual check in the browser preview: insert a test row via MCP, confirm it renders on `/updates`, confirm the bell shows it (including from inside a league, to verify the `league_id IS NULL` fix), confirm the modal pops once and doesn't reappear after dismissal.
- Confirm a non-major entry does not trigger the bell/modal at all.

## Future considerations (not building now)

- An admin form, if hand-authoring through Claude ever becomes a bottleneck.
- A digest email for testers who don't open the app often.
- Per-league targeting, if a future change only applies to some leagues.
