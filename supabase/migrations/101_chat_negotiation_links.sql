-- Link chat_messages to the negotiation they represent (trade / loan proposal),
-- replacing the fragile [SYSTEM:TRADE_PROPOSAL:{json}] / [SYSTEM:LOAN_PROPOSAL:{json}]
-- string-embedded-snapshot convention with a live FK the UI can re-query.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS trade_id UUID REFERENCES public.trade_proposals(id) ON DELETE SET NULL;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS loan_id UUID REFERENCES public.player_loans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_trade_id ON public.chat_messages(trade_id) WHERE trade_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_loan_id ON public.chat_messages(loan_id) WHERE loan_id IS NOT NULL;

-- Give loans a counter-offer chain, mirroring trade_proposals.parent_trade_id (029_trade_block.sql).
ALTER TABLE public.player_loans ADD COLUMN IF NOT EXISTS parent_loan_id UUID REFERENCES public.player_loans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_player_loans_parent_loan_id ON public.player_loans(parent_loan_id) WHERE parent_loan_id IS NOT NULL;

-- trade_proposals is already realtime-enabled (078_auction_state_projection.sql); player_loans is not.
-- Chat cards need live UPDATE events on player_loans so a status change (accept/reject/counter)
-- made anywhere reflects instantly in any open chat thread.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'player_loans'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.player_loans;
  END IF;
END $$;
