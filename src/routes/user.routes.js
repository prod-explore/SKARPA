/**
 * user.routes.js — Endpointy użytkownika: dashboard, kalendarz, zapisy
 * v2 — Podwójne pule miejsc (adult/child), zgody rodzicielskie
 */

const express = require('express');
const router = express.Router();

const { ClassModel, BookingModel, UserModel, QrScanModel, WaitingListModel } = require('../models/database');
const { requireAuth, requireProfile } = require('../middleware/auth');
const { sendMagicLink, sendWaitingListPromotedEmail } = require('../services/emailService');
const { apiLimiter } = require('../middleware/security');
const { calculateAge } = require('../utils/age');

// ============================================================
// Funkcja pomocnicza: przenieś pierwszą osobę z listy rezerwowej
// (identyczna logika jak w admin.routes.js)
// ============================================================
async function checkAndPromoteWaitingList(classId) {
  try {
    const classData = ClassModel.getById(classId);
    if (!classData || !classData.waiting_list_enabled) return;

    const spots = BookingModel.getSpotCounts(classId);
    const adultSpotsLeft = classData.max_spots - spots.adult_taken;
    if (adultSpotsLeft <= 0) return;

    const first = WaitingListModel.getFirst(classId);
    if (!first) return;

    BookingModel.createWithParticipants(first.user_id, classId, [{
      firstName:   first.first_name,
      lastName:    first.last_name,
      ageCategory: 'adult',
      isMain:      true,
      age:         null
    }]);

    WaitingListModel.remove(first.user_id, classId);

    const classDate = new Date(classData.start_time).toLocaleDateString('pl-PL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const dashboardLink = `${process.env.APP_URL || 'https://skarpabytom.pl'}/dashboard`;
    await sendWaitingListPromotedEmail(first.email, first.first_name, classData.name, classDate, dashboardLink);
    console.log(`✅ Przeniesiono ${first.email} z listy rezerwowej na główną (klasa ${classId})`);
  } catch (err) {
    console.error('Błąd checkAndPromoteWaitingList (user):', err);
  }
}

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
    title: 'Panel Uczestnika — Fantastyczne Wspinanie',
    weekClasses, weekStart, weekEnd, weekOffset: 0,
    START_HOUR, END_HOUR, SLOT_MIN,
    user: req.user
  });
});

