# 🧗 Skarpa Bytom — System Rejestracji na Zajęcia Wspinaczkowe

Projekt dofinansowany ze środków Unii Europejskiej.

---

## Stack

- **Backend:** Node.js + Express.js
- **Baza danych:** SQLite (better-sqlite3) — zero konfiguracji, działa od razu w Dockerze
- **E-mail:** [Resend](https://resend.com) — nowoczesne API, świetna dostarczalność
- **Autentykacja:** Magic Link (passwordless) dla użytkowników **i** admina
- **Konteneryzacja:** Docker + Docker Compose

---

## Szybki start

### 1. Konfiguracja `.env`

```bash
cp .env.example .env
```

Uzupełnij wymagane wartości w `.env`:

| Zmienna | Opis |
|---|---|
| `JWT_SECRET` | Losowy ciąg min. 64 znaków |
| `ADMIN_EMAIL` | `wspinanie.ue@gmail.com` (jedyny mail uprawniony do panelu) |
| `RESEND_API_KEY` | Klucz z [resend.com/api-keys](https://resend.com/api-keys) |
| `EMAIL_FROM` | Adres nadawcy (zweryfikowana domena w Resend) |
| `APP_URL` | Publiczny URL aplikacji (do magic linków) |

### 2. Resend — konfiguracja

1. Zarejestruj się na [resend.com](https://resend.com)
2. Dodaj i zweryfikuj domenę (lub użyj `onboarding@resend.dev` do testów)
3. Wygeneruj klucz API i wklej do `.env`

### 3. Uruchomienie (deweloperskie)

```bash
# Bez Dockera
npm install
node src/app.js

# Lub z Dockerem (dev — port 3000 bezpośrednio)
docker-compose -f docker-compose.dev.yml up --build
```

Aplikacja dostępna pod: http://localhost:3000

### 4. Uruchomienie (produkcja z zewnętrznym proxy)

```bash
# Upewnij się że sieć proxy istnieje:
docker network create proxy_network

# Uruchom
docker-compose up -d --build
```

---

## Logowanie do panelu admina

1. Wejdź na `/admin/login`
2. Wpisz `wspinanie.ue@gmail.com`
3. Kliknij **„Wyślij link logowania"**
4. Sprawdź skrzynkę i kliknij link

> **Ważne:** Magic link trafia tylko na adres `ADMIN_EMAIL` z `.env`.
> Każdy inny e-mail zostanie odrzucony.

---

## Awaryjne zapisy (backup)

Jeśli system ma problemy, uczestnicy mogą zapisywać się bezpośrednio przez e-mail:
**wspinanie.ue@gmail.com**

Informacja ta jest widoczna:
- Na stronie głównej (sekcja „Kontakt")
- W kalendarzu zajęć
- W e-mailach potwierdzeniowych

---

## Struktura plików

```
skarpa-bytom/
├── src/
│   ├── app.js                  # Główny plik Express
│   ├── models/
│   │   └── database.js         # SQLite + wszystkie modele
│   ├── routes/
│   │   ├── auth.routes.js      # Magic link flow
│   │   ├── user.routes.js      # Strony użytkownika
│   │   └── admin.routes.js     # Panel admina
│   ├── middleware/
│   │   ├── auth.js             # JWT, cookies, guards
│   │   └── security.js         # Rate limiting, helmet
│   └── services/
│       └── emailService.js     # Resend API
├── views/
│   ├── partials/               # head, navbar, footer
│   ├── user/                   # index, login, dashboard, book, calendar
│   └── admin/                  # login, dashboard, class-form, attendance
├── public/
│   ├── css/main.css
│   └── js/main.js
├── Dockerfile
├── docker-compose.yml          # Produkcja (z proxy_network)
├── docker-compose.dev.yml      # Deweloperskie (port 3000 bezpośrednio)
├── .env.example
└── package.json
```

---

## Logika biznesowa

- **Blokada 7-dniowa:** Zapisy otwierają się dokładnie 7 dni przed zajęciami (co do sekundy, weryfikacja server-side)
- **Multi-osobowe zapisy:** Jeden użytkownik może zapisać siebie + dowolną liczbę osób, o ile pozwala na to liczba wolnych miejsc
- **Odwołanie zapisu:** Możliwe do 2 godzin przed zajęciami
- **Passwordless:** Zarówno użytkownicy, jak i admin logują się magic linkiem (JWT, sesja 365 dni)

---

## Logotypy UE

Umieść pliki w `public/images/`:
- `eu-logo.png` — logo Unii Europejskiej
- `fe-logo.png` — logo Funduszy Europejskich
- `rp-logo.png` — logo RP

Następnie zaktualizuj `views/partials/footer.ejs` zastępując placeholdery tagami `<img>`.

---

## Bezpieczeństwo

- **Helmet** — nagłówki HTTP (CSP, HSTS, etc.)
- **Rate limiting** — ogólny (100 req/15min), magic link (5/h per email), admin login (10/15min), API (30/10min)
- **JWT HttpOnly cookies** — bezpieczne przechowywanie sesji
- **Sanityzacja** — wszystkie inputy sanityzowane przed trafieniem do bazy
- **WAL mode** — SQLite w trybie Write-Ahead Logging
- **Foreign keys** — integralność danych w SQLite
- **Non-root user** — kontener Docker uruchamiany jako `node` (nie root)
