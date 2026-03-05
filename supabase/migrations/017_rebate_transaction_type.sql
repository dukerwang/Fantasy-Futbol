-- ============================================================
-- Fantasy Futbol — Migration 017: Add rebate & transfer_out
-- to transaction_type enum and supporting indices.
-- ============================================================

-- Extend the transaction_type enum to support two new types:
--   'transfer_out' — player transferred out of the PL by a manager
--   'rebate'       — Scout's Finder's Fee credited to an auction initiator
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'transfer_out';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'rebate';
