-- ============================================================
-- Migration 005 — Kolor i archiwizacja zajęć
-- Możliwość kolorowania zajęć w kalendarzu,
-- soft-delete przez archiwizację zamiast usuwania
-- ============================================================

ALTER TABLE classes ADD COLUMN color      TEXT    DEFAULT '#6366f1';
ALTER TABLE classes ADD COLUMN is_archived INTEGER DEFAULT 0;
