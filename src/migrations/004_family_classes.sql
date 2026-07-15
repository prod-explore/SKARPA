-- ============================================================
-- Migration 004 — Zajęcia rodzinne (dzieci + dorośli)
-- Rozdzielenie pul miejsc na dorosłych i dzieci,
-- dodanie drugiego instruktora (animacje dla dzieci)
-- ============================================================

ALTER TABLE classes ADD COLUMN class_type       TEXT    DEFAULT 'adult_only';
ALTER TABLE classes ADD COLUMN max_child_spots  INTEGER DEFAULT 0;
ALTER TABLE classes ADD COLUMN child_instructor TEXT;

ALTER TABLE participants ADD COLUMN age_category TEXT    DEFAULT 'adult';
ALTER TABLE participants ADD COLUMN age          INTEGER;
ALTER TABLE participants ADD COLUMN child_age    INTEGER;
