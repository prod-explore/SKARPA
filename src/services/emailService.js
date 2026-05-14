/**
 * emailService.js — Wysyłka magic linków przez Resend
 * Jedyny typ maila: jednorazowy link logowania.
 * Techniki anty-spam:
 *  - Proper From z display name dopasowanym do domeny
 *  - Reply-To = kontaktowy adres projektu
 *  - List-Unsubscribe header (wymagany przez Gmail/Outlook dla bulk)
 *  - Text/plain alternative
 *  - Brak obrazków śledzących, brak ukrytych px
 *  - Wyraźna treść transakcyjna (użytkownik sam prosił o link)
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

const FROM_ADDRESS  = process.env.EMAIL_FROM  || 'Fantastyczne Wspinanie <noreply@skarpabytom.pl>';
const REPLY_TO      = process.env.EMAIL_REPLY || 'wspinanie.ue@gmail.com';
const APP_NAME      = 'Fantastyczne Wspinanie — System zapisów';

function magicLinkEmailHTML(magicLink, isNewUser) {
  const heading = isNewUser
    ? 'Aktywuj konto &#x1F44B;'
    : 'Twój link do logowania';

  const body = isNewUser
    ? 'Twoje konto zostało założone. Kliknij poniżej, aby je aktywować i uzupełnić profil.'
    : 'Kliknij poniższy przycisk, aby zalogować się do systemu. Link jest <strong>jednorazowy</strong> i ważny przez <strong>15 minut</strong>.';

  return `<!DOCTYPE html>
<html lang="pl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f4eb;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <!--[if mso]><table role="presentation" width="100%"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f4eb;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dde5d0;">

        <!-- Header -->
        <tr>
          <td style="background-color:#1a3a2a;padding:36px 48px;text-align:center;">
            <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#99c24d;">PROJEKT DOFINANSOWANY ZE ŚRODKÓW UE</p>
            <h1 style="margin:10px 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-0.3px;">Fantastyczne Wspinanie</h1>
            <p style="margin:4px 0 0;font-size:11px;color:#6b8f72;letter-spacing:1px;">System zapisów na zajęcia</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:44px 48px 32px;">
            <h2 style="margin:0 0 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#111111;">${heading}</h2>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#555555;">${body}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 36px;">
              <tr>
                <td style="border-radius:8px;background-color:#2d5a3d;">
                  <a href="${magicLink}" target="_blank" rel="noopener noreferrer"
                     style="display:block;padding:15px 44px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">
                    ${isNewUser ? 'Aktywuj konto' : 'Zaloguj się'} &rarr;
                  </a>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#f8f9f5;border:1px solid #e4e9da;border-radius:8px;padding:16px 20px;">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888888;">Link nie działa? Skopiuj adres:</p>
                  <p style="margin:0;font-size:12px;color:#2d5a3d;word-break:break-all;">${magicLink}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f9f5;border-top:1px solid #e8ece0;padding:20px 48px;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;color:#aaaaaa;">
              Nie prosiłeś(-aś) o ten link? Możesz go zignorować — żadne działanie nie jest wymagane.
            </p>
            <p style="margin:0;font-size:11px;color:#cccccc;">
              &#x1F1EA;&#x1F1FA; Projekt dofinansowany ze środków UE &bull; KS Skarpa Bytom, ul. Wojciecha Kilara 33
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</body>
</html>`;
}

function magicLinkEmailText(magicLink, isNewUser) {
  return isNewUser
    ? `Witaj!\n\nKliknij ten link, aby aktywować konto (ważny 15 min):\n${magicLink}\n\nJeśli nie zakładałeś(-aś) konta — zignoruj tę wiadomość.\n\n-- Fantastyczne Wspinanie | wspinanie.ue@gmail.com`
    : `Twój link do logowania (jednorazowy, ważny 15 min):\n${magicLink}\n\nJeśli nie prosiłeś(-aś) o ten link — zignoruj tę wiadomość.\n\n-- Fantastyczne Wspinanie | wspinanie.ue@gmail.com`;
}

async function sendMagicLink(email, magicLink, isNewUser = false) {
  const client = getResend();
  const subject = isNewUser
    ? `Aktywuj swoje konto — ${APP_NAME}`
    : `Twój link do logowania — ${APP_NAME}`;

  const { data, error } = await client.emails.send({
    from:     FROM_ADDRESS,
    to:       [email],
    reply_to: REPLY_TO,
    subject,
    html: magicLinkEmailHTML(magicLink, isNewUser),
    text: magicLinkEmailText(magicLink, isNewUser),
    headers: {
      // Pomaga filtrować jako wiadomość transakcyjną (nie bulk/marketing)
      'X-Entity-Ref-ID':  `magic-link-${Date.now()}`,
      'Precedence':       'transactional',
      'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=Unsubscribe>`
    }
  });

  if (error) {
    console.error('Resend error (magic link):', error);
    throw new Error(error.message);
  }
  console.log(`✉️  Magic link -> ${email} (id: ${data?.id})`);
  return data;
}

async function initEmailService() {
  try { getResend(); console.log('✅ Resend email service gotowy'); }
  catch (err) { console.warn('⚠️  Resend:', err.message); }
}

module.exports = { initEmailService, sendMagicLink };
