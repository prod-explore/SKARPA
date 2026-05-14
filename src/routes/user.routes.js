/**
 * user.routes.js — Endpointy użytkownika: dashboard, kalendarz, zapisy
 * v2 — Podwójne pule miejsc (adult/child), zgody rodzicielskie
 */

const express = require('express');
const router = express.Router();

const { ClassModel, BookingModel, UserModel } = require('../models/database');
const { requireAuth, requireProfile } = require('../middleware/auth');
const { sendMagicLink } = require('../services/emailService');
const { apiLimiter } = require('../middleware/security');

/** Wiek dziecka przy zapisie (7–17 lat), wymagany dla każdego uczestnika z kategorią „dziecko”. */
function parseChildAge(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: false, error: 'Podaj wiek dziecka (w latach).' };
  }
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n) || n < 7 || n > 17) {
    return { ok: false, error: 'Wiek dziecka musi być liczbą całkowitą od 7 do 17 lat.' };
  }
  return { ok: true, value: n };
}

/**
 * Czy można się zapisać na zajęcia względem czasu (bez okna „X dni przed”).
 * Nadchodzące terminy z kalendarza są zawsze dostępne do zapisu, dopóki nie zabraknie miejsc.
 */
function isBookingOpen(startTime) {
  const classDate = new Date(startTime);
  return classDate > new Date();
}

