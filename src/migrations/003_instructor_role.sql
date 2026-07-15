-- ============================================================
-- Migration 003 — Role instruktorów
-- Wyróżnienie instruktorów spośród zwykłych użytkowników
-- ============================================================

ALTER TABLE users ADD COLUMN is_instructor INTEGER DEFAULT 0;
