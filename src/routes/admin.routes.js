/**
 * admin.routes.js — Panel administratora
 * Admin loguje się magic linkiem na adres wspinanie.ue@gmail.com
 *
 * v2 — Podwójne limity, zarządzanie zgodami
 */

const express = require('express');
const router = express.Router();
const validator = require('validator');

const { ClassModel, BookingModel, UserModel, MagicTokenModel, getDb } = require('../models/database');
const { requireAdmin, setAuthCookie, createMagicLink } = require('../middleware/auth');
const { adminLoginLimiter } = require('../middleware/security');
const { sendMagicLink } = require('../services/emailService');

const envAdmins = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'explore.wrld.rld@gmail.com,wspinanie.ue@gmail.com';
const ADMIN_EMAILS = envAdmins.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// Upewnij się, że konto admina istnieje i ma flagę is_admin=1
function ensureAdminAccount(email) {
  let adminUser = UserModel.findByEmail(email);
  if (!adminUser) {
    UserModel.create(email, 'Admin', 'Zajęcia');
    adminUser = UserModel.findByEmail(email);
  }
  if (!adminUser.is_admin) {
    getDb().prepare('UPDATE users SET is_admin = 1, is_verified = 1, age_category = ? WHERE id = ?').run('adult', adminUser.id);
    adminUser = UserModel.findById(adminUser.id);
  }
  return adminUser;
}

// Inicjalizuj wszystkie konta administratorów z listy
ADMIN_EMAILS.forEach(ensureAdminAccount);

