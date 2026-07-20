/**
 * auth.routes.js — Endpointy autentykacji
 * Obsługuje: żądanie magic linku, weryfikację tokenu, wylogowanie
 */

const express = require('express');
const router = express.Router();
const validator = require('validator');

const { UserModel, MagicTokenModel } = require('../models/database');
const { sendMagicLink } = require('../services/emailService');
const { createMagicLink, setAuthCookie, requireAuth } = require('../middleware/auth');
const { magicLinkLimiter } = require('../middleware/security');
const { calculateAge } = require('../utils/age');

// ============================================================
// GET /login — Strona logowania
// ============================================================
router.get('/login', (req, res) => {
  let nextUrl = req.query.next;
  if (nextUrl && (!nextUrl.startsWith('/') || nextUrl.startsWith('//'))) {
    nextUrl = '/dashboard';
  }

  if (req.user) return res.redirect(nextUrl || '/dashboard');
  
  res.render('user/login', {
    title: 'Logowanie',
    next: nextUrl || '/dashboard',
    error: req.query.error || null,
    success: req.query.success || null
  });
});

// ============================================================
// POST /auth/request — Żądanie magic linku
// ============================================================
router.post('/auth/request', magicLinkLimiter, async (req, res) => {
  const { email, next: nextUrl, website } = req.body;

  // Honeypot check
  if (website) {
    console.warn(`[HONEYPOT] Bot detected from ${req.ip} in login form`);
    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl || '/dashboard',
      error: null,
      success: `Link logowania wysłany na ${email || 'podany adres'}. Sprawdź skrzynkę!`
    });
  }

  // Walidacja e-maila
  if (!email || !validator.isEmail(email)) {
    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl || '/dashboard',
      error: 'Podaj prawidłowy adres e-mail.',
      success: null
    });
  }

  const normalizedEmail = validator.normalizeEmail(email);

  try {
    // Pobierz lub utwórz użytkownika
    const { user, isNew } = UserModel.getOrCreate(normalizedEmail);

    // Wyczyść stare tokeny
    MagicTokenModel.cleanExpired();

    // Wygeneruj magic link
    const { magicLink } = createMagicLink(user.id);

    // Utrzymaj parametr next w wygenerowanym linku (jeśli jest bezpieczny)
    let finalMagicLink = magicLink;
    if (nextUrl && nextUrl.startsWith('/') && !nextUrl.startsWith('//')) {
      finalMagicLink += `&next=${encodeURIComponent(nextUrl)}`;
    }

    // Wyślij e-mail
    await sendMagicLink(normalizedEmail, finalMagicLink, isNew);

    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl || '/dashboard',
      error: null,
      success: `Link logowania wysłany na ${normalizedEmail}. Sprawdź skrzynkę!`
    });
  } catch (err) {
    console.error('Błąd wysyłki magic link:', err);
    return res.render('user/login', {
      title: 'Logowanie',
      next: nextUrl || '/dashboard',
      error: 'Nie udało się wysłać e-maila. Spróbuj ponownie.',
      success: null
    });
  }
});

// ============================================================
// GET /auth/verify — Weryfikacja magic linku
// ============================================================
router.get('/auth/verify', async (req, res) => {
  let { token, next: nextUrl } = req.query;

  // Walidacja Open Redirect - upewnij się, że URL jest lokalną ścieżką
  if (nextUrl && (!nextUrl.startsWith('/') || nextUrl.startsWith('//'))) {
    nextUrl = '/dashboard';
  }

  if (!token) {
    return res.redirect('/login?error=' + encodeURIComponent('Brak tokenu'));
  }

  try {
    // Znajdź ważny token
    const tokenRecord = MagicTokenModel.findValid(token);

    if (!tokenRecord) {
      return res.redirect('/login?error=' + encodeURIComponent('Link wygasł lub jest nieprawidłowy. Wygeneruj nowy.'));
    }

    // Oznacz token jako użyty
    MagicTokenModel.markUsed(token);

    // Pobierz użytkownika
    const user = UserModel.findById(tokenRecord.user_id);
    UserModel.updateLastLogin(user.id);

    // Ustaw cookie sesji
    setAuthCookie(res, user);

    // Jeśli nowy użytkownik — uzupełnij profil
    // Admin — zawsze do panelu admina
    if (user.is_admin) {
      return res.redirect('/admin');
    }

    // Nowy użytkownik bez profilu — uzupełnienie danych
    if (!user.first_name || !user.last_name) {
      const next = nextUrl || '/dashboard';
      return res.redirect('/profile/complete?next=' + encodeURIComponent(next));
    }

    return res.redirect(nextUrl || '/dashboard');
  } catch (err) {
    console.error('Błąd weryfikacji tokenu:', err);
    return res.redirect('/login?error=' + encodeURIComponent('Wystąpił błąd. Spróbuj ponownie.'));
  }
});

// ============================================================
// GET /profile/complete — Uzupełnienie profilu (pierwsze logowanie)
// ============================================================
router.get('/profile/complete', requireAuth, (req, res) => {
  res.render('user/complete-profile', {
    title: 'Uzupełnij profil',
    next: req.query.next || '/dashboard',
    error: null
  });
});

// ============================================================
// POST /profile/complete — Zapis danych profilu
// ============================================================
router.post('/profile/complete', requireAuth, (req, res) => {
  let { firstName, lastName, birthDate, terms_accepted, marketing_accepted, next: nextUrl } = req.body;
  
  // Walidacja Open Redirect
  if (nextUrl && (!nextUrl.startsWith('/') || nextUrl.startsWith('//'))) {
    nextUrl = '/dashboard';
  }
  
  const termsAccepted = req.body.terms_accepted === 'on';
  if (!termsAccepted) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl || '/dashboard',
      error: 'Musisz zaakceptować regulamin i politykę prywatności.'
    });
  }

  if (!firstName?.trim() || !lastName?.trim() || !birthDate) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl || '/dashboard',
      error: 'Imię, nazwisko i data urodzenia są wymagane.'
    });
  }

  const birthDateObj = new Date(birthDate);
  if (isNaN(birthDateObj.getTime())) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl || '/dashboard',
      error: 'Nieprawidłowa data urodzenia.'
    });
  }
  // Data nie może być w przyszłości ani dawniej niż 120 lat temu
  const now120ago = new Date();
  now120ago.setFullYear(now120ago.getFullYear() - 120);
  if (birthDateObj > new Date() || birthDateObj < now120ago) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl || '/dashboard',
      error: 'Nieprawidłowa data urodzenia. Podaj rzeczywistą datę.'
    });
  }

  const age = calculateAge(birthDate);

  if (age === null || age < 16) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl || '/dashboard',
      error: 'Samodzielne konto mogą założyć osoby od 16 roku życia. Młodszych uczestników rejestrują rodzice ze swojego konta.'
    });
  }

  // Od 16 lat w górę — zawsze kategoria 'adult' (pula miejsc dla dorosłych)
  const ageCategory = 'adult';

  UserModel.updateProfile(
    req.user.id,
    firstName.trim().slice(0, 50),
    lastName.trim().slice(0, 50),
    ageCategory,
    birthDate,
    marketing_accepted === 'on'
  );

  // Odśwież dane w cookie
  const updatedUser = UserModel.findById(req.user.id);
  setAuthCookie(res, updatedUser);

  return res.redirect(nextUrl || '/dashboard');
});

// ============================================================
// POST /auth/logout — Wylogowanie
// ============================================================
router.post('/auth/logout', (req, res) => {
  res.clearCookie('authToken');
  res.redirect('/');
});

module.exports = router;
