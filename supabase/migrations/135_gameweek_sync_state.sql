-- Records that Gaffa has run its post-lockdown ("final") stats pass for a
-- gameweek.
--
-- Background: for 2026/27 FPL moved the gameweek lockdown to 09:00 UK on the
-- day after the final match, so that post-match Opta review data can be folded
-- into the Bonus Points System. The ICT block (influence/creativity/threat)
-- reads 0.0 for every player until that lockdown fires. Anything scored before
-- it is therefore provisional.
--
-- Matchup resolution must not lock a gameweek until the final pass has written
-- those reviewed stats. `resolveAllStalledGameweeks` reads this table to decide
-- whether it is safe to lock; `syncFplLiveRatings` writes to it once it has
-- completed a pass with FPL reporting the event as finished.

create table if not exists gameweek_sync_state (
    season           text        not null,
    gameweek         integer     not null,
    -- When the post-lockdown pass wrote reviewed stats for this gameweek.
    -- Null means the gameweek has only ever been synced live; its ICT block
    -- may still be zeroed and its scores must not be locked in.
    final_synced_at  timestamptz,
    updated_at       timestamptz not null default now(),
    primary key (season, gameweek)
);

comment on table gameweek_sync_state is
    'Per-gameweek record of whether the post-lockdown final stats pass has run. Gates matchup resolution.';
comment on column gameweek_sync_state.final_synced_at is
    'Set when a stats sync completed while FPL reported the event finished. Null = provisional data only.';

alter table gameweek_sync_state enable row level security;

-- Server-side only: written by the cron stats sync, read by the resolver, both
-- of which use the service role. No client ever touches this table, so no
-- policy grants access — RLS denies by default and the service role bypasses it.
