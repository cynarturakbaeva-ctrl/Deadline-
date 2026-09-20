# DeadLine — AI Presentation Bot

Telegram бот: тақырып → PPTX + HTML.

## Pipeline
`Тақырып → DeepSeek мазмұны → QC → Unsplash суреттері → HTML (шындық көзі)`
`HTML ─► пайдаланушыға .html`
`HTML ─► Puppeteer → PNG → .pptx`

PPTX сол HTML-дің өзінен рендерленеді, сондықтан екеуі бірдей.

## Іске қосу
1. `cp .env.example .env` және мәндерді толтырыңыз
2. `npm install`
3. `npm start`

`DATABASE_URL` — PostgreSQL. Кесте бот іске қосылғанда автоматты құрылады.
