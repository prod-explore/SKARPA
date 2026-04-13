# ============================================================
# Dockerfile — Skarpa Bytom
# Node.js 20 Alpine (minimalne, szybkie)
# ============================================================

FROM node:20-alpine AS base

# Zależności systemowe potrzebne do better-sqlite3 (native module)
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

# --- Warstwa zależności (cache) ---
FROM base AS deps
COPY package*.json ./
RUN npm install --only=production

# --- Warstwa produkcyjna ---
FROM base AS production

WORKDIR /app

# Kopiuj zależności
COPY --from=deps /app/node_modules ./node_modules

# Kopiuj kod aplikacji
COPY src/        ./src/
COPY views/      ./views/
COPY public/     ./public/
COPY package.json ./

# Utwórz katalog na dane (baza SQLite)
RUN mkdir -p /app/data && chown -R node:node /app/data

# Uruchom jako nieprivilegowany użytkownik (bezpieczeństwo)
USER node

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "src/app.js"]
