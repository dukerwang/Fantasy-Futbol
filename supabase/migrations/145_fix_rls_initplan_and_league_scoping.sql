-- Fixes two issues found via the Supabase performance advisor's
-- "Auth RLS Initialization Plan" lint (auth_rls_initplan):
--
-- 1. Security bug: five policies compared `lm.league_id = lm.league_id`
--    (always true) instead of scoping to the target row's league_id.
--    This let any authenticated league member read every league's
--    draft picks, transactions, waiver claims, and tournaments, and
--    insert chat messages into leagues they don't belong to.
-- 2. Performance: auth.uid()/auth.role() called directly in a policy
--    re-evaluates per row instead of once per query. Wrapping in
--    `(select ...)` lets the planner cache it.

-- ---------- users ----------
drop policy if exists "Users: update own" on public.users;
create policy "Users: update own" on public.users
  for update using ((select auth.uid()) = id);

-- ---------- leagues ----------
drop policy if exists "Leagues: read if member" on public.leagues;
create policy "Leagues: read if member" on public.leagues
  for select using (
    (select auth.uid()) = commissioner_id
    or exists (
      select 1 from league_members lm
      where lm.league_id = leagues.id and lm.user_id = (select auth.uid())
    )
  );

drop policy if exists "Leagues: create" on public.leagues;
create policy "Leagues: create" on public.leagues
  for insert with check ((select auth.uid()) = commissioner_id);

drop policy if exists "Leagues: update if commissioner" on public.leagues;
create policy "Leagues: update if commissioner" on public.leagues
  for update using ((select auth.uid()) = commissioner_id);

-- ---------- teams ----------
drop policy if exists "Teams: update own" on public.teams;
create policy "Teams: update own" on public.teams
  for update using ((select auth.uid()) = user_id);

