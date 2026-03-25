-- Add trade block column to roster entries
ALTER TABLE public.roster_entries ADD COLUMN IF NOT EXISTS on_trade_block BOOLEAN NOT NULL DEFAULT false;

-- Add parent trade reference for counter-offers
ALTER TABLE public.trade_proposals ADD COLUMN IF NOT EXISTS parent_trade_id UUID REFERENCES public.trade_proposals(id) ON DELETE SET NULL;
