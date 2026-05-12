/**
 * security.js — Middleware bezpieczeństwa: rate limiting, nagłówki, sanityzacja
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

/**
 * Ogólny rate limit dla całej aplikacji
 */
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zbyt wiele żądań. Spróbuj ponownie za kilka minut.' }
});

/**
 * Ścisły rate limit dla endpointu wysyłki magic linku
 * Zapobiega spamowi e-mailowemu
 */
const magicLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 godzina
  max: parseInt(process.env.MAGIC_LINK_RATE_LIMIT_MAX) || 5,
  keyGenerator: (req) => req.ip,
  message: { error: 'Wysłano już kilka linków. Sprawdź skrzynkę lub spróbuj za godzinę.' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limit dla endpointów API (zapisy, itp.)
 */
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 30,
  message: { error: 'Za dużo żądań API. Poczekaj chwilę.' }
});

/**
 * Rate limit dla panelu admina
 */
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Zbyt wiele prób logowania. Spróbuj za 15 minut.' }
});

/**
 * Konfiguracja Helmet — nagłówki bezpieczeństwa HTTP
 */
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://maps.googleapis.com'],
      frameSrc: ['https://www.google.com'],
      imgSrc: ["'self'", 'data:', 'https://maps.gstatic.com', 'https://maps.googleapis.com', '*.ggpht.com'],
      connectSrc: ["'self'", 'https://maps.googleapis.com']
    }
  },
  crossOriginEmbedderPolicy: false // Wymagane dla Google Maps embed
});

/**
 * Sanityzuje prosty tekst — usuwa tagi HTML
 */
function sanitizeText(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim().slice(0, 500);
}

/**
 * Middleware sanityzujący body requesta
 */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeText(req.body[key]);
      }
    }
  }
  next();
}

module.exports = {
  generalLimiter,
  magicLinkLimiter,
  apiLimiter,
  adminLoginLimiter,
  helmetConfig,
  sanitizeBody
};
