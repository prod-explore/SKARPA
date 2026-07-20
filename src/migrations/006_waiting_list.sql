-- ============================================================
-- Migration 006 — Waiting list (lista rezerwowa)
-- Dodaje tabelę waiting_list oraz kolumny do classes
-- ============================================================

-- Tabela listy rezerwowej (tylko dorośli, jeden slot per user+class)
CREATE TABLE IF NOT EXISTS waiting_list (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id   INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(class_id, user_id),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)   ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_waiting_list_class_id ON waiting_list(class_id);
CREATE INDEX IF NOT EXISTS idx_waiting_list_user_id  ON waiting_list(user_id);

-- Flaga: czy lista rezerwowa jest włączona dla tych zajęć
ALTER TABLE classes ADD COLUMN waiting_list_enabled INTEGER DEFAULT 0;

-- Maksymalna liczba miejsc na liście rezerwowej
ALTER TABLE classes ADD COLUMN max_waiting_spots INTEGER DEFAULT 10;
