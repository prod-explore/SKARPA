/**
 * app.js — Główny plik aplikacji Express
 * Fantastyczne Wspinanie — System Rejestracji na Zajęcia Wspinaczkowe
 * Projekt dofinansowany z funduszy Unii Europejskiej
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const compression = require('compression');

const { initDatabase, ClassModel } = require('./models/database');
const { initEmailService } = require('./services/emailService');
const { loadUser } = require('./middleware/auth');
const { generalLimiter, helmetConfig, sanitizeBody } = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// Inicjalizacja bazy danych i e-maila
// ============================================================
initDatabase();
initEmailService().catch(err => console.warn('Email init warning:', err.message));

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const adminRoutes = require('./routes/admin.routes');
const instructorRoutes = require('./routes/instructor.routes');

// ============================================================
// Middleware globalny
// ============================================================
app.set('trust proxy', 1);
app.use(helmetConfig);
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(sanitizeBody);
app.use(generalLimiter);

// Pliki statyczne
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0
}));

// ============================================================
// Silnik szablonów EJS
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Zmienne globalne dla wszystkich szablonów
app.use((req, res, next) => {
  res.locals.appName = 'Fantastyczne Wspinanie';
  res.locals.currentYear = new Date().getFullYear();
  next();
});

// ============================================================
// Ładowanie użytkownika z cookie (nie blokuje)
// ============================================================
app.use(loadUser);

// ============================================================
// Routing
// ============================================================
app.use('/', authRoutes);
app.use('/', userRoutes);
app.use('/', adminRoutes);
app.use('/', instructorRoutes);

// ============================================================
// Obsługa błędów 404
// ============================================================
app.use((req, res) => {
  res.status(404).render('user/error', {
    title: '404 — Nie znaleziono',
    code: 404,
    message: 'Strona nie istnieje.',
    user: req.user
  });
});

// ============================================================
// Globalny handler błędów
// ============================================================
app.use((err, req, res, next) => {
  console.error('Błąd aplikacji:', err);

  // Nie ujawniaj szczegółów błędów w produkcji
  const message = process.env.NODE_ENV === 'production'
    ? 'Wystąpił błąd serwera.'
    : err.message;

  res.status(err.status || 500).render('user/error', {
    title: 'Błąd serwera',
    code: err.status || 500,
    message,
    user: req.user
  });
});

// ============================================================
// Uruchomienie automatycznego archiwizowania zajęć w tle
// ============================================================
setInterval(() => {
  try {
    ClassModel.archivePastWeek();
  } catch (err) {
    console.error('Błąd podczas archiwizacji (cron):', err);
  }
}, 1000 * 60 * 60 * 24); // Uruchamiaj co 24 godziny (raz dziennie)

// ============================================================
// Start serwera
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║   Fantastyczne Wspinanie — System Rejestracji    ║
  ║   Projekt dofinansowany z UE                     ║
  ╠══════════════════════════════════════════════════╣
  ║   Adres:  ${(process.env.APP_URL || `http://localhost:${PORT}`).padEnd(33)}║
  ║   Środow: ${(process.env.NODE_ENV || 'development').padEnd(40)}║
  ╚══════════════════════════════════════════════════╝
  `);
});

module.exports = app;
