/**
 * user.routes.js — Endpointy użytkownika: dashboard, kalendarz, zapisy
 * v2 — Podwójne pule miejsc (adult/child), zgody rodzicielskie
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
    title: 'Panel Uczestnika — Skarpa Bytom',
    upcomingClasses,
    user: req.user,
    isBookingOpen,
    getBookingOpenDate
  });
});

// ============================================================
// GET /regulamin — Regulamin serwisu
// ============================================================
router.get('/regulamin', (req, res) => {
  res.render('user/terms', {
    title: 'Regulamin',
    user: req.user
  });
});

// ============================================================
// GET /polityka-prywatnosci — Polityka Prywatności
// ============================================================
router.get('/polityka-prywatnosci', (req, res) => {
  res.render('user/privacy', {
    title: 'Polityka Prywatności',
    user: req.user
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
    adultSpotsLeft: c.max_spots - (c.adult_taken || 0),
    childSpotsLeft: (c.class_type === 'adult_and_child') ? (c.max_child_spots - (c.child_taken || 0)) : 0,
    isFull: (c.adult_taken || 0) >= c.max_spots
  }));

  res.render('user/calendar', {
    title: 'Kalendarz zajęć',
    classes: classesWithStatus,
    user: req.user
  });
});

// ============================================================
// POST /consent/request — Dziecko prosi o weryfikację zgody
// ============================================================
router.post('/consent/request', requireAuth, (req, res) => {
  if (req.user.age_category !== 'child') {
    return res.redirect('/dashboard?error=Ta+akcja+dotyczy+tylko+osób+niepełnoletnich');
  }
  if (req.user.is_verified) {
    return res.redirect('/dashboard?info=Twoje+konto+jest+już+zweryfikowane');
  }
  if (req.user.consent_requested) {
    return res.redirect('/dashboard?info=Prośba+o+weryfikację+została+już+wysłana');
  }

  UserModel.requestConsent(req.user.id);
  res.redirect('/dashboard?success=Prośba+o+weryfikację+zgody+została+wysłana.+Poczekaj+na+zatwierdzenie+przez+administratora.');
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
    adultSpotsLeft: c.max_spots - (c.adult_taken || 0),
    childSpotsLeft: (c.class_type === 'adult_and_child') ? (c.max_child_spots - (c.child_taken || 0)) : 0,
    isFull: (c.adult_taken || 0) >= c.max_spots,
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
  // Niezweryfikowane dziecko nie może rezerwować
  if (req.user.age_category === 'child' && !req.user.is_verified) {
    return res.redirect('/dashboard?error=Twoje+konto+wymaga+weryfikacji+zgody+rodzica+przed+zapisami');
  }

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

  const adultSpotsLeft = classData.max_spots - (classData.adult_taken || 0);
  const childSpotsLeft = (classData.class_type === 'adult_and_child')
    ? (classData.max_child_spots - (classData.child_taken || 0))
    : 0;

  // Sprawdź, czy dla danego typu użytkownika są miejsca
  if (req.user.age_category === 'child') {
    // Samodzielne zweryfikowane dziecko — potrzebuje miejsca w puli child
    if (classData.class_type !== 'adult_and_child') {
      return res.render('user/book', {
        title: 'Zapis na zajęcia', classData, user: req.user,
        error: 'Te zajęcia są przeznaczone tylko dla dorosłych.', notOpen: false, full: true
      });
    }
    if (childSpotsLeft <= 0) {
      return res.render('user/book', {
        title: 'Zapis na zajęcia', classData, user: req.user,
        error: 'Brak wolnych miejsc dla dzieci na te zajęcia.', notOpen: false, full: true
      });
    }
  } else {
    // Dorosły — potrzebuje miejsca w puli adult
    if (adultSpotsLeft <= 0) {
      return res.render('user/book', {
        title: 'Zapis na zajęcia', classData, user: req.user,
        error: 'Brak wolnych miejsc na te zajęcia.', notOpen: false, full: true
      });
    }
  }

  // Sprawdź czy użytkownik już zapisany
  const existingBooking = BookingModel.findByUserAndClass(req.user.id, classData.id);
  if (existingBooking) {
    return res.redirect('/dashboard?info=Jesteś+już+zapisany+na+te+zajęcia');
  }

  res.render('user/book', {
    title: `Zapis: ${classData.name}`,
    classData,
    adultSpotsLeft,
    childSpotsLeft,
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
  // Niezweryfikowane dziecko nie może rezerwować
  if (req.user.age_category === 'child' && !req.user.is_verified) {
    return res.redirect('/dashboard?error=Konto+wymaga+weryfikacji');
  }

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

  // Zbierz uczestników z podziałem na pule
  const participants = [];

  if (req.user.age_category === 'child') {
    // Samodzielne zweryfikowane dziecko — zapisuje tylko siebie w puli child
    participants.push({
      firstName: req.user.first_name,
      lastName: req.user.last_name,
      ageCategory: 'child',
      isMain: true
    });
  } else {
    // Dorosły użytkownik zawsze zapisuje siebie jako opiekuna/uczestnika
    participants.push({
      firstName: req.user.first_name,
      lastName: req.user.last_name,
      ageCategory: 'adult',
      isMain: true
    });

    // Dodatkowe osoby
    const extraFirstNames = [].concat(req.body.extraFirstName || []);
    const extraLastNames = [].concat(req.body.extraLastName || []);
    const extraAgeCategories = [].concat(req.body.extraAgeCategory || []);

    for (let i = 0; i < extraFirstNames.length; i++) {
      const fn = extraFirstNames[i]?.trim();
      const ln = extraLastNames[i]?.trim();
      const ac = extraAgeCategories[i] || 'adult';
      if (fn && ln) {
        participants.push({ firstName: fn, lastName: ln, ageCategory: ac, isMain: false });
      }
    }
  }

  if (participants.length === 0) {
    const adultSpotsLeft = classData.max_spots - (classData.adult_taken || 0);
    const childSpotsLeft = (classData.class_type === 'adult_and_child')
      ? (classData.max_child_spots - (classData.child_taken || 0)) : 0;
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user, error: 'Musisz zapisać co najmniej jedną osobę.',
      notOpen: false, full: false
    });
  }

  // Policz ile miejsc z której puli potrzebujemy
  const adultsNeeded = participants.filter(p => p.ageCategory === 'adult').length;
  const childrenNeeded = participants.filter(p => p.ageCategory === 'child').length;

  // Sprawdź dostępność miejsc (aktualne dane z bazy)
  const spots = BookingModel.getSpotCounts(classData.id);
  const adultSpotsLeft = classData.max_spots - spots.adult_taken;
  const childSpotsLeft = (classData.class_type === 'adult_and_child')
    ? (classData.max_child_spots - spots.child_taken) : 0;

  // Walidacja: dorosły + dzieci
  if (adultsNeeded > adultSpotsLeft) {
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user,
      error: `Niewystarczająca liczba miejsc dla dorosłych. Dostępne: ${adultSpotsLeft}, potrzebujesz: ${adultsNeeded}.`,
      notOpen: false, full: false
    });
  }

  // Walidacja: dzieci możliwe tylko dla adult_and_child
  if (childrenNeeded > 0 && classData.class_type !== 'adult_and_child') {
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user,
      error: 'Te zajęcia nie mają puli miejsc dla dzieci.',
      notOpen: false, full: false
    });
  }

  if (childrenNeeded > childSpotsLeft) {
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user,
      error: `Niewystarczająca liczba miejsc dla dzieci. Dostępne: ${childSpotsLeft}, potrzebujesz: ${childrenNeeded}.`,
      notOpen: false, full: false
    });
  }

  // Kluczowa reguła: dorosły musi być obecny razem z dzieckiem
  // Jeśli dorosły zapisuje dziecko, musi też zapisać siebie (zajmuje miejsce w puli dorosłych)
  if (childrenNeeded > 0 && adultsNeeded === 0 && req.user.age_category === 'adult') {
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user,
      error: 'Aby zapisać dziecko, musisz również zapisać siebie jako dorosłego uczestnika (opiekuna).',
      notOpen: false, full: false
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
    }

    return res.redirect('/dashboard?success=Zapisano+pomyślnie!');
  } catch (err) {
    console.error('Błąd zapisu na zajęcia:', err);
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`, classData,
      adultSpotsLeft, childSpotsLeft,
      user: req.user,
      error: 'Błąd podczas zapisu. Spróbuj ponownie.',
      notOpen: false, full: false
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