/** Oblicza dynamiczny zakres godzin siatki ±1h od skrajnych zajęć w tygodniu. */
function computeGridHours(weekClasses) {
  if (!weekClasses || !weekClasses.length) return { START_HOUR: 8, END_HOUR: 21, SLOT_MIN: 30 };
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
    END_HOUR:   Math.min(23, maxH + 1),
    SLOT_MIN:   30
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

// ============================================================
// GET / — Landing page (publiczny)
// ============================================================
router.get('/', (req, res) => {
  const { weekStart, weekEnd } = getWeekBounds(0);

  const allClasses = ClassModel.getUpcoming();
  const weekClasses = allClasses
    .filter(c => { const st = new Date(c.start_time); return st >= weekStart && st <= weekEnd; })
    .map(c => ({ ...c, adult_taken: c.adult_taken || 0, child_taken: c.child_taken || 0 }));

  const { START_HOUR, END_HOUR, SLOT_MIN } = computeGridHours(weekClasses);

  res.render('user/index', {
    title: 'Panel Uczestnika — Skarpa Bytom',
    weekClasses, weekStart, weekEnd, weekOffset: 0,
    START_HOUR, END_HOUR, SLOT_MIN,
    user: req.user
  });
});

// ============================================================
// GET /calendar — Publiczny kalendarz zajęć
// ============================================================
router.get('/calendar', (req, res) => {
  const weekOffset = parseInt(req.query.week || '0', 10);
  const { weekStart, weekEnd } = getWeekBounds(weekOffset);

  const allClasses = ClassModel.getUpcoming();
  const weekClasses = allClasses
    .filter(c => { const st = new Date(c.start_time); return st >= weekStart && st <= weekEnd; })
    .map(c => ({ ...c, adult_taken: c.adult_taken || 0, child_taken: c.child_taken || 0 }));

  const { START_HOUR, END_HOUR, SLOT_MIN } = computeGridHours(weekClasses);

  res.render('user/calendar', {
    title: 'Kalendarz zajęć',
    classes: weekClasses,
    weekStart, weekEnd, weekOffset,
    START_HOUR, END_HOUR, SLOT_MIN,
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
  const weekOffset = parseInt(req.query.week || '0', 10);
  const { weekStart, weekEnd } = getWeekBounds(weekOffset);

  const allUpcoming = ClassModel.getUpcoming();
  const userBookings = BookingModel.getUserBookings(req.user.id);
  const bookingsWithParticipants = userBookings.map(b => ({
    ...b,
    participants: BookingModel.getParticipantsByBooking(b.id)
  }));

  // Wszystkie nadchodzące + status dla dashboardu
  const classesWithStatus = allUpcoming.map(c => ({
    ...c,
    adultSpotsLeft: c.max_spots - (c.adult_taken || 0),
    childSpotsLeft: c.class_type === 'adult_and_child' ? (c.max_child_spots - (c.child_taken || 0)) : 0,
    isFull: (c.adult_taken || 0) >= c.max_spots,
    userBooked: userBookings.some(b => b.class_id === c.id)
  }));

  // Obliczamy ramy czasowe na podstawie WSZYSTKICH zajęć w danym tygodniu (żeby siatka wyglądała identycznie jak na głównej)
  const allWeekClasses = allUpcoming.filter(c => {
    const st = new Date(c.start_time);
    return st >= weekStart && st <= weekEnd;
  });
  const { START_HOUR, END_HOUR, SLOT_MIN } = computeGridHours(allWeekClasses);

  // Zajęcia tygodniowe (dostępne) dla kalendarza
  const weekClasses = allUpcoming
    .filter(c => {
      const st = new Date(c.start_time);
      return st >= weekStart && st <= weekEnd && !userBookings.some(b => b.class_id === c.id);
    })
    .map(c => ({ ...c, adult_taken: c.adult_taken || 0, child_taken: c.child_taken || 0 }));

  res.render('user/dashboard', {
    title: 'Mój panel',
    user: req.user,
    classes: classesWithStatus,
    bookings: bookingsWithParticipants,
    weekClasses, weekStart, weekEnd, weekOffset,
    START_HOUR, END_HOUR, SLOT_MIN
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
    return res.redirect('/calendar?error=Te+zajęcia+już+się+odbyły+lub+nie+można+na+nie+zapisać');
  }

  const adultSpotsLeft = classData.max_spots - (classData.adult_taken || 0);
  const childSpotsLeft = (classData.class_type === 'adult_and_child')
    ? (classData.max_child_spots - (classData.child_taken || 0))
    : 0;

  // Sprawdź, czy dla danego typu użytkownika są miejsca
  // Sprawdź, czy dla danego typu użytkownika są miejsca
  if (req.user.age_category === 'child') {
    // Samodzielne zweryfikowane dziecko
    if (classData.class_type !== 'adult_and_child') {
      // Dla zajęć adult_only dziecko (13-17) bierze miejsce z puli dorosłych
      if (adultSpotsLeft <= 0) {
        return res.render('user/book', {
          title: 'Zapis na zajęcia', classData, user: req.user,
          error: 'Brak wolnych miejsc na te zajęcia.', notOpen: false, full: true
        });
      }
    } else {
      // Dla zajęć mixed bierze miejsce z puli dzieci
      if (childSpotsLeft <= 0) {
        return res.render('user/book', {
          title: 'Zapis na zajęcia', classData, user: req.user,
          error: 'Brak wolnych miejsc dla dzieci na te zajęcia.', notOpen: false, full: true
        });
      }
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
    return res.redirect('/calendar?error=Te+zajęcia+nie+są+już+dostępne+do+zapisu');
  }

  // Sprawdź czy już nie zapisany
  const existingBooking = BookingModel.findByUserAndClass(req.user.id, classData.id);
  if (existingBooking) {
    return res.redirect('/dashboard?info=Jesteś+już+zapisany');
  }

  const renderBookError = (errorMsg) => {
    const spots = BookingModel.getSpotCounts(classData.id);
    const adultSpotsLeft = classData.max_spots - spots.adult_taken;
    const childSpotsLeft = classData.class_type === 'adult_and_child'
      ? (classData.max_child_spots - spots.child_taken) : 0;
    return res.render('user/book', {
      title: `Zapis: ${classData.name}`,
      classData,
      user: req.user,
      error: errorMsg,
      notOpen: false,
      full: false,
      adultSpotsLeft,
      childSpotsLeft
    });
  };

  // Oblicz wiek głównego użytkownika
  let mainUserAge = null;
  if (req.user.birth_date) {
    const bd = new Date(req.user.birth_date);
    const today = new Date();
    mainUserAge = today.getFullYear() - bd.getFullYear();
    const m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) {
      mainUserAge--;
    }
  }

  // Zbierz uczestników z podziałem na pule
  const participants = [];

  let mainAgeCategory = req.user.age_category;
  if (classData.class_type === 'adult_only') {
    mainAgeCategory = 'adult'; // Wszyscy w adult_only zajmują miejsce adult
    if (mainUserAge !== null && mainUserAge < 13) {
      return renderBookError('Osoby poniżej 13 roku życia nie mogą brać udziału w tych zajęciach.');
    }
  }

  participants.push({
    firstName: req.user.first_name,
    lastName: req.user.last_name,
    ageCategory: mainAgeCategory,
    isMain: true,
    age: mainUserAge
  });

  const extraFirstNames = [].concat(req.body.extraFirstName || []);
  const extraLastNames = [].concat(req.body.extraLastName || []);
  const extraAges = [].concat(req.body.extraAge || []);

  if (extraFirstNames.length > 4) {
    return renderBookError('Możesz zapisać maksymalnie 4 dodatkowe osoby na raz.');
  }

  for (let i = 0; i < extraFirstNames.length; i++) {
    const fn = extraFirstNames[i]?.trim();
    const ln = extraLastNames[i]?.trim();
    const rawAge = extraAges[i];
    if (fn && ln) {
      if (rawAge === undefined || rawAge === null || String(rawAge).trim() === '') {
        return renderBookError('Podaj wiek (w latach) dla każdej dopisywanej osoby.');
      }
      const ageVal = parseInt(String(rawAge).trim(), 10);
      if (!Number.isInteger(ageVal) || ageVal < 0 || ageVal > 120) {
        return renderBookError('Wiek dopisywanej osoby musi być prawidłową liczbą lat.');
      }

      let ac;
      if (classData.class_type === 'adult_only') {
        if (ageVal < 13) {
          return renderBookError(`Osoba dopisywana (${fn}) jest za młoda na te zajęcia (wymagane min. 13 lat).`);
        }
        ac = 'adult';
      } else {
        ac = ageVal >= 18 ? 'adult' : 'child';
      }

      participants.push({
        firstName: fn,
        lastName: ln,
        ageCategory: ac,
        isMain: false,
        age: ageVal
      });
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
