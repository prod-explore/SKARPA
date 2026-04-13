/**
 * user.routes.js — Endpointy użytkownika: dashboard, kalendarz, zapisy
 */

const express = require('express');
const router = express.Router();

const { ClassModel, BookingModel, UserModel } = require('../models/database');
const { requireAuth, requireProfile } = require('../middleware/auth');
const { sendBookingConfirmation } = require('../services/emailService');
const { apiLimiter } = require('../middleware/security');

/**
 * Sprawdza, czy zapis na dane zajęcia jest już otwarty
 * (dokładnie 7 dni przed startem)
 */
function isBookingOpen(startTime) {
  const classDate = new Date(startTime);
  const now = new Date();
  const diffMs = classDate - now;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return diffMs > 0 && diffMs <= sevenDaysMs;
}

/**
 * Oblicza kiedy otwierają się zapisy (7 dni przed zajęciami)
 */
function getBookingOpenDate(startTime) {
  const classDate = new Date(startTime);
  return new Date(classDate - 7 * 24 * 60 * 60 * 1000);
}

// ============================================================
// GET / — Landing page (publiczny)
// ============================================================
router.get('/', (req, res) => {
  const upcomingClasses = ClassModel.getUpcoming().slice(0, 6);
  res.render('user/index', {
    title: 'Skarpa Bytom — Darmowe Zajęcia Wspinaczkowe',
    upcomingClasses,
    user: req.user,
    isBookingOpen,
    getBookingOpenDate,
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  });
});

// ============================================================
// GET /calendar — Publiczny kalendarz zajęć
// ============================================================
router.get('/calendar', (req, res) => {
  const classes = ClassModel.getUpcoming();
  const classesWithStatus = classes.map(c => ({
    ...c,
    bookingOpen: isBookingOpen(c.start_time),
    bookingOpenDate: getBookingOpenDate(c.start_time),
    spotsLeft: c.max_spots - (c.taken_spots || 0),
    isFull: (c.taken_spots || 0) >= c.max_spots
  }));

  res.render('user/calendar', {
    title: 'Kalendarz zajęć',
    classes: classesWithStatus,
    user: req.user
  });
});

// ============================================================
// GET /dashboard — Panel użytkownika
// ============================================================
router.get('/dashboard', requireAuth, requireProfile, (req, res) => {
  const upcomingClasses = ClassModel.getUpcoming();
  const userBookings = BookingModel.getUserBookings(req.user.id);

  // Pobierz uczestników dla każdej rezerwacji
  const bookingsWithParticipants = userBookings.map(b => ({
    ...b,
    participants: BookingModel.getParticipantsByBooking(b.id)
  }));

  const classesWithStatus = upcomingClasses.map(c => ({
    ...c,
    bookingOpen: isBookingOpen(c.start_time),
    bookingOpenDate: getBookingOpenDate(c.start_time),
    spotsLeft: c.max_spots - (c.taken_spots || 0),
    isFull: (c.taken_spots || 0) >= c.max_spots,
    userBooked: userBookings.some(b => b.class_id === c.id)
  }));

  res.render('user/dashboard', {
    title: 'Mój panel',
    user: req.user,
    classes: classesWithStatus,
    bookings: bookingsWithParticipants
  });
});

// ============================================================
// GET /book/:classId — Formularz zapisu na zajęcia
// ============================================================
router.get('/book/:classId', requireAuth, requireProfile, (req, res) => {
  const classData = ClassModel.getById(req.params.classId);

  if (!classData) {
    return res.redirect('/calendar?error=Zajęcia+nie+istnieją');
  }

  if (classData.is_cancelled) {
    return res.redirect('/calendar?error=Zajęcia+zostały+odwołane');
  }

  if (!isBookingOpen(classData.start_time)) {
    const openDate = getBookingOpenDate(classData.start_time);
    return res.render('user/book', {
      title: 'Zapis na zajęcia',
      classData,
      user: req.user,
      error: `Zapisy otwierają się ${openDate.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })} o ${openDate.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}.`,
      notOpen: true
    });
  }

  const spotsLeft = classData.max_spots - (classData.taken_spots || 0);
  if (spotsLeft <= 0) {
    return res.render('user/book', {
      title: 'Zapis na zajęcia',
      classData,
      user: req.user,
      error: 'Brak wolnych miejsc na te zajęcia.',
      full: true
    });
  }

  // Sprawdź czy użytkownik już zapisany
  const existingBooking = BookingModel.findByUserAndClass(req.user.id, classData.id);
  if (existingBooking) {
    return res.redirect('/dashboard?info=Jesteś+już+zapisany+na+te+zajęcia');
  }

  res.render('user/book', {
    title: `Zapis: ${classData.name}`,
    classData,
    spotsLeft,
    user: req.user,
    error: null,
    notOpen: false,
    full: false
  });
});

