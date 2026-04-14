/**
 * auth.js — Middleware autentykacji i helpery JWT
 * Obsługuje: magic link flow, sesje użytkownika, auth admina
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { UserModel, MagicTokenModel } = require('../models/database');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET is not set in .env');
const MAGIC_LINK_EXPIRY = process.env.JWT_MAGIC_LINK_EXPIRY || '15m';

/**
 * Generuje kryptograficznie bezpieczny token magic linku
 */
function generateMagicToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Tworzy magic link i zapisuje token w bazie
 */
function createMagicLink(userId) {
  const token = generateMagicToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minut

  MagicTokenModel.create(userId, token, expiresAt);

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  return { token, magicLink: `${appUrl}/auth/verify?token=${token}` };
}

/**
 * Tworzy JWT sesji użytkownika (długożyjący — "pamiętaj na zawsze")
 */
function createSessionToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      isAdmin: user.is_admin === 1
    },
    JWT_SECRET,
    { expiresIn: '365d' } // Rok — passwordless UX
  );
}

/**
 * Middleware: weryfikuje JWT z cookie i ustawia req.user
 * Nie blokuje — tylko dekoruje request jeśli token istnieje
 */
function loadUser(req, res, next) {
  const token = req.cookies?.authToken;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = UserModel.findById(payload.userId);

    if (!user) {
      res.clearCookie('authToken');
      req.user = null;
    } else {
      req.user = user;
    }
  } catch (err) {
    // Token wygasł lub nieprawidłowy
    res.clearCookie('authToken');
    req.user = null;
  }

  next();
}

/**
 * Middleware: wymaga zalogowanego użytkownika
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Wymagane logowanie' });
    }
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

/**
 * Middleware: wymaga pełnego profilu (imię i nazwisko)
 */
function requireProfile(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);

  if (!req.user.first_name || !req.user.last_name) {
    return res.redirect('/profile/complete?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

/**
 * Middleware: wymaga uprawnień admina
 */
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.redirect('/admin/login');
  }
  next();
}

/**
 * Ustawia cookie sesji użytkownika
 */
function setAuthCookie(res, user) {
  const token = createSessionToken(user);
  res.cookie('authToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000 // 1 rok
  });
}

module.exports = {
  generateMagicToken,
  createMagicLink,
  createSessionToken,
  loadUser,
  requireAuth,
  requireProfile,
  requireAdmin,
  setAuthCookie
};
