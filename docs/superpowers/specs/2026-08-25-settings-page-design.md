# Settings page, notification prefs, user guide, and report form

## Problem

Gaffa has no settings surface. Push is a switch in the avatar menu. Theme is a sun/moon in the top bar. The player guide exists only as `docs/USER_GUIDE.md` outside the app. Leave/Delete sits at the bottom of league home. Managers who want to report a bug or a scoring question have no in-app path to Duke.

## Non-goals

- No in-game mail preferences. The inbox always receives every notification.
- No new email templates. Turning Email on for a category that has no template does not invent one. Chat has no email and shows no Email control.
- No ticket table, no in-app thread, no copy of the report back to the manager.
- No nested settings routes (`/settings/notifications`, and so on). One page, stacked sections.
- No change to which events are worth an email in the default policy. Defaults match today's send sites.
- No username/email editing, no privacy/terms links, no list of other devices' push subscriptions.
- Theme stays on the top bar. Settings also shows it; it is not moved exclusively onto this page.
- League switcher, Create/Join, and Sign out stay in the avatar menu.

## Surface and navigation

Settings is one component, two URLs, so league chrome does not vanish when you open it from inside a league.

- Inside a league, the avatar **Settings** row (gear, existing `settings` icon) goes to `/league/[leagueId]/settings`. Home / Squad / Transfers stay in the top bar. The League section (crest, Leave/Delete) is visible.
- From the dashboard, it goes to `/settings`. No league nav, no League section.

The user-guide page uses the same split: `/league/[leagueId]/guide` and `/guide`. Settings links to whichever matches the current context. A back link on the guide returns to Settings.

Push comes out of the avatar dropdown and the mobile drawer. Those two places currently render `NotificationsToggle`; they stop doing that. The mobile drawer gets a Settings row that uses the same URLs as the avatar menu.

## Page layout

Stacked sections, no eyebrow above the title. Title is **Settings**.

1. **Appearance** — the existing theme toggle, same control as the top bar.
2. **Notifications** — this-device push switch (with the iOS Home Screen hint when needed), then the category grid.
3. **Help** — a row that opens the user guide; below it, the report form.
4. **League** (league URL only) — Edit crest (existing `/league/[id]/crest` page) and the Leave/Delete control currently at the bottom of league home. League home loses that button.

Sign out is not duplicated here.

## Notification preferences

### Model

Five kinds: `auctions`, `deals`, `matchdays`, `chat`, `club`.

Each kind has `{ push: boolean, email: boolean }`. Stored as JSON on `users.notification_prefs`. `NULL` means "use defaults." A partial object merges with defaults per kind and per channel; a missing key does not mean off.

Defaults, matching today's send policy:

| Kind | Push | Email |
|---|---|---|
| `auctions` | on | on (opens and results only) |
| `deals` | on | on (completed trades/loans only) |
| `matchdays` | on | on (GW summary only; cup ties have no email) |
| `chat` | on | off, and the Email cell is not shown |
| `club` | on | on (draft start/schedule and season kickoff; drops and departures have no email) |

In-game mail always writes. Push is skipped when that kind's `push` is off **or** the user has no push subscription. Email is skipped when that kind's `email` is off. Broadcast emails (GW summary, auction-won, trade accepted) are filtered per recipient; if the filtered list is empty, nothing is sent.

### This device vs the grid

The existing subscribe/unsubscribe path (`getPushAvailability` / `subscribeToPush` / `unsubscribeFromPush`) remains the device switch. Off means this browser's lock screen is silent. The grid is account-wide: Auctions → Push off means no auction push on any device.

Unsupported browsers hide the device switch. iOS Safari not running as a Home Screen app keeps the current hint instead of a switch.

### Write path

`PATCH /api/user/notification-prefs` with `{ kind, channel, enabled }`. Validates the three fields, merges into the JSON, returns the full resolved prefs. Each grid toggle saves itself (optimistic, revert on error). No page-level Save.

