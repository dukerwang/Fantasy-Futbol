-- ============================================================
-- Fantasy Futbol — Trade Proposals
-- Run this in your Supabase SQL editor.
-- ============================================================

CREATE TYPE trade_proposal_status AS ENUM ('pending', 'accepted', 'rejected', 'cancelled');

CREATE TABLE public.trade_proposals (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id         UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_a_id         UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  team_b_id         UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  offered_players   UUID[] NOT NULL DEFAULT '{}',   -- player IDs from team A offered to team B
  requested_players UUID[] NOT NULL DEFAULT '{}',   -- player IDs from team B requested by team A
  offered_faab      INT NOT NULL DEFAULT 0,          -- FAAB team A adds to the deal
  requested_faab    INT NOT NULL DEFAULT 0,          -- FAAB team B adds to the deal
  status            trade_proposal_status NOT NULL DEFAULT 'pending',
  message           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (team_a_id <> team_b_id),
  CHECK (offered_faab >= 0),
  CHECK (requested_faab >= 0)
);

CREATE INDEX idx_trade_proposals_league ON public.trade_proposals(league_id);
CREATE INDEX idx_trade_proposals_team_a ON public.trade_proposals(team_a_id);
CREATE INDEX idx_trade_proposals_team_b ON public.trade_proposals(team_b_id);
CREATE INDEX idx_trade_proposals_status ON public.trade_proposals(status);

CREATE TRIGGER update_trade_proposals_updated_at
  BEFORE UPDATE ON public.trade_proposals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.trade_proposals ENABLE ROW LEVEL SECURITY;

-- League members can read all trade proposals in their leagues
CREATE POLICY "Trade proposals: read if league member"
  ON public.trade_proposals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_id AND lm.user_id = auth.uid()
    )
  );
