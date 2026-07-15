/**
 * migrations/runner.js — Wersjonowany system migracji bazy danych
 *
 * Zasada działania:
 *  1. Przy starcie tworzy tabelę `schema_migrations` jeśli nie istnieje.
 *  2. Skanuje pliki *.sql w tym katalogu, sortuje je numerycznie (001, 002, …).
 *  3. Wykonuje tylko te migracje, które NIE zostały jeszcze zapisane w tabeli.
 *  4. Każda migracja jest owinięta w transakcję — niepowodzenie zatrzymuje start.
 *
 * Dodawanie nowej migracji: utwórz plik 006_opis.sql w tym samym katalogu.
 */

const fs   = require('fs');
const path = require('path');

const MIGRATIONS_DIR = __dirname;

/**
 * Uruchamia wszystkie niezastosowane migracje.
 * @param {import('better-sqlite3').Database} db — już otwarta instancja bazy
 */
function runMigrations(db) {
  // Tabela kontrolna wersji
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      filename   TEXT    UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Pliki SQL posortowane numerycznie
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_.*\.sql$/.test(f))
    .sort();

  const applied = new Set(
    db.prepare('SELECT filename FROM schema_migrations').all().map(r => r.filename)
  );

  let count = 0;

  for (const filename of files) {
    if (applied.has(filename)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');

    // Każda migracja w jednej transakcji
    const migrate = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(filename);
    });

    try {
      migrate();
      console.log(`  ↳ Migracja [OK]: ${filename}`);
      count++;
    } catch (err) {
      console.error(`  ✖ Migracja [BŁĄD]: ${filename}`);
      console.error(`    ${err.message}`);
      // Ignoruj błędy "already exists" / "duplicate column" — wynikają ze starych danych
      // w bazach, które były migrowane ręcznie przed wprowadzeniem runnera.
      if (
        err.message.includes('already exists') ||
        err.message.includes('duplicate column')
      ) {
        // Zapisz migrację jako wykonaną mimo błędu, żeby nie próbowała się znów
        db.prepare('INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)').run(filename);
        console.log(`    → Zignorowano (kolumna/tabela już istnieje), oznaczono jako wykonaną.`);
      } else {
        throw err; // Nieznany błąd — przerwij start aplikacji
      }
    }
  }

  if (count > 0) {
    console.log(`✅ Migracje: zastosowano ${count} nowych.`);
  } else {
    console.log('✅ Migracje: baza aktualna, brak nowych migracji.');
  }
}

module.exports = { runMigrations };
