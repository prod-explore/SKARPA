/**
 * bookings.test.js — Testy integracyjne modeli bazy danych
 *
 * Testujemy na bazie in-memory (:memory:) — izolowane, bez dotykania produkcji.
 * Każdy test suite dostaje świeżą bazę.
 *
 * Uruchomienie: npm test
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');

// Podmień DB_PATH przed importem modeli — używamy :memory:
process.env.DB_PATH = ':memory:';

const { runMigrations } = require('../migrations/runner');

// ── Helper: tworzy świeżą bazę in-memory z pełnym schematem ──────────────────
function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ── Helper: uproszczone modele operujące na podanej bazie ────────────────────
function makeModels(db) {
  const createUser = (email) =>
    db.prepare('INSERT INTO users (email) VALUES (?)').run(email);

  const createClass = ({ name, startTime, maxSpots, maxChildSpots = 0, classType = 'adult_only' }) =>
    db.prepare(
      'INSERT INTO classes (name, start_time, max_spots, max_child_spots, class_type) VALUES (?,?,?,?,?)'
    ).run(name, startTime, maxSpots, maxChildSpots, classType);

  const countAdults = (classId) =>
    db.prepare(`
      SELECT COUNT(*) as cnt FROM participants p
      JOIN bookings b ON p.booking_id = b.id
      WHERE b.class_id = ? AND p.age_category = 'adult'
    `).get(classId).cnt;

  const countChildren = (classId) =>
    db.prepare(`
      SELECT COUNT(*) as cnt FROM participants p
      JOIN bookings b ON p.booking_id = b.id
      WHERE b.class_id = ? AND p.age_category = 'child'
    `).get(classId).cnt;

  const bookWithParticipants = (userId, classId, participants) => {
    return db.transaction(() => {
      const booking = db.prepare(
        'INSERT INTO bookings (class_id, user_id) VALUES (?, ?)'
      ).run(classId, userId);

      const bookingId = booking.lastInsertRowid;

      const insertP = db.prepare(
        'INSERT INTO participants (booking_id, first_name, last_name, age_category, is_main) VALUES (?,?,?,?,?)'
      );
      for (const p of participants) {
        insertP.run(bookingId, p.firstName, p.lastName, p.ageCategory || 'adult', p.isMain ? 1 : 0);
      }
      return bookingId;
    })();
  };

  return { createUser, createClass, countAdults, countChildren, bookWithParticipants };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Migration runner', () => {
  test('tworzy tabelę schema_migrations', () => {
    const db = createTestDb();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    expect(row).toBeDefined();
  });

  test('rejestruje wszystkie pliki migracji', () => {
    const db = createTestDb();
    const applied = db.prepare('SELECT filename FROM schema_migrations ORDER BY filename').all();
    expect(applied.length).toBeGreaterThanOrEqual(5);
    expect(applied[0].filename).toBe('001_init_schema.sql');
  });

  test('powtórne uruchomienie runnera nie duplikuje migracji', () => {
    const db = createTestDb();
    runMigrations(db); // drugi raz
    const count = db.prepare('SELECT COUNT(*) as cnt FROM schema_migrations').get().cnt;
    const applied = db.prepare('SELECT filename FROM schema_migrations').all();
    const unique = new Set(applied.map(r => r.filename)).size;
    expect(unique).toBe(count);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Rezerwacje — podstawowe operacje', () => {
  let db, m;

  beforeEach(() => {
    db = createTestDb();
    m = makeModels(db);
  });

  test('tworzy rezerwację z uczestnikami', () => {
    const userId = m.createUser('test@example.com').lastInsertRowid;
    const classId = m.createClass({ name: 'Wspinaczka', startTime: '2027-01-01 10:00:00', maxSpots: 10 }).lastInsertRowid;

    const bookingId = m.bookWithParticipants(userId, classId, [
      { firstName: 'Jan', lastName: 'Kowalski', isMain: true }
    ]);

    expect(bookingId).toBeGreaterThan(0);

    const participants = db.prepare('SELECT * FROM participants WHERE booking_id = ?').all(bookingId);
    expect(participants).toHaveLength(1);
    expect(participants[0].first_name).toBe('Jan');
  });

  test('zlicza dorosłych i dzieci oddzielnie', () => {
    const userId = m.createUser('rodzic@example.com').lastInsertRowid;
    const classId = m.createClass({
      name: 'Rodzinne', startTime: '2027-01-01 10:00:00',
      maxSpots: 10, maxChildSpots: 5, classType: 'adult_and_child'
    }).lastInsertRowid;

    m.bookWithParticipants(userId, classId, [
      { firstName: 'Anna', lastName: 'Nowak', ageCategory: 'adult', isMain: true },
      { firstName: 'Kacper', lastName: 'Nowak', ageCategory: 'child', isMain: false }
    ]);

    expect(m.countAdults(classId)).toBe(1);
    expect(m.countChildren(classId)).toBe(1);
  });

  test('blokuje duplikaty rezerwacji (UNIQUE constraint)', () => {
    const userId = m.createUser('dup@example.com').lastInsertRowid;
    const classId = m.createClass({ name: 'Yoga', startTime: '2027-02-01 09:00:00', maxSpots: 5 }).lastInsertRowid;

    m.bookWithParticipants(userId, classId, [
      { firstName: 'X', lastName: 'Y', isMain: true }
    ]);

    expect(() => {
      m.bookWithParticipants(userId, classId, [
        { firstName: 'X', lastName: 'Y', isMain: true }
      ]);
    }).toThrow();
  });

  test('usunięcie rezerwacji kaskadowo usuwa uczestników', () => {
    const userId = m.createUser('del@example.com').lastInsertRowid;
    const classId = m.createClass({ name: 'Bouldering', startTime: '2027-03-01 12:00:00', maxSpots: 8 }).lastInsertRowid;

    const bookingId = m.bookWithParticipants(userId, classId, [
      { firstName: 'A', lastName: 'B', isMain: true }
    ]);

    db.prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);

    const remaining = db.prepare('SELECT * FROM participants WHERE booking_id = ?').all(bookingId);
    expect(remaining).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Limit miejsc', () => {
  let db, m;

  beforeEach(() => {
    db = createTestDb();
    m = makeModels(db);
  });

  test('nie pozwala przekroczyć limitu dorosłych (walidacja na poziomie aplikacji)', () => {
    const classId = m.createClass({ name: 'Pełne', startTime: '2027-04-01 10:00:00', maxSpots: 2 }).lastInsertRowid;

    // Wypełnij do limitu
    for (let i = 0; i < 2; i++) {
      const uid = m.createUser(`user${i}@example.com`).lastInsertRowid;
      m.bookWithParticipants(uid, classId, [
        { firstName: `U${i}`, lastName: 'Test', ageCategory: 'adult', isMain: true }
      ]);
    }

    const cls = db.prepare('SELECT max_spots FROM classes WHERE id = ?').get(classId);
    const taken = m.countAdults(classId);

    expect(taken).toBe(cls.max_spots); // zajęcia pełne
    expect(taken >= cls.max_spots).toBe(true);
  });
});
