-- ============================================================
-- Migration 001 — Initial schema
-- Tworzy wszystkie tabele bazowe aplikacji
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  email              TEXT    UNIQUE NOT NULL,
  first_name         TEXT,
  last_name          TEXT,
  is_admin           INTEGER DEFAULT 0,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login         DATETIME
);

CREATE TABLE IF NOT EXISTS magic_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  token      TEXT    UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  used       INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS classes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  description  TEXT,
  start_time   DATETIME NOT NULL,
  duration_min INTEGER DEFAULT 90,
  max_spots    INTEGER NOT NULL,
  instructor   TEXT,
  category     TEXT    DEFAULT 'adults',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_cancelled INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id   INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(class_id, user_id),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)   ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS participants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  first_name TEXT    NOT NULL,
  last_name  TEXT    NOT NULL,
  is_main    INTEGER DEFAULT 0,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qr_scans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT,
  user_agent TEXT,
  scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_classes_start_time ON classes(start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_class_id  ON bookings(class_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id   ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_token ON magic_tokens(token);
