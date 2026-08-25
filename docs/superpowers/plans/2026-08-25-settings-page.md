# Settings page implementation plan

> **For agentic workers:** Implement task-by-task. Checkboxes track progress. Spec is the source of truth.

**Goal:** Ship a Settings page (avatar gear), per-category push/email prefs, an in-app user guide, and a report form that emails site admins.

**Source of truth:** `docs/superpowers/specs/2026-08-25-settings-page-design.md`.

**Tech stack:** Next.js App Router, CSS Modules, Supabase JSONB on `users`, existing Resend + Web Push, `react-markdown` + `remark-gfm` for the guide.

## Global constraints

- `npm run build` and `npm test` must pass before declaring done.
- Migration applied via Supabase MCP against project **Gaffa** (`hnkavimrsbytsesdzwvj`), not left as a paste instruction.
- CSS Modules only; reuse `--color-*` tokens; check both themes.
- User-facing copy never says "FAAB".
- Do not invent email templates for categories that have none today.
- `kind` is required on `createNotification` and `sendEmailToUsers` so new call sites cannot ship uncategorized.

## File structure

| Path | Action |
|---|---|
| `src/lib/notifications/prefs.ts` | Create — kinds, defaults, `resolvePrefs`, `wantsChannel`, `mergePref` |
| `src/lib/notifications/__tests__/prefs.test.ts` | Create |
| `src/lib/email/sendEmailToUsers.ts` | Create — prefs-aware email helper |
| `src/lib/notifications/createNotification.ts` | Modify — required `kind`; skip push when opted out |
| `supabase/migrations/139_user_notification_prefs.sql` | Create — `users.notification_prefs JSONB` |
| `src/app/api/user/notification-prefs/route.ts` | Create — GET + PATCH |
| `src/app/api/support/route.ts` | Create — POST report → `ADMIN_EMAILS` |
| `src/lib/auth/siteAdmin.ts` | Modify — export `getSiteAdminEmails` |
| `src/components/settings/SettingsClient.tsx` + `.module.css` | Create |
| `src/components/settings/GuideView.tsx` + `.module.css` | Create |
| `src/lib/guide/loadUserGuide.ts` | Create |
| `src/app/(dashboard)/settings/page.tsx` | Create |
| `src/app/(dashboard)/guide/page.tsx` | Create |
| `src/app/(dashboard)/league/[leagueId]/settings/page.tsx` | Create |
| `src/app/(dashboard)/league/[leagueId]/guide/page.tsx` | Create |
| `next.config.ts` | Modify — file-tracing include for `docs/USER_GUIDE.md` |
| `src/components/layout/TopBar.tsx` | Modify — Settings row; remove `NotificationsToggle` |
| `src/app/(dashboard)/league/[leagueId]/page.tsx` | Modify — remove Leave/Delete |
| Call sites in the spec kind map | Modify — pass `kind`; manager emails → `sendEmailToUsers` |

## Task 1: Prefs module + tests

- [x] Create `prefs.ts` with kinds `auctions | deals | matchdays | chat | club`, defaults from the spec, `resolvePrefs`, `wantsChannel` (unknown kind → send), `mergePref`.
- [x] Create unit tests: defaults, null, partial JSON, chat email off, unknown kind sends.
- [x] Run `npm test -- src/lib/notifications/__tests__/prefs.test.ts`.

## Task 2: Migration

- [x] Confirm head: `ls supabase/migrations | tail -3` → use next number if 139 taken.
- [x] Write `139_user_notification_prefs.sql`: `ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB;`
- [x] Apply via Supabase MCP `apply_migration` on Gaffa.

## Task 3: Send-path helpers + wire call sites

- [x] `createNotification`: require `kind`; load prefs; skip push when `!wantsChannel(..., 'push')`; still always insert in-app row.
- [x] `sendEmailToUsers({ admin, userIds, kind, subject, html })`: load emails+prefs, filter, call `sendEmail`.
- [x] Export `getSiteAdminEmails` from `siteAdmin.ts`.
- [x] Every call site in the spec kind map: add `kind`. Every manager-facing `sendEmail` blast → `sendEmailToUsers`. Leave `scripts/sync_transfermarkt.ts` alone.

## Task 4: APIs

- [x] `GET/PATCH /api/user/notification-prefs` — auth required; PATCH `{ kind, channel, enabled }`; return resolved prefs.
- [x] `POST /api/support` — auth required; `{ type, message, leagueId? }`; email `ADMIN_EMAILS`; attach username/email/league name.

## Task 5: UI + nav

- [x] Shared `SettingsClient` (Appearance, Notifications device+grid, Help guide link + report, League section when `leagueId` set).
- [x] Guide page loads markdown via `loadUserGuide` + `react-markdown`/`remark-gfm`. Install packages if missing. `outputFileTracingIncludes` for the md file.
- [x] TopBar: Settings link in avatar menu + mobile drawer; remove `NotificationsToggle` from both.
- [x] Remove LeaveLeagueButton from league home; render it in Settings League section only.

## Task 6: Verify

- [x] `npm test`
- [x] `npm run build`
- [ ] Spot-check: avatar gear → settings, guide, report form, both themes, mobile drawer Settings row, Leave gone from home.

## Out of scope (do not build)

- In-game mail prefs, new email templates, ticket table, nested settings routes, username editing, device subscription list.
