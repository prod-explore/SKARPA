/**
 * emailService.js — Obsługa wysyłki e-maili przez Resend
 * https://resend.com — nowoczesne API e-mail, świetna dostarczalność
 */

const { Resend } = require('resend');

let resend;

function getResend() {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('Brak RESEND_API_KEY w zmiennych środowiskowych');
    resend = new Resend(apiKey);
  }
  return resend;
}

const FROM_ADDRESS = process.env.EMAIL_FROM || 'Skarpa Bytom <noreply@skarpabytom.pl>';

function magicLinkEmailHTML(magicLink, isNewUser) {
  return `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f0;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#1a3a2a,#2d5a3d);padding:40px 48px;text-align:center;">
          <div style="font-size:30px;font-weight:900;color:#fff;letter-spacing:-1px;">&#x1F9D7; SKARPA BYTOM</div>
          <div style="color:#9dbfa8;font-size:12px;margin-top:6px;letter-spacing:3px;text-transform:uppercase;">System Rejestracji</div>
        </td></tr>
        <tr><td style="padding:48px 48px 32px;">
          <h2 style="margin:0 0 12px;font-size:22px;color:#111;font-weight:700;">
            ${isNewUser ? 'Witaj w Skarpa Bytom! &#x1F389;' : 'Twój link logowania'}
          </h2>
          <p style="color:#666;line-height:1.7;margin:0 0 32px;font-size:15px;">
            ${isNewUser
              ? 'Kliknij przycisk, aby aktywować konto i uzupełnić profil.'
              : 'Kliknij przycisk, aby zalogować się. Link jest <strong>jednorazowy</strong> i ważny <strong>15 minut</strong>.'}
          </p>
          <div style="text-align:center;margin:0 0 40px;">
            <a href="${magicLink}" style="display:inline-block;background:linear-gradient(135deg,#2d5a3d,#4a8a5d);color:#fff;text-decoration:none;padding:16px 48px;border-radius:10px;font-size:16px;font-weight:700;">
              Zaloguj się &#x2192;
            </a>
          </div>
          <div style="background:#f8f9f5;border-radius:8px;padding:16px 20px;margin-bottom:24px;border:1px solid #e8ece0;">
            <p style="margin:0;font-size:12px;color:#999;line-height:1.6;">
              Jeśli przycisk nie działa, wklej ten link do przeglądarki:<br>
              <span style="color:#2d5a3d;word-break:break-all;">${magicLink}</span>
            </p>
          </div>
          <p style="margin:0;font-size:13px;color:#bbb;">Nie prosiłeś o ten link? Możesz go zignorować.</p>
        </td></tr>
        <tr><td style="background:#f8f9f5;padding:20px 48px;border-top:1px solid #eee;text-align:center;">
          <span style="font-size:11px;color:#ccc;">&#x1F1EA;&#x1F1FA; Projekt dofinansowany ze środków UE &bull; Skarpa Bytom</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function bookingConfirmationHTML(classData, participants) {
  const date = new Date(classData.start_time);
  const dateStr = date.toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const participantsList = participants.map(p =>
    `<li style="padding:5px 0;color:#333;border-bottom:1px solid #f0f0ec;">${p.firstName} ${p.lastName}</li>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f5f0;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#1a3a2a,#2d5a3d);padding:40px 48px;text-align:center;">
          <div style="font-size:30px;font-weight:900;color:#fff;">&#x1F9D7; SKARPA BYTOM</div>
        </td></tr>
        <tr><td style="padding:48px;">
          <div style="text-align:center;font-size:48px;margin-bottom:16px;">&#x2705;</div>
          <h2 style="text-align:center;margin:0 0 32px;color:#111;">Zapis potwierdzony!</h2>
          <div style="background:#f0f7f2;border-left:4px solid #2d5a3d;padding:20px 24px;border-radius:0 10px 10px 0;margin-bottom:28px;">
            <div style="font-weight:700;font-size:18px;color:#1a3a2a;margin-bottom:10px;">${classData.name}</div>
            <div style="color:#555;margin-bottom:4px;">&#x1F4C5; ${dateStr}</div>
            <div style="color:#555;margin-bottom:4px;">&#x23F0; ${timeStr} (${classData.duration_min} min)</div>
            ${classData.instructor ? `<div style="color:#555;">&#x1F464; ${classData.instructor}</div>` : ''}
          </div>
          <h3 style="color:#1a3a2a;margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Zapisane osoby</h3>
          <ul style="margin:0 0 28px;padding:0;list-style:none;">${participantsList}</ul>
          <div style="padding:16px 20px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a;">
            <p style="margin:0;font-size:13px;color:#777;line-height:1.6;">
              &#x26A0;&#xFE0F; Odwołanie zapisu możliwe do 2 godzin przed zajęciami przez panel na stronie.<br>
              W nagłych przypadkach: <a href="mailto:wspinanie.ue@gmail.com" style="color:#2d5a3d;">wspinanie.ue@gmail.com</a>
            </p>
          </div>
        </td></tr>
        <tr><td style="background:#f8f9f5;padding:20px 48px;text-align:center;border-top:1px solid #eee;">
          <span style="font-size:11px;color:#ccc;">&#x1F1EA;&#x1F1FA; Projekt dofinansowany ze środków UE &bull; Skarpa Bytom</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendMagicLink(email, magicLink, isNewUser = false) {
  const client = getResend();
  const { data, error } = await client.emails.send({
    from: FROM_ADDRESS,
    to: [email],
    subject: isNewUser ? 'Witaj w Skarpa Bytom — aktywuj konto' : 'Twój link logowania — Skarpa Bytom',
    html: magicLinkEmailHTML(magicLink, isNewUser),
    text: `Twój jednorazowy link logowania (ważny 15 min):\n\n${magicLink}\n\nJeśli to nie Ty — zignoruj.`
  });
  if (error) { console.error('Resend error:', error); throw new Error(error.message); }
  console.log(`✉️  Magic link -> ${email} (id: ${data?.id})`);
  return data;
}

async function sendBookingConfirmation(email, classData, participants) {
  const client = getResend();
  const { data, error } = await client.emails.send({
    from: FROM_ADDRESS,
    to: [email],
    subject: `Potwierdzenie zapisu: ${classData.name} — Skarpa Bytom`,
    html: bookingConfirmationHTML(classData, participants),
    text: `Zapisano na: ${classData.name}\nData: ${classData.start_time}\nUczestnicy: ${participants.map(p=>`${p.firstName} ${p.lastName}`).join(', ')}\n\nKontakt: wspinanie.ue@gmail.com`
  });
  if (error) { console.error('Resend error:', error); throw new Error(error.message); }
  console.log(`✉️  Potwierdzenie -> ${email} (id: ${data?.id})`);
  return data;
}

async function initEmailService() {
  try { getResend(); console.log('✅ Resend email service gotowy'); }
  catch (err) { console.warn('⚠️  Resend:', err.message); }
}

module.exports = { initEmailService, sendMagicLink, sendBookingConfirmation };
