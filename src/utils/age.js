/**
 * age.js — Wspólny helper do obliczania wieku
 * Używany w: auth.routes, user.routes, admin.routes, database.js, szablonach EJS
 */

/**
 * Oblicza wiek na podstawie daty urodzenia.
 * @param {string|Date} birthDate — data urodzenia (ISO string lub Date)
 * @returns {number|null} — wiek w pełnych latach lub null jeśli brak/nieprawidłowa data
 */
function calculateAge(birthDate) {
  if (!birthDate) return null;

  const bd = new Date(birthDate);
  if (isNaN(bd.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - bd.getFullYear();
  const m = today.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) {
    age--;
  }
  return age;
}

module.exports = { calculateAge };
