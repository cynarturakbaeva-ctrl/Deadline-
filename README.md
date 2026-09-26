# DeadLine v3 — AI Presentation Studio (Telegram Mini App)

Telegram **Mini App** + бот: тақырып → кәсіби PPTX + HTML презентация.

## Не жаңа (v3)

- **Telegram Mini App** — стиль, тіл, слайд саны, аудитория, нақты уақыт прогресс, тарих, жүктеу
- **HTTP API** — job queue, auth via Telegram `initData` (HMAC)
- **Тарих** — соңғы презентациялар
- **Бот** — төлем (Kaspi PDF), реферал, хабарламалар, Mini App deep-link
- Бұрынғы сапа пайплайны сақталған (QC → Vision Critic → quality gate)

## Архитектура

```
Пайдаланушы
    │
    ├─► Telegram Bot (төлем / реферал / хабар)
    │
    └─► Mini App (webapp/) ──► Express API (server.js)
                                    │
                                    ▼
                              Job queue + DB (JSON)
                                    │
                                    ▼
                         generatePresentation (index.js)
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
         DeepSeek content      Images/SVG            HTML (source of truth)
              │                     │                     │
              └─────────────────────┴──► Puppeteer PNG ──► PPTX
```

## Pipeline (сапа)

`Тақырып → мазмұн → QC → quality loop → narrative → composition → sources → images → visual SVG → HTML → render QA → Vision Critic → redesign → PPTX`

Сапа қақпасы: overflow/бос слайд табылса — толық қайта генерация (1 рет). Екінші сәтсіздік — кредит қайтарылады.

## Іске қосу

```bash
cp .env.example .env   # мәндерді толтырыңыз
npm install
npm start              # server.js — API + Mini App + Bot
```

Тек бот (ескі режим): `npm run bot-only`

### Міндетті env

| Айнымалы | Сипаттама |
|----------|-----------|
| `TELEGRAM_BOT_TOKEN` | Бот токені |
| `DEEPSEEK_API_KEY` | Мазмұн генерациясы |
| `ADMIN_CHAT_ID` | Чек растау |
| `BOT_USERNAME` | @сыз username |
| `WEBAPP_URL` | HTTPS URL Mini App үшін (мыс. `https://your.domain`) |
| `PORT` | Әдепкі 3000 |

### Қосымша

`UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `VISUAL_*`, `ANTHROPIC_API_KEY`, `DB_FILE`, `MAX_CONCURRENT_GENERATIONS`, `WEBAPP_DEV=1` (локал тест)

### Telegram-да Mini App баптау

1. @BotFather → `/newapp` немесе `/setmenubutton`
2. Web App URL: `https://YOUR_DOMAIN/webapp/`
3. HTTPS міндетті (Telegram талап етеді)
4. Серверді reverse proxy (nginx/caddy) арқылы қосыңыз

## API (қысқаша)

- `GET /api/me` — пайдаланушы + кредит
- `POST /api/generate` — `{ topic, slideCount?, language?, style?, audience? }` → `{ jobId }`
- `GET /api/job/:id` — статус / прогресс
- `GET /api/job/:id/download/pptx|html`
- `GET /api/history`
- Auth: header `X-Telegram-Init-Data`

## База

Локалды JSON (`./data/db.json`): users, jobs, history. Backup `.bak`.

## Тест

```bash
npm test
```

## Нұсқа

- **2.2** — quality pipeline, Vision Critic, Inter font embed
- **3.0** — Mini App + full service API + job history
