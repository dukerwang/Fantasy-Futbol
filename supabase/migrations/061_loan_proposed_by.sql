-- ============================================================
-- Migration 061: Add proposed_by to player_loans
-- Enables borrower-initiated loan requests alongside the
-- existing lender-initiated loan proposals.
-- ============================================================

ALTER TABLE public.player_loans
  ADD COLUMN IF NOT EXISTS proposed_by TEXT NOT NULL DEFAULT 'lender'
  CHECK (proposed_by IN ('lender', 'borrower'));

COMMENT ON COLUMN public.player_loans.proposed_by IS
  'lender = the player owner proposed the loan (classic flow); '
  'borrower = the receiving team requested the loan (request flow)';