// ============================================================
// GET /admin/login
// ============================================================
router.get('/admin/login', (req, res) => {
  if (req.user?.is_admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Panel Admina — Logowanie', error: null, success: null });
});

// ============================================================
// POST /admin/login — Wyślij magic link na adres admina
// ============================================================
router.post('/admin/login', adminLoginLimiter, async (req, res) => {
  const { email, website } = req.body;

  // Honeypot check
  if (website) {
    console.warn(`[HONEYPOT] Bot detected from ${req.ip} in admin login form`);
    return res.render('admin/login', {
      title: 'Panel Admina — Logowanie',
      error: null,
      success: `Link logowania wysłany na podany adres. Sprawdź skrzynkę!`
    });
  }

  const normalizedEmail = email ? validator.normalizeEmail(email) : '';
  const isValidAdmin = ADMIN_EMAILS.some(e => validator.normalizeEmail(e) === normalizedEmail);

  // Weryfikuj że to właściwy adres admina
  if (!email || !isValidAdmin) {
    return res.render('admin/login', {
      title: 'Panel Admina — Logowanie',
      error: `Podany adres nie jest adresem administratora.`,
      success: null
    });
  }

  try {
    const adminUser = ensureAdminAccount(normalizedEmail);
    MagicTokenModel.cleanExpired();
    const { magicLink } = createMagicLink(adminUser.id);
    await sendMagicLink(normalizedEmail, magicLink, false);

    return res.render('admin/login', {
      title: 'Panel Admina — Logowanie',
      error: null,
      success: `Link logowania wysłany na podany adres. Sprawdź skrzynkę!`
    });
  } catch (err) {
    console.error('Błąd wysyłki magic link (admin):', err);
    return res.render('admin/login', {
      title: 'Panel Admina — Logowanie',
      error: 'Nie udało się wysłać e-maila. Sprawdź konfigurację RESEND_API_KEY.',
      success: null
    });
  }
});

// ============================================================
// GET /admin — Dashboard
// ============================================================
router.get('/admin', requireAdmin, (req, res) => {
  const classes = ClassModel.getAll();
  const totalClasses = classes.length;
  const totalParticipants = classes.reduce((s, c) => s + (c.adult_taken || 0) + (c.child_taken || 0), 0);
  const upcomingCount = classes.filter(c => new Date(c.start_time) > new Date() && !c.is_cancelled).length;
  const pendingConsents = UserModel.getPendingConsents().length;

  res.render('admin/dashboard', {
    title: 'Panel Administracyjny',
    classes,
    stats: { totalClasses, totalParticipants, upcomingCount },
    pendingConsents,
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// ============================================================
// GET /admin/classes/new
// ============================================================
router.get('/admin/classes/new', requireAdmin, (req, res) => {
  res.render('admin/class-form', { title: 'Nowe zajęcia', classData: null, user: req.user, error: null });
});

// ============================================================
// POST /admin/classes — Utwórz
// ============================================================
router.post('/admin/classes', requireAdmin, (req, res) => {
  const { name, description, startTime, endTime, classType, maxSpots, maxChildSpots, instructor, childInstructor, color } = req.body;

  if (!name?.trim() || !startTime || !maxSpots) {
    return res.render('admin/class-form', {
      title: 'Nowe zajęcia', classData: req.body, user: req.user,
      error: 'Wymagane: nazwa, data/godzina, max. liczba osób.'
    });
  }

  const durationMin = endTime && startTime ? Math.max(30, Math.round((new Date(endTime) - new Date(startTime)) / 60000)) : 90;

  ClassModel.create({
    name: name.trim(), description: description?.trim() || '',
    startTime, durationMin,
    classType: classType || 'adult_only',
    maxSpots: parseInt(maxSpots),
    maxChildSpots: classType === 'adult_and_child' ? (parseInt(maxChildSpots) || 0) : 0,
    instructor: instructor?.trim() || '',
    childInstructor: classType === 'adult_and_child' ? (childInstructor?.trim() || '') : '',
    category: classType === 'adult_and_child' ? 'mixed' : 'adults',
    color: color || '#6366f1'
  });

  return res.redirect('/admin?success=Zajęcia+dodane+pomyślnie');
});

// ============================================================
// GET /admin/classes/:id/edit
// ============================================================
router.get('/admin/classes/:id/edit', requireAdmin, (req, res) => {
  const classData = ClassModel.getById(req.params.id);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');
  res.render('admin/class-form', { title: `Edytuj: ${classData.name}`, classData, user: req.user, error: null });
});

// ============================================================
// POST /admin/classes/:id — Aktualizuj
// ============================================================
router.post('/admin/classes/:id', requireAdmin, (req, res) => {
  const { name, description, startTime, endTime, classType, maxSpots, maxChildSpots, instructor, childInstructor, color } = req.body;
  const classData = ClassModel.getById(req.params.id);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');

  const ct = classType || classData.class_type;
  const newDurationMin = endTime && startTime ? Math.max(30, Math.round((new Date(endTime) - new Date(startTime)) / 60000)) : classData.duration_min;

  ClassModel.update(req.params.id, {
    name: name?.trim() || classData.name,
    description: description?.trim() || '',
    startTime: startTime || classData.start_time,
    durationMin: newDurationMin,
    classType: ct,
    maxSpots: parseInt(maxSpots) || classData.max_spots,
    maxChildSpots: ct === 'adult_and_child' ? (parseInt(maxChildSpots) || 0) : 0,
    instructor: instructor?.trim() || '',
    childInstructor: ct === 'adult_and_child' ? (childInstructor?.trim() || '') : '',
    category: ct === 'adult_and_child' ? 'mixed' : 'adults',
    color: color || classData.color || '#6366f1'
  });

  return res.redirect('/admin?success=Zajęcia+zaktualizowane');
});

// ============================================================
// POST /admin/classes/:id/cancel
// ============================================================
router.post('/admin/classes/:id/cancel', requireAdmin, (req, res) => {
  ClassModel.cancel(req.params.id);
  res.redirect('/admin?success=Zajęcia+odwołane');
});

// ============================================================
// POST /admin/classes/:id/delete
// ============================================================
router.post('/admin/classes/:id/delete', requireAdmin, (req, res) => {
  ClassModel.delete(req.params.id);
  res.redirect('/admin?success=Zajęcia+usunięte');
});

// ============================================================
// GET /admin/classes/:id/attendance
// ============================================================
router.get('/admin/classes/:id/attendance', requireAdmin, (req, res) => {
  const classData = ClassModel.getById(req.params.id);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');

  const bookings = BookingModel.getByClass(classData.id);
  const bookingsWithParticipants = bookings.map(b => ({
    ...b,
    participants: BookingModel.getParticipantsByBooking(b.booking_id)
  }));
  const allParticipants = bookingsWithParticipants.flatMap(b =>
    b.participants.map(p => ({ ...p, bookerEmail: b.email, bookedAt: b.created_at }))
  );

  // Sort: adults ('adult') first, then children ('child')
  allParticipants.sort((a, b) => {
    if (a.age_category !== b.age_category) {
      return a.age_category === 'adult' ? -1 : 1;
    }
    // secondary sort: booking date ascending
    return new Date(a.bookedAt) - new Date(b.bookedAt);
  });

  res.render('admin/attendance', {
    title: `Lista: ${classData.name}`,
    classData, bookings: bookingsWithParticipants, allParticipants, user: req.user
  });
});

// ============================================================
// GET /admin/consents — Zarządzanie zgodami
// ============================================================
router.get('/admin/consents', requireAdmin, (req, res) => {
  const today = new Date();
  
  const calculateAge = (birthDate) => {
    if (!birthDate) return null;
    const bd = new Date(birthDate);
    let age = today.getFullYear() - bd.getFullYear();
    const m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
    return age;
  };

  const pendingUsers = UserModel.getPendingConsents().map(u => ({
    ...u,
    age: calculateAge(u.birth_date)
  }));
  
  const allUsers = UserModel.getAllUsers();
  const verifiedChildren = allUsers
    .filter(u => {
      const age = calculateAge(u.birth_date);
      return age !== null && age < 18 && u.is_verified;
    })
    .map(u => ({
      ...u,
      age: calculateAge(u.birth_date)
    }));

  res.render('admin/consents', {
    title: 'Zarządzanie zgodami',
    pendingUsers,
    verifiedChildren,
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// ============================================================
// POST /admin/consents/:id/approve — Zatwierdź zgodę
// ============================================================
router.post('/admin/consents/:id/approve', requireAdmin, (req, res) => {
  const targetUser = UserModel.findById(req.params.id);
  if (!targetUser) return res.redirect('/admin/consents?error=Nie+znaleziono+użytkownika');

  UserModel.approveConsent(targetUser.id);
  res.redirect('/admin/consents?success=Zgoda+zatwierdzona+dla+' + encodeURIComponent(targetUser.first_name + ' ' + targetUser.last_name));
});

// ============================================================
// POST /admin/consents/:id/reject — Odrzuć zgodę
// ============================================================
router.post('/admin/consents/:id/reject', requireAdmin, (req, res) => {
  const targetUser = UserModel.findById(req.params.id);
  if (!targetUser) return res.redirect('/admin/consents?error=Nie+znaleziono+użytkownika');

  UserModel.rejectConsent(targetUser.id);
  res.redirect('/admin/consents?success=Prośba+odrzucona');
});

module.exports = router;
