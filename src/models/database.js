/**
 * database.js — Inicjalizacja bazy danych SQLite i modele danych
 * Używamy better-sqlite3 (synchroniczny, idealny do Dockera bez zewnętrznych usług)
 *
 * v2 — Kategorie wiekowe, podwójne limity miejsc, zgody rodzicielskie
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { calculateAge } = require('../utils/age');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/skarpa.db');

// Upewnij się, że katalog danych istnieje
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

/**
 * Inicjalizuje połączenie z bazą i tworzy tabele jeśli nie istnieją
 */
function initDatabase() {
  db = new Database(DB_PATH);

  // Włącz WAL mode dla lepszej wydajności przy równoczesnych odczytach
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Tabela użytkowników
    -- age_category: 'adult' lub 'child'
    -- is_verified: 1 (dorosły od razu, dziecko po zatwierdzeniu zgody)
    -- consent_requested: 1 gdy dziecko poprosiło o weryfikację
    CREATE TABLE IF NOT EXISTS users (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      email              TEXT    UNIQUE NOT NULL,
      first_name         TEXT,
      last_name          TEXT,
      age_category       TEXT    DEFAULT NULL,
      is_verified        INTEGER DEFAULT 0,
      consent_requested  INTEGER DEFAULT 0,
      is_admin           INTEGER DEFAULT 0,
      is_instructor      INTEGER DEFAULT 0,
      birth_date         TEXT,
      marketing_consent  INTEGER DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login         DATETIME
    );

    -- Tabela tokenów magic link (jednorazowe, wygasające)
    CREATE TABLE IF NOT EXISTS magic_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      token      TEXT    UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used       INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Tabela zajęć
    -- class_type: 'adult_only' lub 'adult_and_child'
    -- max_spots: limit dorosłych
    -- max_child_spots: limit dzieci (tylko dla 'adult_and_child')
    -- child_instructor: instruktor animacji dla dzieci
    CREATE TABLE IF NOT EXISTS classes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      description      TEXT,
      start_time       DATETIME NOT NULL,
      duration_min     INTEGER DEFAULT 90,
      class_type       TEXT    DEFAULT 'adult_only',
      max_spots        INTEGER NOT NULL,
      max_child_spots  INTEGER DEFAULT 0,
      instructor       TEXT,
      child_instructor TEXT,
      category         TEXT    DEFAULT 'adults',
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_cancelled     INTEGER DEFAULT 0
    );

    -- Tabela rezerwacji (jedna rezerwacja = jeden "zapis" przez użytkownika)
    CREATE TABLE IF NOT EXISTS bookings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id   INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, user_id),
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)  REFERENCES users(id)   ON DELETE CASCADE
    );

    -- Tabela uczestników (booking może zawierać wiele osób)
    -- age_category: 'adult' lub 'child' — do rozliczania pul
    CREATE TABLE IF NOT EXISTS participants (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id   INTEGER NOT NULL,
      first_name   TEXT    NOT NULL,
      last_name    TEXT    NOT NULL,
      age_category TEXT    DEFAULT 'adult',
      is_main      INTEGER DEFAULT 0,
      age          INTEGER,
      child_age    INTEGER,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    );

    -- Tabela skanów QR z ulotki
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
  `);

  // ============================================================
  // Migracje — dodaj brakujące kolumny do istniejących tabel
  // ============================================================
  const migrations = [
    // users
    { table: 'users', column: 'age_category',      sql: "ALTER TABLE users ADD COLUMN age_category TEXT DEFAULT NULL" },
    { table: 'users', column: 'is_verified',       sql: "ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0" },
    { table: 'users', column: 'consent_requested', sql: "ALTER TABLE users ADD COLUMN consent_requested INTEGER DEFAULT 0" },
    { table: 'users', column: 'is_instructor',     sql: "ALTER TABLE users ADD COLUMN is_instructor INTEGER DEFAULT 0" },
    { table: 'users', column: 'birth_date',        sql: "ALTER TABLE users ADD COLUMN birth_date TEXT" },
    { table: 'users', column: 'marketing_consent', sql: "ALTER TABLE users ADD COLUMN marketing_consent INTEGER DEFAULT 0" },
    // classes
    { table: 'classes', column: 'class_type',       sql: "ALTER TABLE classes ADD COLUMN class_type TEXT DEFAULT 'adult_only'" },
    { table: 'classes', column: 'max_child_spots',  sql: "ALTER TABLE classes ADD COLUMN max_child_spots INTEGER DEFAULT 0" },
    { table: 'classes', column: 'child_instructor', sql: "ALTER TABLE classes ADD COLUMN child_instructor TEXT" },
    // participants
    { table: 'participants', column: 'age_category', sql: "ALTER TABLE participants ADD COLUMN age_category TEXT DEFAULT 'adult'" },
    { table: 'participants', column: 'child_age', sql: 'ALTER TABLE participants ADD COLUMN child_age INTEGER' },
    { table: 'participants', column: 'age', sql: 'ALTER TABLE participants ADD COLUMN age INTEGER' },
    // classes
    { table: 'classes', column: 'color', sql: "ALTER TABLE classes ADD COLUMN color TEXT DEFAULT '#6366f1'" },
    { table: 'classes', column: 'is_archived', sql: "ALTER TABLE classes ADD COLUMN is_archived INTEGER DEFAULT 0" },
  ];

  for (const m of migrations) {
    try {
      const cols = db.pragma(`table_info(${m.table})`);
      const exists = cols.some(c => c.name === m.column);
      if (!exists) {
        db.exec(m.sql);
        console.log(`  ↳ Migracja: dodano ${m.table}.${m.column}`);
      }
    } catch (e) {
      // Kolumna już istnieje lub inna sytuacja — ignoruj
    }
  }



  console.log('✅ Baza danych SQLite zainicjalizowana:', DB_PATH);

  // Automatycznie zarchiwizuj zajęcia z poprzednich tygodni przy starcie
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const tzOff = monday.getTimezoneOffset() * 60000;
  const mondayStr = new Date(monday.getTime() - tzOff).toISOString().slice(0, 19).replace('T', ' ');

  const archived = db.prepare(
    "UPDATE classes SET is_archived = 1 WHERE start_time < ? AND is_archived = 0"
  ).run(mondayStr);
  
  if (archived.changes > 0) {
    console.log(`  ↳ Czyszczenie: zarchiwizowano automatycznie ${archived.changes} zajęć z poprzednich tygodni.`);
  }

  return db;
}

function getDb() {
  if (!db) throw new Error('Baza danych nie została zainicjalizowana');
  return db;
}

// ============================================================
// MODELE — czyste funkcje operujące na bazie
// ============================================================

const UserModel = {
  findByEmail: (email) =>
    getDb().prepare('SELECT * FROM users WHERE email = ?').get(email),

  findById: (id) =>
    getDb().prepare('SELECT * FROM users WHERE id = ?').get(id),

  create: (email, firstName, lastName) =>
    getDb().prepare(
      'INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)'
    ).run(email, firstName, lastName),

  updateProfile: (id, firstName, lastName, ageCategory, birthDate, marketingConsent) => {
    // Użytkownicy pełnoletni (>= 18) są automatycznie zweryfikowani, młodsi potrzebują zgody admina
    const age = calculateAge(birthDate);
    const isVerified = (age !== null && age >= 18) ? 1 : 0;
    const marketingVal = marketingConsent ? 1 : 0;
    getDb().prepare(
      'UPDATE users SET first_name = ?, last_name = ?, age_category = ?, birth_date = ?, is_verified = ?, marketing_consent = ? WHERE id = ?'
    ).run(firstName, lastName, ageCategory, birthDate, isVerified, marketingVal, id);
  },

  updateLastLogin: (id) =>
    getDb().prepare(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(id),

  getOrCreate: (email) => {
    const existing = UserModel.findByEmail(email);
    if (existing) return { user: existing, isNew: false };
    const result = UserModel.create(email, null, null);
    return { user: UserModel.findById(result.lastInsertRowid), isNew: true };
  },

  // Zgody rodzicielskie
  requestConsent: (id) =>
    getDb().prepare(
      'UPDATE users SET consent_requested = 1 WHERE id = ?'
    ).run(id),

  approveConsent: (id) =>
    getDb().prepare(
      'UPDATE users SET is_verified = 1, consent_requested = 0 WHERE id = ?'
    ).run(id),

  rejectConsent: (id) =>
    getDb().prepare(
      'UPDATE users SET consent_requested = 0 WHERE id = ?'
    ).run(id),

  getPendingConsents: () =>
    getDb().prepare(
      "SELECT * FROM users WHERE consent_requested = 1 AND is_verified = 0 ORDER BY created_at DESC"
    ).all(),

  getAllUsers: () =>
    getDb().prepare(
      'SELECT * FROM users WHERE is_admin = 0 ORDER BY created_at DESC'
    ).all(),

  getInstructors: () =>
    getDb().prepare(
      'SELECT * FROM users WHERE is_instructor = 1 ORDER BY first_name ASC'
    ).all()
};

const MagicTokenModel = {
  create: (userId, token, expiresAt) =>
    getDb().prepare(
      'INSERT INTO magic_tokens (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).run(userId, token, expiresAt),

  findValid: (token) =>
    getDb().prepare(`
      SELECT mt.*, u.email, u.first_name, u.last_name
      FROM magic_tokens mt
      JOIN users u ON mt.user_id = u.id
      WHERE mt.token = ? AND mt.used = 0 AND mt.expires_at > CURRENT_TIMESTAMP
    `).get(token),

  markUsed: (token) =>
    getDb().prepare('UPDATE magic_tokens SET used = 1 WHERE token = ?').run(token),

  cleanExpired: () =>
    getDb().prepare(
      'DELETE FROM magic_tokens WHERE expires_at < CURRENT_TIMESTAMP OR used = 1'
    ).run()
};

const ClassModel = {
  getAll: () =>
    getDb().prepare(`
      SELECT c.*,
        (SELECT COUNT(DISTINCT b.id) FROM bookings b WHERE b.class_id = c.id) as booking_count,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b2 ON p.booking_id = b2.id
          WHERE b2.class_id = c.id AND p.age_category = 'adult') as adult_taken,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b2 ON p.booking_id = b2.id
          WHERE b2.class_id = c.id AND p.age_category = 'child') as child_taken
      FROM classes c
      WHERE c.is_archived = 0
      ORDER BY c.start_time ASC
    `).all(),

  getArchived: () =>
    getDb().prepare(`
      SELECT c.*,
        (SELECT COUNT(DISTINCT b.id) FROM bookings b WHERE b.class_id = c.id) as booking_count,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b2 ON p.booking_id = b2.id
          WHERE b2.class_id = c.id AND p.age_category = 'adult') as adult_taken,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b2 ON p.booking_id = b2.id
          WHERE b2.class_id = c.id AND p.age_category = 'child') as child_taken
      FROM classes c
      WHERE c.is_archived = 1
      ORDER BY c.start_time DESC
    `).all(),

  getUpcoming: () =>
    getDb().prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'adult') as adult_taken,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'child') as child_taken
      FROM classes c
      WHERE c.start_time > CURRENT_TIMESTAMP AND c.is_cancelled = 0 AND c.is_archived = 0
      ORDER BY c.start_time ASC
    `).all(),

  getById: (id) =>
    getDb().prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'adult') as adult_taken,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'child') as child_taken
      FROM classes c WHERE c.id = ?
    `).get(id),

  create: (data) =>
    getDb().prepare(`
      INSERT INTO classes (name, description, start_time, duration_min, class_type, max_spots, max_child_spots, instructor, child_instructor, category, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.name, data.description, data.startTime, data.durationMin || 90,
           data.classType || 'adult_only', data.maxSpots, data.maxChildSpots || 0,
           data.instructor, data.childInstructor || '', data.category || 'adults',
           data.color || '#6366f1'),

  update: (id, data) =>
    getDb().prepare(`
      UPDATE classes SET name=?, description=?, start_time=?, duration_min=?,
        class_type=?, max_spots=?, max_child_spots=?, instructor=?, child_instructor=?, category=?, color=? WHERE id=?
    `).run(data.name, data.description, data.startTime, data.durationMin,
           data.classType, data.maxSpots, data.maxChildSpots || 0,
           data.instructor, data.childInstructor || '', data.category,
           data.color || '#6366f1', id),

  cancel: (id) =>
    getDb().prepare('UPDATE classes SET is_cancelled = 1 WHERE id = ?').run(id),

  uncancel: (id) =>
    getDb().prepare('UPDATE classes SET is_cancelled = 0 WHERE id = ?').run(id),

  archive: (id) =>
    getDb().prepare('UPDATE classes SET is_archived = 1 WHERE id = ?').run(id),

  restore: (id) =>
    getDb().prepare('UPDATE classes SET is_archived = 0 WHERE id = ?').run(id),

  hardDelete: (id) =>
    getDb().prepare('DELETE FROM classes WHERE id = ?').run(id),

  archivePastWeek: () => {
    const now = new Date();
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    const tzOff = monday.getTimezoneOffset() * 60000;
    const mondayStr = new Date(monday.getTime() - tzOff).toISOString().slice(0, 19).replace('T', ' ');

    const result = getDb().prepare(
      "UPDATE classes SET is_archived = 1 WHERE start_time < ? AND is_archived = 0"
    ).run(mondayStr);
    
    if (result.changes > 0) {
      console.log(`  ↳ Automatyczne archiwizowanie: przeniesiono ${result.changes} zajęć ze starszych tygodni.`);
    }
    return result.changes;
  },

  getByWeek: (weekStart, weekEnd) =>
    getDb().prepare(`
      SELECT * FROM classes
      WHERE datetime(start_time) >= datetime(?) AND datetime(start_time) < datetime(?) AND is_cancelled = 0 AND is_archived = 0
      ORDER BY datetime(start_time) ASC
    `).all(weekStart, weekEnd),

  existsByNameAndTime: (name, startTime) =>
    !!getDb().prepare(
      'SELECT 1 FROM classes WHERE name = ? AND start_time = ?'
    ).get(name, startTime),

  getByInstructorText: (text) =>
    getDb().prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'adult') as adult_taken,
        (SELECT COUNT(*) FROM participants p
          JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = c.id AND p.age_category = 'child') as child_taken
      FROM classes c
      WHERE instructor LIKE ? OR child_instructor LIKE ?
      ORDER BY start_time DESC
    `).all('%' + text + '%', '%' + text + '%')
};

const BookingModel = {
  findByUserAndClass: (userId, classId) =>
    getDb().prepare(
      'SELECT * FROM bookings WHERE user_id = ? AND class_id = ?'
    ).get(userId, classId),

  getSpotCounts: (classId) => {
    const row = getDb().prepare(`
      SELECT
        COALESCE((SELECT COUNT(*) FROM participants p JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = ? AND p.age_category = 'adult'), 0) as adult_taken,
        COALESCE((SELECT COUNT(*) FROM participants p JOIN bookings b ON p.booking_id = b.id
          WHERE b.class_id = ? AND p.age_category = 'child'), 0) as child_taken
    `).get(classId, classId);
    return row || { adult_taken: 0, child_taken: 0 };
  },

  createWithParticipants: (userId, classId, participants) => {
    const insert = getDb().transaction(() => {
      const booking = getDb().prepare(
        'INSERT INTO bookings (class_id, user_id) VALUES (?, ?)'
      ).run(classId, userId);

      const bookingId = booking.lastInsertRowid;

      const insertParticipant = getDb().prepare(
        'INSERT INTO participants (booking_id, first_name, last_name, age_category, is_main, child_age, age) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      for (let i = 0; i < participants.length; i++) {
        const ag = participants[i].age;
        // Age can be a number (from calculated birth_date) or a string (from booking form)
        let ageVal = null;
        if (ag !== undefined && ag !== null && String(ag).trim() !== '') {
          ageVal = parseInt(String(ag).trim(), 10);
          if (isNaN(ageVal)) ageVal = null;
        }

        insertParticipant.run(
          bookingId,
          participants[i].firstName,
          participants[i].lastName,
          participants[i].ageCategory || 'adult',
          participants[i].isMain ? 1 : 0,
          ageVal, // child_age
          ageVal  // age
        );
      }

      return bookingId;
    });
    return insert();
  },

  getByClass: (classId) =>
    getDb().prepare(`
      SELECT b.id as booking_id, b.created_at, u.email, u.first_name as user_first, u.last_name as user_last
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      WHERE b.class_id = ?
      ORDER BY b.created_at ASC
    `).all(classId),

  getParticipantsByBooking: (bookingId) =>
    getDb().prepare(
      'SELECT * FROM participants WHERE booking_id = ? ORDER BY is_main DESC'
    ).all(bookingId),

  cancelByUser: (userId, classId) =>
    getDb().prepare(
      'DELETE FROM bookings WHERE user_id = ? AND class_id = ?'
    ).run(userId, classId),

  getUserBookings: (userId) =>
    getDb().prepare(`
      SELECT b.*, c.name, c.start_time, c.duration_min, c.instructor, c.category, c.class_type, c.child_instructor
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      WHERE b.user_id = ?
      ORDER BY c.start_time ASC
    `).all(userId),

  getParticipantWithContext: (participantId) =>
    getDb().prepare(`
      SELECT p.*, b.id as booking_id, b.user_id, b.class_id,
             u.email as booker_email, u.first_name as booker_first, u.last_name as booker_last
      FROM participants p
      JOIN bookings b ON p.booking_id = b.id
      JOIN users u ON b.user_id = u.id
      WHERE p.id = ?
    `).get(participantId),

  removeParticipant: (participantId) =>
    getDb().prepare('DELETE FROM participants WHERE id = ?').run(participantId),

  countParticipantsByBooking: (bookingId) =>
    getDb().prepare('SELECT COUNT(*) as cnt FROM participants WHERE booking_id = ?').get(bookingId).cnt,

  deleteBooking: (bookingId) =>
    getDb().prepare('DELETE FROM bookings WHERE id = ?').run(bookingId)
};

const QrScanModel = {
  record: (ip, userAgent) =>
    getDb().prepare(
      'INSERT INTO qr_scans (ip, user_agent) VALUES (?, ?)'
    ).run(ip || '', userAgent || ''),

  getCount: () =>
    getDb().prepare('SELECT COUNT(*) as cnt FROM qr_scans').get().cnt
};

module.exports = { initDatabase, getDb, UserModel, MagicTokenModel, ClassModel, BookingModel, QrScanModel };