`users` already has "update own" RLS. The route still exists so the shape is validated in one place rather than trusting the client JSON.

### Read path at send time

`createNotification` gains a required `kind`. It always inserts the in-app row, then calls `sendPushToUser` only if `wantsChannel(prefs, kind, 'push')`.

Email call sites do not go through `createNotification`. They go through a small helper, `sendEmailToUsers({ userIds, kind, subject, html })`, which loads those users' emails and prefs, drops anyone who has that kind's email off, and then calls the existing `sendEmail`. Today's `sendEmail({ to: emails })` blasts are replaced with this helper so a single opt-out cannot be ignored because the address was already in a list.

`scripts/sync_transfermarkt.ts` is operator mail, not a manager preference. It does not use the helper.

### Kind map (every manager-facing send)

Required so a new call site cannot ship uncategorized. TypeScript makes `kind` required on both helpers.

**auctions** — `seedHighValueAuctions.ts`; `notifyAuctionResolution.ts`; `listings/route.ts` (new listing); `listings/[listingId]/bid/route.ts`; `auctions/bid/route.ts`.

**deals** — `trades/route.ts` (proposal); `trades/[tradeId]/route.ts` (accept/reject and the trade-accepted email); `loans/route.ts`; `loans/[loanId]/route.ts`; `loans/[loanId]/recall/route.ts`; `loans/[loanId]/slot-buyback/route.ts`; `cron/process-loans/route.ts`.

**matchdays** — `matchupProcessor.ts` (GW summary email + in-app); `advanceTournament.ts` (cup result: push/mail only).

**chat** — `api/chat/route.ts` (DMs only).

**club** — `seasonKickoff.ts`; `seasonReset.ts`; `departures/{detect,decisions,resolve}.ts`; `roster/executeDrop.ts`; `teams/[teamId]/drop/route.ts`; `draft/pick/route.ts` (on the clock); `draft/auto-pick/route.ts`; `draft/start/route.ts`; `draft/schedule/route.ts`; `cron/start-scheduled-drafts/route.ts`.

## User guide

A server-rendered page that reads `docs/USER_GUIDE.md` from the repo (one source; no second copy of the rules). Render headings, lists, tables, and blockquotes. The app has no markdown library today; add a small renderer (`react-markdown` + `remark-gfm` is enough). If Vercel file tracing does not include `docs/`, add an `outputFileTracingIncludes` entry in `next.config.ts` rather than duplicating the file into `src/`.

## Report form

On the Settings page, not a separate route.

Fields: **Type** (Bug, Feedback, Feature, Other) and **Message**. Both required.

`POST /api/support` (logged-in). Body is type + message. The server attaches username, email, and current league name when the request came from `/league/[id]/settings` (pass `leagueId` from the page). Sends one email via the existing Resend client to every address in `ADMIN_EMAILS` (same allowlist as site admin). Subject includes the type, e.g. `Gaffa report · Bug`.

Success: clear the message, keep the type, show a short confirmation on the form. Failure (empty message, Resend missing or rejected): error on the form, nothing claimed as sent. No ticket row.

## Errors and empty states

- Pref save fails: that switch reverts; the rest of the page is untouched.
- Push permission denied: device switch stays off.
- Guide file unreadable: the guide page shows an error, not a blank article.
- Report with Resend unset: the form says the report could not be sent.

## Tests

Unit-test `wantsChannel` (and the merge-with-defaults helper): full defaults, `NULL` prefs, partial JSON, chat email stays off by default, unknown kind does not throw (treat as "send" so a typo cannot silently drop mail). No requirement to integration-test every call site; the type on `kind` is the backstop for new sites.

## Approved in conversation (2026-08-25)

- Avatar menu, not a top-nav tab. Gear row.
- Troubleshoot mailbox = categorized email to Duke, no thread.
- Push and Email per category; in-game mail not configurable.
- Email column only suppresses templates that already exist.
- User guide is its own page, linked from Settings (not inline).
- One stacked `/settings` page; crest and Leave/Delete live in a League section when opened from a league.