// ============================================================
// GET /calendar — Publiczny kalendarz zajęć
// ============================================================
router.get('/calendar', (req, res) => {
  let weekOffset = parseInt(req.query.week || '0', 10);
  if (isNaN(weekOffset)) weekOffset = 0;
  weekOffset = Math.max(-52, Math.min(52, weekOffset));
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
  const age = calculateAge(req.user.birth_date);
  if (age === null || age >= 18) {
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
  let weekOffset = parseInt(req.query.week || '0', 10);
  if (isNaN(weekOffset)) weekOffset = 0;
  weekOffset = Math.max(-52, Math.min(52, weekOffset));
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

  const userAge = calculateAge(req.user.birth_date);
  const isMinor = userAge !== null && userAge < 18;

  // Lista rezerwowa użytkownika
  const waitlistBookings = WaitingListModel.getUserWaitlistBookings(req.user.id);

  res.render('user/dashboard', {
    title: 'Mój panel',
    user: req.user,
    isMinor,
    classes: classesWithStatus,
    bookings: bookingsWithParticipants,
    waitlistBookings,
    weekClasses, weekStart, weekEnd, weekOffset,
    START_HOUR, END_HOUR, SLOT_MIN
  });
});

// ============================================================
// GET /book/:classId — Formularz zapisu na zajęcia
// ============================================================
router.get('/book/:classId', requireAuth, requireProfile, (req, res) => {
  // Niezweryfikowane konto niepełnoletniego nie może rezerwować
  if (!req.user.is_verified) {
    return res.redirect('/dashboard?error=Twoje+konto+wymaga+weryfikacji+zgody+rodzica+przed+zapisami');
  }

  const classId = parseInt(req.params.classId, 10);
  if (!Number.isInteger(classId) || classId < 1) {
    return res.redirect('/calendar?error=Nieprawidłowe+ID+zajęć');
  }
  const classData = ClassModel.getById(classId);

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

  // Sprawdź, czy są wolne miejsca w puli dorosłych
  if (adultSpotsLeft <= 0) {
    // Brak miejsc — sprawdź czy lista rezerwowa jest włączona
    const waitingListEnabled = !!classData.waiting_list_enabled;
    const waitingCount = waitingListEnabled ? WaitingListModel.countByClass(classData.id) : 0;
    const waitingSpotsLeft = waitingListEnabled ? (classData.max_waiting_spots - waitingCount) : 0;
    const userOnWaitlist = waitingListEnabled ? !!WaitingListModel.findByUserAndClass(req.user.id, classData.id) : false;

    return res.render('user/book', {
      title: 'Zapis na zajęcia', classData, user: req.user,
      error: null, notOpen: false, full: true,
      waitingListEnabled, waitingSpotsLeft, userOnWaitlist,
      waitingCount, adultSpotsLeft: 0, childSpotsLeft
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
    adultSpotsLeft,
    childSpotsLeft,
    user: req.user,
    error: null,
    notOpen: false,
    full: false,
    waitingListEnabled: !!classData.waiting_list_enabled,
    waitingSpotsLeft: 0,
    userOnWaitlist: false,
    waitingCount: WaitingListModel.countByClass(classData.id)
  });
});

// ============================================================
// POST /book/:classId — Zapis na zajęcia (z uczestnikami)
// ============================================================
router.post('/book/:classId', requireAuth, requireProfile, apiLimiter, async (req, res) => {
  // Niezweryfikowane konto niepełnoletniego nie może rezerwować
  if (!req.user.is_verified) {
    return res.redirect('/dashboard?error=Konto+wymaga+weryfikacji');
  }

  const classId = parseInt(req.params.classId, 10);
  if (!Number.isInteger(classId) || classId < 1) {
    return res.redirect('/calendar?error=Nieprawid\u0142owe+ID+zaj\u0119\u0107');
  }
  const classData = ClassModel.getById(classId);

  if (!classData || classData.is_cancelled) {
    return res.redirect('/calendar?error=Nieprawid\u0142owe+zaj\u0119cia');
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

  // Obsługa zapisu na listę rezerwową
  const action = typeof req.body.action === 'string' ? req.body.action : '';
  if (action === 'waitlist') {
    if (!classData.waiting_list_enabled) {
      return res.redirect(`/book/${classData.id}?error=Lista+rezerwowa+nie+jest+włączona`);
    }
    // Sprawdź czy już na liście rezerwowej
    const alreadyOnWaitlist = WaitingListModel.findByUserAndClass(req.user.id, classData.id);
    if (alreadyOnWaitlist) {
      return res.redirect('/dashboard?info=Jesteś+już+na+liście+rezerwowej+tych+zajęć');
    }
    // Sprawdź czy lista nie jest pełna
    const waitingCount = WaitingListModel.countByClass(classData.id);
    if (waitingCount >= classData.max_waiting_spots) {
      return res.redirect(`/book/${classData.id}?error=Lista+rezerwowa+jest+pełna`);
    }
    // Sprawdź czy są jeszcze wolne miejsca (równoległe wyścigi)
    const freshSpots = BookingModel.getSpotCounts(classData.id);
    if (classData.max_spots - freshSpots.adult_taken > 0) {
      // Miejsce się zwolniło — zapisz bezpośrednio na główną
      return res.redirect(`/book/${classData.id}`);
    }
    WaitingListModel.add(req.user.id, classData.id);
    return res.redirect('/dashboard?success=Zapisano+na+listę+rezerwową.+Poinformujemy+Cię+gdy+zwolni+się+miejsce.');
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
  const mainUserAge = calculateAge(req.user.birth_date);

  // Zbierz uczestników z podziałem na pule
  const participants = [];

  let mainAgeCategory = req.user.age_category;
  if (classData.class_type === 'adult_only') {
    mainAgeCategory = 'adult'; // Wszyscy w adult_only zajmują miejsce adult
    if (mainUserAge !== null && mainUserAge < 16) {
      return renderBookError('Osoby poniżej 16 roku życia nie mogą brać udziału w tych zajęciach.');
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
    const fn = String(extraFirstNames[i] || '').trim().slice(0, 50);
    const ln = String(extraLastNames[i] || '').trim().slice(0, 50);
    const rawAge = extraAges[i];
    if (fn && ln) {
      if (rawAge === undefined || rawAge === null || String(rawAge).trim() === '') {
        return renderBookError('Podaj wiek (w latach) dla każdej dopisywanej osoby.');
      }
      const ageVal = parseInt(String(rawAge).trim(), 10);
      if (!Number.isInteger(ageVal) || ageVal < 1 || ageVal > 120) {
        return renderBookError('Wiek dopisywanej osoby musi być prawidłową liczbą lat.');
      }

      let ac;
      if (classData.class_type === 'adult_only') {
        if (ageVal < 16) {
          return renderBookError(`Osoba dopisywana (${fn}) jest za młoda na te zajęcia (wymagane min. 16 lat).`);
        }
        ac = 'adult';
      } else {
        ac = ageVal >= 16 ? 'adult' : 'child';
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
  const classId = parseInt(req.params.classId, 10);
  if (!Number.isInteger(classId) || classId < 1) {
    return res.redirect('/dashboard?error=Nieprawidłowe+ID+zajęć');
  }
  const classData = ClassModel.getById(classId);

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

  // Sprawdź i przenieś pierwszą osobę z listy rezerwowej (async)
  checkAndPromoteWaitingList(classData.id);

  res.redirect('/dashboard?success=Zapis+odwołany');
});

// ============================================================
// POST /cancel/:classId/participants/:participantId — Odwołanie pojedynczego uczestnika
// ============================================================
router.post('/cancel/:classId/participants/:participantId', requireAuth, (req, res) => {
  const classId       = parseInt(req.params.classId, 10);
  const participantId = parseInt(req.params.participantId, 10);
  if (!Number.isInteger(classId) || classId < 1 || !Number.isInteger(participantId) || participantId < 1) {
    return res.redirect('/dashboard?error=Nieprawidłowe+parametry+żądania');
  }
  const classData = ClassModel.getById(classId);

  if (!classData) {
    return res.redirect('/dashboard?error=Zajęcia+nie+istnieją');
  }

  // Nie pozwól odwołać zapisu na < 2 godziny przed
  const classDate = new Date(classData.start_time);
  const hoursLeft = (classDate - new Date()) / (1000 * 60 * 60);
  if (hoursLeft < 2) {
    return res.redirect('/dashboard?error=Nie+można+odwołać+zapisu+na+mniej+niż+2+godziny+przed+zajęciami');
  }

  const participant = BookingModel.getParticipantWithContext(participantId);
  if (!participant || participant.class_id !== classId || participant.user_id !== req.user.id) {
    return res.redirect('/dashboard?error=Nieprawidłowy+uczestnik');
  }

  const bookingId = participant.booking_id;
  BookingModel.removeParticipant(participantId);

  const remaining = BookingModel.countParticipantsByBooking(bookingId);
  if (remaining === 0) {
    BookingModel.deleteBooking(bookingId);
  }

  // Sprawdź i przenieś pierwszą osobę z listy rezerwowej (async)
  checkAndPromoteWaitingList(classId);

  res.redirect(`/dashboard?success=Uczestnik+${encodeURIComponent(participant.first_name + ' ' + participant.last_name)}+został+wypisany`);
});

// ============================================================
// POST /waitlist/cancel/:classId — Wypisanie z listy rezerwowej
// ============================================================
router.post('/waitlist/cancel/:classId', requireAuth, (req, res) => {
  const classId = parseInt(req.params.classId, 10);
  if (!Number.isInteger(classId) || classId < 1) {
    return res.redirect('/dashboard?error=Nieprawidłowe+ID+zajęć');
  }
  const classData = ClassModel.getById(classId);
  if (!classData) {
    return res.redirect('/dashboard?error=Zajęcia+nie+istnieją');
  }

  const onWaitlist = WaitingListModel.findByUserAndClass(req.user.id, classData.id);
  if (!onWaitlist) {
    return res.redirect('/dashboard?error=Nie+jesteś+na+liście+rezerwowej+tych+zajęć');
  }

  WaitingListModel.remove(req.user.id, classData.id);
  res.redirect('/dashboard?success=Wypisano+z+listy+rezerwowej');
});

// ============================================================
// LEGAL PAGES (Public)
// ============================================================

router.get('/privacy', (req, res) => {
  res.render('user/privacy', {
    title: 'Polityka Prywatności',
    user: req.user
  });
});

router.get('/terms', (req, res) => {
  res.render('user/terms', {
    title: 'Regulamin',
    user: req.user
  });
});

router.get('/cookies', (req, res) => {
  res.render('user/cookies', {
    title: 'Polityka Cookies',
    user: req.user
  });
});

// ============================================================
// GET /qr — Link z kodu QR na ulotce (tracking wejść)
// ============================================================
router.get('/qr', (req, res) => {
  try {
    QrScanModel.record(req.ip, req.get('user-agent'));
  } catch (e) {
    console.error('Błąd zapisu skanu QR:', e);
  }
  res.redirect('/calendar');
});

module.exports = router;
