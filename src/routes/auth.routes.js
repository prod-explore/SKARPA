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

// ============================================================
// GET /login — Strona logowania
// ============================================================
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('user/login', {
    title: 'Logowanie',
    next: req.query.next || '/dashboard',
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

    // Wyślij e-mail
    await sendMagicLink(normalizedEmail, magicLink, isNew);

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
  const { token, next: nextUrl } = req.query;

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
  const { firstName, lastName, birthDate, terms_accepted, marketing_accepted, next: nextUrl } = req.body;
  
  if (!terms_accepted) {
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

  const today = new Date();
  let age = today.getFullYear() - birthDateObj.getFullYear();
  const m = today.getMonth() - birthDateObj.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDateObj.getDate())) {
    age--;
  }

  if (age < 13) {
    return res.render('user/complete-profile', {
      title: 'Uzupełnij profil',
      next: nextUrl || '/dashboard',
      error: 'Konto można utworzyć jedynie dla osób w wieku 13+.'
    });
  }

  const ageCategory = age >= 18 ? 'adult' : 'child';

  UserModel.updateProfile(req.user.id, firstName.trim(), lastName.trim(), ageCategory, birthDate, marketing_accepted === 'on');

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
