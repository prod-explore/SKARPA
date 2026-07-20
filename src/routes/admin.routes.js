/**
 * admin.routes.js — Panel administratora
 * Admin loguje się magic linkiem na adres wspinanie.ue@gmail.com
 *
 * v2 — Podwójne limity, zarządzanie zgodami
 */

const express = require('express');
const router = express.Router();
const validator = require('validator');

const { ClassModel, BookingModel, UserModel, MagicTokenModel, QrScanModel, WaitingListModel, getDb } = require('../models/database');
const { requireAdmin, setAuthCookie, createMagicLink } = require('../middleware/auth');
const { adminLoginLimiter } = require('../middleware/security');
const { sendMagicLink, sendParticipantRemovedEmail, sendWaitingListPromotedEmail } = require('../services/emailService');
const { calculateAge } = require('../utils/age');

// ============================================================
// Funkcja pomocnicza: przenieś pierwszą osobę z listy rezerwowej
// na listę główną gdy zwolni się miejsce w puli dorosłych
// ============================================================
async function checkAndPromoteWaitingList(classId) {
  try {
    const classData = ClassModel.getById(classId);
    if (!classData || !classData.waiting_list_enabled) return;

    const spots = BookingModel.getSpotCounts(classId);
    const adultSpotsLeft = classData.max_spots - spots.adult_taken;
    if (adultSpotsLeft <= 0) return; // Nadal brak miejsc

    const first = WaitingListModel.getFirst(classId);
    if (!first) return; // Lista rezerwowa pusta

    // Przenieś na listę główną (tylko jako sam uczestnik-dorosły)
    BookingModel.createWithParticipants(first.user_id, classId, [{
      firstName:   first.first_name,
      lastName:    first.last_name,
      ageCategory: 'adult',
      isMain:      true,
      age:         null
    }]);

    WaitingListModel.remove(first.user_id, classId);

    // Wyślij powiadomienie e-mail
    const classDate = new Date(classData.start_time).toLocaleDateString('pl-PL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const dashboardLink = `${process.env.APP_URL || 'https://skarpabytom.pl'}/dashboard`;
    await sendWaitingListPromotedEmail(first.email, first.first_name, classData.name, classDate, dashboardLink);
    console.log(`✅ Przeniesiono ${first.email} z listy rezerwowej na główną (klasa ${classId})`);
  } catch (err) {
    console.error('Błąd checkAndPromoteWaitingList:', err);
    // Nie przerywamy — to operacja tła
  }
}

const envAdmins = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'explore.wrld.rld@gmail.com,wspinanie.ue@gmail.com';
const ADMIN_EMAILS = envAdmins.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// Upewnij się, że konto admina istnieje i ma flagę is_admin=1
function ensureAdminAccount(rawEmail) {
  const email = validator.normalizeEmail(rawEmail) || rawEmail.toLowerCase();
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

// Inicjalizuj konta instruktorów
function ensureInstructorAccount(rawEmail, firstName) {
  const email = validator.normalizeEmail(rawEmail) || rawEmail.toLowerCase();
  let instructorUser = UserModel.findByEmail(email);
  if (!instructorUser) {
    UserModel.create(email, firstName, 'Instruktor');
    instructorUser = UserModel.findByEmail(email);
  }
  if (!instructorUser.is_instructor || instructorUser.first_name !== firstName) {
    getDb().prepare('UPDATE users SET is_instructor = 1, is_verified = 1, age_category = ?, first_name = ? WHERE id = ?')
      .run('adult', firstName, instructorUser.id);
  }
}

// Utwórz instruktorów (wymagane z zadania)
ensureInstructorAccount('yeeelki@gmail.com', 'Margo');
ensureInstructorAccount('justx2000@gmail.com', 'Mikołaj');
ensureInstructorAccount('jakub.knobloch.kontakt@gmail.com', 'Kuba');
ensureInstructorAccount('drzela.sob@gmail.com', 'Angela');
ensureInstructorAccount('julia.korczewska@wp.pl', 'Julia');

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
  const qrScans = QrScanModel.getCount();

  res.render('admin/dashboard', {
    title: 'Panel Administracyjny',
    classes,
    stats: { totalClasses, totalParticipants, upcomingCount, qrScans },
    pendingConsents,
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// ============================================================
// GET /admin/calendar — Kalendarz tygodniowy (widok admina)
// ============================================================

/** Oblicza dynamiczny zakres godzin siatki ±1h od skrajnych zajęć w tygodniu. */
function computeGridHours(weekClasses) {
  if (!weekClasses || !weekClasses.length) return { START_HOUR: 8, END_HOUR: 21 };
  let minH = 23, maxH = 0;
  weekClasses.forEach(c => {
    const st = new Date(c.start_time);
    const etMin = st.getHours() * 60 + st.getMinutes() + (c.duration_min || 60);
    const etH = Math.ceil(etMin / 60);
    if (st.getHours() < minH) minH = st.getHours();
    if (etH > maxH) maxH = etH;
  });
  return {
    START_HOUR: Math.max(6, minH - 1),
    END_HOUR:   Math.min(23, maxH + 1)
  };
}

/** Oblicza weekStart i weekEnd dla danego weekOffset (pon=0). */
function getWeekBounds(weekOffset) {
  const today = new Date();
  const dow = (today.getDay() + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - dow + (weekOffset || 0) * 7);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}

router.get('/admin/calendar', requireAdmin, (req, res) => {
  let weekOffset = parseInt(req.query.week || '0', 10);
  if (isNaN(weekOffset)) weekOffset = 0;
  weekOffset = Math.max(-52, Math.min(52, weekOffset));
  const { weekStart, weekEnd } = getWeekBounds(weekOffset);
  const pendingConsents = UserModel.getPendingConsents().length;

  const allClasses = ClassModel.getAll();
  const weekClasses = allClasses
    .filter(c => {
      const st = new Date(c.start_time);
      return st >= weekStart && st <= weekEnd;
    })
    .map(c => ({ ...c, adult_taken: c.adult_taken || 0, child_taken: c.child_taken || 0 }));

  const { START_HOUR, END_HOUR } = computeGridHours(weekClasses);

  res.render('admin/calendar', {
    title: 'Kalendarz — Admin',
    classes: weekClasses,
    weekStart, weekEnd, weekOffset,
    START_HOUR, END_HOUR,
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
  const instructors = UserModel.getInstructors();
  res.render('admin/class-form', { title: 'Nowe zajęcia', classData: null, user: req.user, error: null, instructors });
});

// ============================================================
// POST /admin/classes — Utwórz
// ============================================================
router.post('/admin/classes', requireAdmin, (req, res) => {
  const { name, description, startTime, endTime, classType, maxSpots, maxChildSpots, instructor, childInstructor, color, waitingListEnabled } = req.body;

  const instructors = UserModel.getInstructors();
  const renderErr = (msg) => res.render('admin/class-form', {
    title: 'Nowe zajęcia', classData: req.body, user: req.user, error: msg, instructors
  });

  // Nazwa
  const nameTrimmed = String(name || '').trim().slice(0, 120);
  if (!nameTrimmed) return renderErr('Wymagana: nazwa zajęć.');

  // Daty
  const startDate = new Date(startTime);
  const endDate   = new Date(endTime);
  if (!startTime || isNaN(startDate.getTime())) return renderErr('Nieprawidłowa data/godzina startu.');
  if (endTime && isNaN(endDate.getTime()))       return renderErr('Nieprawidłowa data/godzina końca.');
  if (endTime && endDate <= startDate)            return renderErr('Czas końca musi być po czasie startu.');
  const durationMin = endTime ? Math.round((endDate - startDate) / 60000) : 90;
  if (durationMin < 15 || durationMin > 480)     return renderErr('Czas trwania musi wynosić 15 min – 8 godzin.');

  // Liczba miejsc
  const maxSpotsVal = parseInt(maxSpots, 10);
  if (!Number.isInteger(maxSpotsVal) || maxSpotsVal < 1 || maxSpotsVal > 200)
    return renderErr('Maks. uczestników: wartość od 1 do 200.');

  const ct = classType || 'adult_only';
  const maxChildVal = ct === 'adult_and_child' ? (parseInt(maxChildSpots, 10) || 0) : 0;
  if (ct === 'adult_and_child' && (maxChildVal < 1 || maxChildVal > 200))
    return renderErr('Maks. dzieci: wartość od 1 do 200.');

  // Kolor
  const colorVal = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1';

  ClassModel.create({
    name: nameTrimmed,
    description: String(description || '').trim().slice(0, 1000),
    startTime,
    durationMin,
    classType: ct,
    maxSpots: maxSpotsVal,
    maxChildSpots: maxChildVal,
    instructor: String(instructor || '').trim().slice(0, 80),
    childInstructor: ct === 'adult_and_child' ? String(childInstructor || '').trim().slice(0, 80) : '',
    category: ct === 'adult_and_child' ? 'mixed' : 'adults',
    color: colorVal,
    waitingListEnabled: !!waitingListEnabled,
    maxWaitingSpots: 15
  });

  return res.redirect('/admin?success=Zajęcia+dodane+pomyślnie');
});

// ============================================================
// GET /admin/classes/:id/edit
// ============================================================
router.get('/admin/classes/:id/edit', requireAdmin, (req, res) => {
  const classData = ClassModel.getById(req.params.id);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');
  const instructors = UserModel.getInstructors();
  res.render('admin/class-form', { title: `Edytuj: ${classData.name}`, classData, user: req.user, error: null, instructors });
});

// ============================================================
// POST /admin/classes/:id — Aktualizuj
// ============================================================
router.post('/admin/classes/:id', requireAdmin, (req, res) => {
  const { name, description, startTime, endTime, classType, maxSpots, maxChildSpots, instructor, childInstructor, color, waitingListEnabled } = req.body;
  const classId = parseInt(req.params.id, 10);
  if (!Number.isInteger(classId) || classId < 1) return res.redirect('/admin?error=Nieprawidłowe+ID+zajęć');
  const classData = ClassModel.getById(classId);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');
  const instructors = UserModel.getInstructors();

  const renderErr = (msg) => res.render('admin/class-form', {
    title: `Edytuj: ${classData.name}`, classData: { ...classData, ...req.body }, user: req.user, error: msg, instructors
  });

  // Nazwa
  const nameTrimmed = String(name || '').trim().slice(0, 120) || classData.name;

  // Daty
  const effectiveStart = startTime || classData.start_time;
  const startDate = new Date(effectiveStart);
  if (isNaN(startDate.getTime())) return renderErr('Nieprawidłowa data/godzina startu.');

  let newDurationMin = classData.duration_min;
  if (endTime) {
    const endDate = new Date(endTime);
    if (isNaN(endDate.getTime()))  return renderErr('Nieprawidłowa data/godzina końca.');
    if (endDate <= startDate)      return renderErr('Czas końca musi być po czasie startu.');
    newDurationMin = Math.round((endDate - startDate) / 60000);
    if (newDurationMin < 15 || newDurationMin > 480) return renderErr('Czas trwania musi wynosić 15 min – 8 godzin.');
  }

  // Liczba miejsc
  const maxSpotsRaw = parseInt(maxSpots, 10);
  const maxSpotsVal = (Number.isInteger(maxSpotsRaw) && maxSpotsRaw >= 1 && maxSpotsRaw <= 200)
    ? maxSpotsRaw : classData.max_spots;
  if (!Number.isInteger(maxSpotsRaw) || maxSpotsRaw < 1 || maxSpotsRaw > 200)
    return renderErr('Maks. uczestników: wartość od 1 do 200.');

  const ct = classType || classData.class_type;
  const maxChildRaw = parseInt(maxChildSpots, 10);
  const maxChildVal = ct === 'adult_and_child'
    ? (Number.isInteger(maxChildRaw) && maxChildRaw >= 1 && maxChildRaw <= 200 ? maxChildRaw : (classData.max_child_spots || 0))
    : 0;
  if (ct === 'adult_and_child' && (maxChildVal < 1 || maxChildVal > 200))
    return renderErr('Maks. dzieci: wartość od 1 do 200.');

  // Kolor
  const colorVal = /^#[0-9a-fA-F]{6}$/.test(color) ? color : (classData.color || '#6366f1');

  ClassModel.update(classId, {
    name: nameTrimmed,
    description: String(description || '').trim().slice(0, 1000),
    startTime: effectiveStart,
    durationMin: newDurationMin,
    classType: ct,
    maxSpots: maxSpotsVal,
    maxChildSpots: maxChildVal,
    instructor: String(instructor || '').trim().slice(0, 80),
    childInstructor: ct === 'adult_and_child' ? String(childInstructor || '').trim().slice(0, 80) : '',
    category: ct === 'adult_and_child' ? 'mixed' : 'adults',
    color: colorVal,
    waitingListEnabled: !!waitingListEnabled,
    maxWaitingSpots: classData.max_waiting_spots || 15
  });

  return res.redirect('/admin?success=Zajęcia+zaktualizowane');
});

// ============================================================
// POST /admin/classes/:id/cancel
// ============================================================
router.post('/admin/classes/:id/cancel', requireAdmin, (req, res) => {
  const classId = parseInt(req.params.id, 10);
  if (!Number.isInteger(classId) || classId < 1) return res.redirect('/admin?error=Nieprawidłowe+ID');
  ClassModel.cancel(classId);
  res.redirect('/admin?success=Zajęcia+odwołane');
});

// ============================================================
// POST /admin/classes/:id/uncancel
// ============================================================
router.post('/admin/classes/:id/uncancel', requireAdmin, (req, res) => {
  const classId = parseInt(req.params.id, 10);
  if (!Number.isInteger(classId) || classId < 1) return res.redirect('/admin?error=Nieprawidłowe+ID');
  ClassModel.uncancel(classId);
  res.redirect('/admin?success=Zajęcia+przywrócone+z+odwołanych');
});

// ============================================================
// POST /admin/classes/:id/archive
// ============================================================
router.post('/admin/classes/:id/archive', requireAdmin, (req, res) => {
  const classId = parseInt(req.params.id, 10);
  if (!Number.isInteger(classId) || classId < 1) return res.redirect('/admin?error=Nieprawidłowe+ID');
  ClassModel.archive(classId);
  res.redirect('/admin?success=Zajęcia+zarchiwizowane');
});

// ============================================================
// GET /admin/archive
// ============================================================
router.get('/admin/archive', requireAdmin, (req, res) => {
  const classes = ClassModel.getArchived();
  res.render('admin/archive', {
    title: 'Archiwum zajęć',
    classes,
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// ============================================================
// POST /admin/classes/:id/restore
// ============================================================
router.post('/admin/classes/:id/restore', requireAdmin, (req, res) => {
  ClassModel.restore(req.params.id);
  res.redirect('/admin/archive?success=Zajęcia+przywrócone');
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
    classData, bookings: bookingsWithParticipants, allParticipants, user: req.user,
    waitingList: WaitingListModel.getByClass(classData.id),
    waitingCount: WaitingListModel.countByClass(classData.id),
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// ============================================================
// GET /admin/consents — Zarządzanie zgodami
// ============================================================
router.get('/admin/consents', requireAdmin, (req, res) => {
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

// ============================================================
// POST /admin/classes/:classId/participants/:participantId/remove — Usuń uczestnika
// ============================================================
router.post('/admin/classes/:classId/participants/:participantId/remove', requireAdmin, async (req, res) => {
  const { classId, participantId } = req.params;
  const classData = ClassModel.getById(classId);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');

  const participant = BookingModel.getParticipantWithContext(participantId);
  if (!participant || participant.class_id !== parseInt(classId)) {
    return res.redirect(`/admin/classes/${classId}/attendance?error=Nie+znaleziono+uczestnika`);
  }

  const participantName = `${participant.first_name} ${participant.last_name}`;
  const bookerEmail = participant.booker_email;
  const bookingId = participant.booking_id;

  // Usuń uczestnika
  BookingModel.removeParticipant(participantId);

  // Jeśli rezerwacja jest pusta — usuń ją
  const remaining = BookingModel.countParticipantsByBooking(bookingId);
  if (remaining === 0) {
    BookingModel.deleteBooking(bookingId);
  }

  // Wyślij e-mail do osoby zapisującej
  try {
    const date = new Date(classData.start_time);
    const classDateStr = date.toLocaleDateString('pl-PL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    await sendParticipantRemovedEmail(bookerEmail, participantName, classData.name, classDateStr);
  } catch (emailErr) {
    console.error('Błąd wysyłki e-mail o wypisaniu:', emailErr);
    // Nie blokujemy usunięcia, nawet jeśli e-mail nie poszedł
  }

  // Sprawdź i przenieś pierwszą osobę z listy rezerwowej (async, nie blokuje)
  checkAndPromoteWaitingList(classId);

  return res.redirect(`/admin/classes/${classId}/attendance?success=Usunięto+uczestnika:+${encodeURIComponent(participantName)}`);
});

// ============================================================
// POST /admin/clone-week — Klonuj zajęcia bieżącego tygodnia na następny
// ============================================================
router.post('/admin/clone-week', requireAdmin, (req, res) => {
  let weeksAhead = parseInt(req.body.weeksAhead, 10);
  if (!Number.isInteger(weeksAhead) || weeksAhead < 1 || weeksAhead > 52) weeksAhead = 1;
  const daysToAdd = weeksAhead * 7;

  // Oblicz granice bieżącego tygodnia (poniedziałek 00:00 — niedziela 23:59)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=niedziela, 1=poniedziałek...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7); // Następny poniedziałek 00:00

  const tzOffsetStart = weekStart.getTimezoneOffset() * 60000;
  const weekStartStr = (new Date(weekStart.getTime() - tzOffsetStart)).toISOString().slice(0, 16); // YYYY-MM-DDThh:mm

  const tzOffsetEnd = weekEnd.getTimezoneOffset() * 60000;
  const weekEndStr = (new Date(weekEnd.getTime() - tzOffsetEnd)).toISOString().slice(0, 16);

  const thisWeekClasses = ClassModel.getByWeek(weekStartStr, weekEndStr);

  if (thisWeekClasses.length === 0) {
    return res.redirect('/admin?error=Brak+zajęć+w+bieżącym+tygodniu+do+sklonowania');
  }

  let clonedCount = 0;
  for (const c of thisWeekClasses) {
    // Parse start_time and add N days in local time
    const originalStart = new Date(c.start_time);
    originalStart.setDate(originalStart.getDate() + daysToAdd);
    
    // Format back to YYYY-MM-DDThh:mm in local time
    const tzOff = originalStart.getTimezoneOffset() * 60000;
    const newStartLocal = (new Date(originalStart.getTime() - tzOff)).toISOString().slice(0, 16);

    // Sprawdź duplikat
    if (ClassModel.existsByNameAndTime(c.name, newStartLocal)) {
      continue; // Pomiń — już istnieje
    }

    ClassModel.create({
      name: c.name,
      description: c.description || '',
      startTime: newStartLocal,
      durationMin: c.duration_min,
      classType: c.class_type,
      maxSpots: c.max_spots,
      maxChildSpots: c.max_child_spots || 0,
      instructor: c.instructor || '',
      childInstructor: c.child_instructor || '',
      category: c.category || 'adults',
      color: /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : '#6366f1',
      waitingListEnabled: c.waiting_list_enabled || 0,
      maxWaitingSpots: 15
    });
    clonedCount++;
  }

  if (clonedCount === 0) {
    return res.redirect('/admin?info=Wszystkie+zajęcia+z+bieżącego+tygodnia+już+istnieją+w+wybranym+tygodniu');
  }

  const weekText = weeksAhead === 1 ? 'następny tydzień' : `za ${weeksAhead} tygodnie/tygodni`;
  return res.redirect(`/admin?success=Sklonowano+${clonedCount}+zajęć+${encodeURIComponent(weekText)}`);
});

// ============================================================
// GET /admin/classes/:id/waiting-list — Lista rezerwowa dla admina
// ============================================================
router.get('/admin/classes/:id/waiting-list', requireAdmin, (req, res) => {
  const classData = ClassModel.getById(req.params.id);
  if (!classData) return res.redirect('/admin?error=Nie+znaleziono+zajęć');

  const waitingList = WaitingListModel.getByClass(classData.id);
  const waitingCount = waitingList.length;

  res.render('admin/attendance', {
    title: `Lista rezerwowa: ${classData.name}`,
    classData,
    bookings: BookingModel.getByClass(classData.id).map(b => ({
      ...b,
      participants: BookingModel.getParticipantsByBooking(b.booking_id)
    })),
    allParticipants: [],
    waitingList,
    waitingCount,
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

module.exports = router;
