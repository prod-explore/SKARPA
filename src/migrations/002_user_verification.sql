-- ============================================================
-- Migration 002 — Weryfikacja użytkowników i zgody rodzicielskie
-- Dodaje kategorie wiekowe, weryfikację konta i zgody RODO
-- ============================================================

ALTER TABLE users ADD COLUMN age_category      TEXT    DEFAULT NULL;
ALTER TABLE users ADD COLUMN is_verified       INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN consent_requested INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN birth_date        TEXT;
ALTER TABLE users ADD COLUMN marketing_consent INTEGER DEFAULT 0;