// ============================================================
// POST /book/:classId — Zapis na zajęcia (z uczestnikami)
// ============================================================
router.post('/book/:classId', requireAuth, requireProfile, apiLimiter, async (req, res) => {
  const classData = ClassModel.getById(req.params.classId);

  if (!classData || classData.is_cancelled) {
    return res.redirect('/calendar?error=Nieprawidłowe+zajęcia');
  }

  // Podwójna weryfikacja blokady czasowej (server-side)
  if (!isBookingOpen(classData.start_time)) {
    return res.redirect(`/book/${classData.id}?error=Zapisy+jeszcze+nie+są+otwarte`);
  }

  // Sprawdź czy już nie zapisany
  const existingBooking = BookingModel.findByUserAndClass(req.user.id, classData.id);
  if (existingBooking) {
    return res.redirect('/dashboard?info=Jesteś+już+zapisany');
  }

  // Zbierz uczestników
  const participants = [];

  // Główna osoba (zalogowany użytkownik)
  const includeSelf = req.body.includeSelf !== 'false';
  if (includeSelf) {
    participants.push({
      firstName: req.user.first_name,
      lastName: req.user.last_name
    });
  }

  // Dodatkowe osoby
  const extraFirstNames = [].concat(req.body.extraFirstName || []);
  const extraLastNames = [].concat(req.body.extraLastName || []);

  for (let i = 0; i < extraFirstNames.length; i++) {
    const fn = extraFirstNames[i]?.trim();
    const ln = extraLastNames[i]?.trim();
    if (fn && ln) {
      participants.push({ firstName: fn, lastName: ln });
    }
  }

  if (participants.length === 0) {
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`,
      classData,
      spotsLeft: classData.max_spots - (classData.taken_spots || 0),
      user: req.user,
      error: 'Musisz zapisać co najmniej jedną osobę.',
      notOpen: false,
      full: false
    });
  }

  // Sprawdź dostępność miejsc
  const takenSpots = BookingModel.getParticipantsCount(classData.id);
  const spotsLeft = classData.max_spots - takenSpots;

  if (participants.length > spotsLeft) {
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`,
      classData,
      spotsLeft,
      user: req.user,
      error: `Niewystarczająca liczba miejsc. Dostępne: ${spotsLeft}, próbujesz zapisać: ${participants.length}.`,
      notOpen: false,
      full: false
    });
  }

  try {
    // Utwórz rezerwację z uczestnikami
    BookingModel.createWithParticipants(req.user.id, classData.id, participants);

    // Wyślij e-mail potwierdzenia
    try {
      await sendBookingConfirmation(req.user.email, classData, participants);
    } catch (emailErr) {
      console.warn('Nie udało się wysłać potwierdzenia e-mail:', emailErr.message);
      // Nie przerywaj — zapis jest ważny mimo błędu e-maila
    }

    return res.redirect('/dashboard?success=Zapisano+pomyślnie!');
  } catch (err) {
    console.error('Błąd zapisu na zajęcia:', err);
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`,
      classData,
      spotsLeft,
      user: req.user,
      error: 'Błąd podczas zapisu. Spróbuj ponownie.',
      notOpen: false,
      full: false
    });
  }
});

// ============================================================
// POST /cancel/:classId — Odwołanie zapisu
// ============================================================
router.post('/cancel/:classId', requireAuth, (req, res) => {
  const classData = ClassModel.getById(req.params.classId);

  if (!classData) {
    return res.redirect('/dashboard?error=Zajęcia+nie+istnieją');
  }

  // Nie pozwól odwołać zapisu na < 2 godziny przed
  const classDate = new Date(classData.start_time);
  const hoursLeft = (classDate - new Date()) / (1000 * 60 * 60);
  if (hoursLeft < 2) {
    return res.redirect('/dashboard?error=Nie+można+odwołać+zapisu+na+mniej+niż+2+godziny+przed+zajęciami');
  }

  BookingModel.cancelByUser(req.user.id, classData.id);
  res.redirect('/dashboard?success=Zapis+odwołany');
});

module.exports = router;