drop policy if exists "Teams: read if league member" on public.teams;
create policy "Teams: read if league member" on public.teams
  for select using (
    exists (
      select 1 from league_members lm
      where lm.league_id = teams.league_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- roster_entries ----------
drop policy if exists "Roster: read if league member" on public.roster_entries;
create policy "Roster: read if league member" on public.roster_entries
  for select using (
    exists (
      select 1 from teams t
      join league_members lm on lm.league_id = t.league_id
      where t.id = roster_entries.team_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- transactions (security fix: was lm.league_id = lm.league_id) ----------
drop policy if exists "Transactions: read if league member" on public.transactions;
create policy "Transactions: read if league member" on public.transactions
  for select using (
    exists (
      select 1 from league_members lm
      where lm.league_id = transactions.league_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- draft_picks (security fix: was lm.league_id = lm.league_id) ----------
drop policy if exists "Draft picks: read if league member" on public.draft_picks;
create policy "Draft picks: read if league member" on public.draft_picks
  for select using (
    exists (
      select 1 from league_members lm
      where lm.league_id = draft_picks.league_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- draft_queues ----------
drop policy if exists "Draft queue: manage own" on public.draft_queues;
create policy "Draft queue: manage own" on public.draft_queues
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- waiver_claims (security fix on read: was lm.league_id = lm.league_id) ----------
drop policy if exists "Waiver claims: read if league member" on public.waiver_claims;
create policy "Waiver claims: read if league member" on public.waiver_claims
  for select using (
    exists (
      select 1 from league_members lm
      where lm.league_id = waiver_claims.league_id and lm.user_id = (select auth.uid())
    )
  );

drop policy if exists "Waiver claims: insert own" on public.waiver_claims;
create policy "Waiver claims: insert own" on public.waiver_claims
  for insert with check (
    exists (
      select 1 from teams t
      where t.id = waiver_claims.team_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "Waiver claims: update own" on public.waiver_claims;
create policy "Waiver claims: update own" on public.waiver_claims
  for update using (
    exists (
      select 1 from teams t
      where t.id = waiver_claims.team_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "Waiver claims: delete own" on public.waiver_claims;
create policy "Waiver claims: delete own" on public.waiver_claims
  for delete using (
    exists (
      select 1 from teams t
      where t.id = waiver_claims.team_id and t.user_id = (select auth.uid())
    )
  );

-- ---------- tournaments (security fix: was lm.league_id = lm.league_id) ----------
drop policy if exists "Tournaments: read if league member" on public.tournaments;
create policy "Tournaments: read if league member" on public.tournaments
  for select using (
    exists (
      select 1 from league_members lm
      where lm.league_id = tournaments.league_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- tournament_rounds ----------
drop policy if exists "Tournament rounds: read if league member" on public.tournament_rounds;
create policy "Tournament rounds: read if league member" on public.tournament_rounds
  for select using (
    exists (
      select 1 from tournaments t
      join league_members lm on lm.league_id = t.league_id
      where t.id = tournament_rounds.tournament_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- tournament_matchups ----------
drop policy if exists "Tournament matchups: read if league member" on public.tournament_matchups;
create policy "Tournament matchups: read if league member" on public.tournament_matchups
  for select using (
    exists (
      select 1 from tournament_rounds tr
      join tournaments t on t.id = tr.tournament_id
      join league_members lm on lm.league_id = t.league_id
      where tr.id = tournament_matchups.round_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- season_transitions ----------
drop policy if exists "Season transitions: read if league member" on public.season_transitions;
create policy "Season transitions: read if league member" on public.season_transitions
  for select using (
    league_id is null
    or exists (
      select 1 from league_members lm
      where lm.league_id = season_transitions.league_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- season_standings_archive ----------
drop policy if exists "Season archive: read if league member" on public.season_standings_archive;
create policy "Season archive: read if league member" on public.season_standings_archive
  for select using (
    exists (
      select 1 from league_members lm
      where lm.league_id = season_standings_archive.league_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- notifications ----------
drop policy if exists "Notifications: select own" on public.notifications;
create policy "Notifications: select own" on public.notifications
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Notifications: update own" on public.notifications;
create policy "Notifications: update own" on public.notifications
  for update using ((select auth.uid()) = user_id);

-- ---------- chat_messages ----------
drop policy if exists "Chat: select if league member" on public.chat_messages;
create policy "Chat: select if league member" on public.chat_messages
  for select using (
    exists (
      select 1 from teams t
      where t.league_id = chat_messages.league_id and t.user_id = (select auth.uid())
    )
    or exists (
      select 1 from leagues l
      where l.id = chat_messages.league_id and l.commissioner_id = (select auth.uid())
    )
  );

-- security fix: with_check was lm.league_id = lm.league_id (any league member
-- could post into any league's chat)
drop policy if exists "Chat: insert if league member" on public.chat_messages;
create policy "Chat: insert if league member" on public.chat_messages
  for insert with check (
    (sender_id is null or (select auth.uid()) = sender_id)
    and exists (
      select 1 from league_members lm
      where lm.league_id = chat_messages.league_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- league_members ----------
drop policy if exists "League members: read" on public.league_members;
create policy "League members: read" on public.league_members
  for select using (
    user_id = (select auth.uid())
    or is_league_member(league_id, (select auth.uid()))
  );

-- ---------- pending_drops ----------
drop policy if exists "Enable write access for team owner" on public.pending_drops;
create policy "Enable write access for team owner" on public.pending_drops
  for all using (
    exists (
      select 1 from teams t
      where t.id = pending_drops.team_id and t.user_id = (select auth.uid())
    )
  ) with check (
    exists (
      select 1 from teams t
      where t.id = pending_drops.team_id and t.user_id = (select auth.uid())
    )
  );

-- ---------- player_sale_listings ----------
drop policy if exists "league_members_view_listings" on public.player_sale_listings;
create policy "league_members_view_listings" on public.player_sale_listings
  for select using (
    exists (
      select 1 from teams t
      where t.league_id = player_sale_listings.league_id and t.user_id = (select auth.uid())
    )
  );

-- ---------- player_loans ----------
drop policy if exists "Loans: read if league member" on public.player_loans;
create policy "Loans: read if league member" on public.player_loans
  for select using (
    exists (
      select 1 from teams t
      where t.league_id = player_loans.league_id and t.user_id = (select auth.uid())
    )
  );

-- ---------- season_matchups_archive ----------
drop policy if exists "Season matchups archive: read if league member" on public.season_matchups_archive;
create policy "Season matchups archive: read if league member" on public.season_matchups_archive
  for select using (
    exists (
      select 1 from league_members lm
      where lm.league_id = season_matchups_archive.league_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- season_cup_winners_archive ----------
drop policy if exists "Season cup winners archive: read if league member" on public.season_cup_winners_archive;
create policy "Season cup winners archive: read if league member" on public.season_cup_winners_archive
  for select using (
    exists (
      select 1 from league_members lm
      where lm.league_id = season_cup_winners_archive.league_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- departure_decisions ----------
drop policy if exists "departure_decisions_select" on public.departure_decisions;
create policy "departure_decisions_select" on public.departure_decisions
  for select using (
    exists (
      select 1 from teams t
      where t.league_id = departure_decisions.league_id and t.user_id = (select auth.uid())
    )
  );

-- ---------- trade_proposals ----------
drop policy if exists "Trade proposals: read own or settled" on public.trade_proposals;
create policy "Trade proposals: read own or settled" on public.trade_proposals
  for select using (
    exists (
      select 1 from teams t
      where t.id = any (array[trade_proposals.team_a_id, trade_proposals.team_b_id])
        and t.user_id = (select auth.uid())
    )
    or (
      status = any (array['accepted'::trade_proposal_status, 'accepted_deferred'::trade_proposal_status])
      and exists (
        select 1 from league_members lm
        where lm.league_id = trade_proposals.league_id and lm.user_id = (select auth.uid())
      )
    )
  );

-- ---------- auction_state ----------
drop policy if exists "Auction state: read if league member" on public.auction_state;
create policy "Auction state: read if league member" on public.auction_state
  for select using (
    exists (
      select 1 from teams t
      where t.league_id = auction_state.league_id and t.user_id = (select auth.uid())
    )
  );

-- ---------- merit_payments ----------
drop policy if exists "merit_payments_select_own_league" on public.merit_payments;
create policy "merit_payments_select_own_league" on public.merit_payments
  for select using (
    league_id in (
      select league_members.league_id from league_members
      where league_members.user_id = (select auth.uid())
    )
  );

-- ---------- matchups ----------
drop policy if exists "Matchups: read if league member" on public.matchups;
create policy "Matchups: read if league member" on public.matchups
  for select using (
    exists (
      select 1 from league_members lm
      where lm.league_id = matchups.league_id and lm.user_id = (select auth.uid())
    )
  );

-- ---------- chat_read_state ----------
drop policy if exists "Chat read state: manage own" on public.chat_read_state;
create policy "Chat read state: manage own" on public.chat_read_state
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- push_subscriptions ----------
drop policy if exists "Push subscriptions: select own" on public.push_subscriptions;
create policy "Push subscriptions: select own" on public.push_subscriptions
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Push subscriptions: insert own" on public.push_subscriptions;
create policy "Push subscriptions: insert own" on public.push_subscriptions
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Push subscriptions: update own" on public.push_subscriptions;
create policy "Push subscriptions: update own" on public.push_subscriptions
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Push subscriptions: delete own" on public.push_subscriptions;
create policy "Push subscriptions: delete own" on public.push_subscriptions
  for delete using ((select auth.uid()) = user_id);

-- ---------- product_updates ----------
drop policy if exists "Product updates: readable by any authenticated user" on public.product_updates;
create policy "Product updates: readable by any authenticated user" on public.product_updates
  for select using ((select auth.role()) = 'authenticated'::text);
